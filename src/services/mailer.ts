/**
 * Outbound email — wraps two transports (Resend HTTPS API and
 * nodemailer SMTP) into a tiny, fire-and-forget helper. The bot
 * uses this to send a polished welcome / confirmation email when a
 * user saves OR changes their address in Settings → Email Settings.
 *
 * Why two transports?
 *   - Cloud platforms like Railway, Heroku, Fly and Vercel block raw
 *     SMTP egress (ports 25/465/587) by default to prevent spam abuse
 *     from compromised apps. So Spacemail SMTP is unreachable from
 *     them, even with valid credentials.
 *   - The cure: send via an HTTPS API. Resend is small, modern, has
 *     a free tier well-suited to a Telegram-bot welcome flow, and
 *     happily delivers from `shopbot@safwantiger.com` once the
 *     domain is verified.
 *   - The legacy SMTP path is preserved for self-hosted / VPS-style
 *     deploys where outbound 465/587 isn't firewalled.
 *
 * Transport selection:
 *   - If RESEND_API_KEY is present → Resend (preferred).
 *   - Else if all four SMTP_* are present → nodemailer SMTP.
 *   - Else → no-op, log a warning at startup.
 *
 * Failure modes are *never* thrown. Callers `void sendWelcomeEmail()`
 * fire-and-forget; the function returns boolean and logs everything.
 * SMTP/HTTP error metadata is interpolated into the visible log
 * message so it survives Railway-style log viewers that drop pino's
 * structured payload.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';
import { Resend } from 'resend';
import { env } from '../env.js';
import { logger } from '../logger.js';

/** Path to the bundled "Why we need your email" PDF. */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const WHY_EMAIL_PDF_PATH = path.resolve(
  __dirname,
  '../../../assets/email-explanation.pdf',
);
/** Path to the SafwanTiger Shop logo shown in the email header. */
export const EMAIL_LOGO_PATH = path.resolve(
  __dirname,
  '../../../assets/email-logo.png',
);

const LOGO_FILENAME = 'safwantiger-logo.png';
/** CID used by the inline logo in the HTML body. */
const LOGO_CID = 'safwantiger-logo';

let logoBase64Cache: string | null = null;
function readLogoBase64(): string | null {
  if (logoBase64Cache) return logoBase64Cache;
  try {
    logoBase64Cache = fs.readFileSync(EMAIL_LOGO_PATH).toString('base64');
    return logoBase64Cache;
  } catch (err) {
    logger.error(
      { err, path: EMAIL_LOGO_PATH },
      'mailer: could not read header logo — falling back to plain header',
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
//  Transport selection
// ---------------------------------------------------------------------------

function resendConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

function smtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS);
}

let resendCached: Resend | null = null;
function resendClient(): Resend | null {
  if (!resendConfigured()) return null;
  if (resendCached) return resendCached;
  resendCached = new Resend(env.RESEND_API_KEY as string);
  return resendCached;
}

let smtpCached: Transporter<SMTPPool.SentMessageInfo> | null = null;
function smtpTransporter(): Transporter<SMTPPool.SentMessageInfo> | null {
  if (!smtpConfigured()) return null;
  if (smtpCached) return smtpCached;
  smtpCached = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 → implicit TLS; 587 → STARTTLS upgrade.
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER as string,
      pass: env.SMTP_PASS as string,
    },
    pool: true,
    // Cap connection / handshake / socket timeouts so a firewalled
    // egress fails *fast* (within ~15s) instead of hanging for
    // minutes — important for fire-and-forget callers.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  return smtpCached;
}

/**
 * Build the canonical "From: SafwanTiger Shop <shopbot@…>" header.
 * Order of precedence:
 *   RESEND_FROM > SMTP_FROM > SMTP_USER > 'shopbot@safwantiger.com'
 */
function fromAddress(): string {
  const addr =
    env.RESEND_FROM ||
    env.SMTP_USER ||
    env.SMTP_FROM ||
    'shopbot@safwantiger.com';
  const name = env.SMTP_FROM_NAME || 'SafwanTiger Shop';
  return `"${name}" <${addr}>`;
}

// ---------------------------------------------------------------------------
//  HTML / plain-text body
// ---------------------------------------------------------------------------

type Mode = 'set' | 'change' | 'delete';

/**
 * Render the welcome / confirmation email body (HTML + plain-text).
 * For `mode='change'` the subject and copy reference the previous
 * address so users immediately spot unauthorised changes.
 */
function welcomeBody(args: {
  email: string;
  previousEmail: string | null;
  firstName: string | null;
  username: string | null;
  mode: Mode;
}): { html: string; text: string; subject: string } {
  const greeting = args.firstName
    ? `Hi ${args.firstName},`
    : args.username
      ? `Hi @${args.username},`
      : 'Hello,';

  const subject =
    args.mode === 'delete'
      ? 'SafwanTiger Shop — your email has been removed'
      : args.mode === 'change'
        ? 'SafwanTiger Shop — your email has been updated'
        : 'Welcome to SafwanTiger Shop — your email is connected';

  const headlineEyebrow =
    args.mode === 'delete'
      ? 'Email removed'
      : args.mode === 'change'
        ? 'Email updated'
        : 'Welcome aboard';
  const headlineTitle =
    args.mode === 'delete'
      ? 'Your email was removed'
      : args.mode === 'change'
        ? 'Your email was updated'
        : 'Your email is connected';

  // ---------- plain-text alternative ----------
  const introText =
    args.mode === 'delete'
      ? `Just confirming: the email on file for your SafwanTiger Shop account (${args.email}) has been deleted from the bot successfully. You will no longer receive receipts at this address.`
      : args.mode === 'change'
        ? `Just confirming: the email on file for your SafwanTiger Shop account has been updated to ${args.email}.`
        : `Thanks for setting up your email with SafwanTiger Shop. We've securely linked ${args.email} to your Telegram account.`;
  const lines: string[] = [greeting, '', introText];
  if (args.mode === 'change' && args.previousEmail) {
    lines.push('', `Previous email on file: ${args.previousEmail}`);
  }
  if (args.mode === 'delete') {
    lines.push(
      '',
      'You can re-link an email anytime from the bot:',
      'Settings → Email Settings → Set Email.',
      '',
      "If you didn't just delete this address yourself, reply to this email immediately so we can secure your account.",
      '',
      '— SafwanTiger Shop',
      'https://t.me/safwantigershopbot',
    );
  } else {
    lines.push(
      '',
      'What this email is used for:',
      '  • Order receipts and delivery confirmations',
      '  • Account recovery if you lose access to Telegram',
      '  • Critical security notices',
      '',
      'We will never use this address for marketing, share it with',
      'third parties, or send unsolicited messages.',
      '',
      args.mode === 'change'
        ? "If you didn't just update this address yourself, reply to this email immediately so we can secure your account."
        : 'If you did not just save this address in our bot, please reply to this email and we will remove it from your account.',
      '',
      '— SafwanTiger Shop',
      'https://t.me/safwantigershopbot',
    );
  }
  const text = lines.join('\n');

  // ---------- HTML body ----------
  // Premium ink + champagne-gold palette. Tokens are inlined into
  // each style attribute below (email clients ignore <style> blocks
  // and CSS variables).
  //   Page bg     : #070707   (near-black ink)
  //   Card bg     : #0f0f10
  //   Card border : rgba(212,165,116,.20)  (subtle gold ring)
  //   Inner card  : #16151a
  //   Inner border: rgba(255,255,255,.06)
  //   Accent gold : #d4a574   (champagne)
  //   Accent hi   : #e6c08c
  //   Headline    : #f5f1e8   (warm cream)
  //   Body        : #d8d3c8
  //   Muted       : #8a8378
  const previousEmailBlock =
    args.mode === 'change' && args.previousEmail
      ? `<tr><td style="padding:0 36px 18px 36px;">
          <div style="padding:14px 18px;border-radius:10px;background:#16151a;border:1px solid rgba(255,255,255,0.06);font-size:13px;color:#8a8378;line-height:1.6;">
            <span style="color:#8a8378;">Previous address on file: </span><span style="color:#d8d3c8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(args.previousEmail)}</span>
          </div>
        </td></tr>`
      : '';

  const securityNote =
    args.mode === 'delete'
      ? "If you didn't just delete this address yourself, <a href=\"mailto:shopbot@safwantiger.com?subject=Unauthorised%20email%20deletion\" style=\"color:#e6c08c;text-decoration:underline;text-underline-offset:2px;\">reply to this email immediately</a> so we can secure your account."
      : args.mode === 'change'
        ? "If you didn't just update this address yourself, <a href=\"mailto:shopbot@safwantiger.com?subject=Unauthorised%20email%20change\" style=\"color:#e6c08c;text-decoration:underline;text-underline-offset:2px;\">reply to this email immediately</a> so we can secure your account."
        : "Didn't just save this address? <a href=\"mailto:shopbot@safwantiger.com?subject=Remove%20my%20email\" style=\"color:#e6c08c;text-decoration:underline;text-underline-offset:2px;\">Reply to this email</a> and we'll remove it from your account.";

  const introCopy =
    args.mode === 'delete'
      ? `Just confirming: <strong style="color:#e6c08c;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(args.email)}</strong> has been deleted from the bot successfully. You will no longer receive receipts at this address.`
      : args.mode === 'change'
        ? `Just confirming: the email on file for your SafwanTiger Shop account has been updated to <strong style="color:#e6c08c;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(args.email)}</strong>.`
        : `Thanks for setting up your email with SafwanTiger Shop. We've securely linked <strong style="color:#e6c08c;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(args.email)}</strong> to your Telegram account.`;

  // Circular logo with a thin champagne ring. 56×56 — small enough
  // to feel refined, large enough to read on retina displays. The
  // VML fallback covers Outlook desktop, which ignores
  // border-radius.
  const logoBlock = `
    <!--[if mso]>
    <v:oval xmlns:v="urn:schemas-microsoft-com:vml" style="width:56pt;height:56pt;" stroked="t" strokeweight="1.5pt" strokecolor="#d4a574" fillcolor="#0a0a0a"><v:fill type="frame" src="cid:${LOGO_CID}"/></v:oval>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <img src="cid:${LOGO_CID}" alt="SafwanTiger Shop" width="56" height="56" style="display:block;width:56px;height:56px;border:1.5px solid #d4a574;border-radius:50%;background:#0a0a0a;object-fit:cover;">
    <!--<![endif]-->`;

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#070707;font-family:'SF Pro Display',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#d8d3c8;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#070707;">
    ${escapeHtml(
      args.mode === 'delete'
        ? `Email ${args.email} has been removed from your account.`
        : args.mode === 'change'
          ? `Email on file changed to ${args.email}.`
          : `Welcome aboard — ${args.email} is now linked to your account.`,
    )}
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#070707;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#0f0f10;border:1px solid rgba(212,165,116,0.20);border-radius:18px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.55);">

        <!-- Hairline gold accent at the very top -->
        <tr><td style="height:2px;line-height:2px;font-size:0;background:linear-gradient(90deg,rgba(212,165,116,0) 0%,#d4a574 50%,rgba(212,165,116,0) 100%);">&nbsp;</td></tr>

        <!-- Header: centred logo + eyebrow + title on deep ink -->
        <tr><td align="center" style="padding:40px 36px 28px 36px;background:#0a0a0a;">
          ${logoBlock}
          <div style="font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:#d4a574;font-weight:600;margin-top:18px;">SafwanTiger Shop</div>
          <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8a8378;margin-top:4px;font-weight:500;">${escapeHtml(headlineEyebrow)}</div>
          <div style="font-size:26px;color:#f5f1e8;font-weight:600;margin-top:18px;letter-spacing:-0.015em;line-height:1.25;">${escapeHtml(headlineTitle)}</div>
        </td></tr>

        <!-- Hairline divider -->
        <tr><td style="height:1px;line-height:1px;font-size:0;background:rgba(212,165,116,0.16);">&nbsp;</td></tr>

        <tr><td style="padding:32px 36px 10px 36px;">
          <p style="margin:0 0 16px 0;color:#f5f1e8;font-size:15px;line-height:1.6;font-weight:500;">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 22px 0;font-size:15px;line-height:1.7;color:#d8d3c8;">${introCopy}</p>
        </td></tr>

        ${previousEmailBlock}

        ${
          args.mode === 'delete'
            ? `<tr><td style="padding:0 36px 22px 36px;">
                <p style="margin:0;font-size:14px;line-height:1.7;color:#d8d3c8;">
                  Need to re-link an email later? Open the bot any time and head to
                  <span style="color:#e6c08c;font-weight:500;">Settings → Email Settings → Set Email</span>.
                </p>
              </td></tr>`
            : `<tr><td style="padding:0 36px 22px 36px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:12px;background:#16151a;border:1px solid rgba(255,255,255,0.06);">
                  <tr><td style="padding:22px 24px;">
                    <div style="font-size:10px;color:#d4a574;text-transform:uppercase;letter-spacing:.22em;margin-bottom:14px;font-weight:600;">What this email is used for</div>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;line-height:1.7;color:#d8d3c8;">
                      <tr><td style="padding:5px 0;width:28px;vertical-align:top;color:#d4a574;">●</td><td style="padding:5px 0;">Order receipts &amp; delivery confirmations</td></tr>
                      <tr><td style="padding:5px 0;width:28px;vertical-align:top;color:#d4a574;">●</td><td style="padding:5px 0;">Account recovery if you lose Telegram access</td></tr>
                      <tr><td style="padding:5px 0;width:28px;vertical-align:top;color:#d4a574;">●</td><td style="padding:5px 0;">Critical security notices</td></tr>
                    </table>
                  </td></tr>
                </table>
              </td></tr>

              <tr><td style="padding:0 36px 22px 36px;">
                <p style="margin:0;font-size:13px;line-height:1.7;color:#8a8378;">
                  We will <strong style="color:#e6c08c;font-weight:500;">never</strong> use this address for marketing or share it with anyone.
                </p>
              </td></tr>`
        }

        <tr><td style="padding:0 36px 28px 36px;">
          <div style="padding:16px 20px;border-radius:10px;background:rgba(212,165,116,0.06);border:1px solid rgba(212,165,116,0.22);font-size:13px;color:#d8d3c8;line-height:1.7;">
            <strong style="color:#e6c08c;font-weight:600;letter-spacing:.02em;">Security notice.</strong> ${securityNote}
          </div>
        </td></tr>

        <!-- Hairline divider -->
        <tr><td style="height:1px;line-height:1px;font-size:0;background:rgba(255,255,255,0.06);">&nbsp;</td></tr>

        <tr><td align="center" style="padding:24px 36px 28px 36px;background:#0a0a0a;">
          <div style="font-size:13px;color:#d8d3c8;line-height:1.6;font-weight:500;">SafwanTiger Shop Team</div>
          <div style="margin-top:6px;font-size:13px;color:#8a8378;line-height:1.6;">
            <a href="https://t.me/safwantigershopbot" style="color:#e6c08c;text-decoration:none;">@safwantigershopbot</a>
            <span style="color:#3a3631;">&nbsp;·&nbsp;</span>
            <a href="mailto:shopbot@safwantiger.com" style="color:#8a8378;text-decoration:none;">shopbot@safwantiger.com</a>
          </div>
          <p style="margin:16px 0 0 0;font-size:11px;color:#5a5550;line-height:1.6;letter-spacing:.01em;">
            This is an automated message confirming a change you made through the SafwanTiger Shop Telegram bot. Please don't share this email with anyone.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { html, text, subject };
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ??
      c,
  );
}

// ---------------------------------------------------------------------------
//  Send paths
// ---------------------------------------------------------------------------

async function sendViaResend(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
  mode: Mode;
}): Promise<boolean> {
  const client = resendClient();
  if (!client) return false;
  // Inline header logo, referenced as `cid:safwantiger-logo` from the
  // HTML. Falls back gracefully if the file is missing.
  const logoB64 = readLogoBase64();
  const attachments: Array<{
    filename: string;
    content: string;
    contentType: string;
    contentId?: string;
  }> = [];
  if (logoB64) {
    attachments.push({
      filename: LOGO_FILENAME,
      content: logoB64,
      contentType: 'image/png',
      contentId: LOGO_CID,
    });
  }
  try {
    const { data, error } = await client.emails.send({
      from: fromAddress(),
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      attachments: attachments.length ? attachments : undefined,
    });
    if (error) {
      const e = error as { name?: string; message?: string; statusCode?: number };
      const detail = [
        e.statusCode ? `statusCode=${e.statusCode}` : null,
        e.name ? `name=${e.name}` : null,
        e.message ? `message="${e.message}"` : null,
      ]
        .filter(Boolean)
        .join(' ');
      logger.error(
        { err: error, to: args.to, mode: args.mode, transport: 'resend' },
        `sendWelcomeEmail: Resend rejected — ${detail || 'unknown error'}`,
      );
      return false;
    }
    logger.info(
      { id: data?.id, to: args.to, mode: args.mode, transport: 'resend' },
      `sendWelcomeEmail: delivered via Resend (id=${data?.id ?? 'unknown'})`,
    );
    return true;
  } catch (err) {
    const e = err as { name?: string; message?: string; statusCode?: number };
    const detail = [
      e.statusCode ? `statusCode=${e.statusCode}` : null,
      e.name ? `name=${e.name}` : null,
      e.message ? `message="${e.message}"` : null,
    ]
      .filter(Boolean)
      .join(' ');
    logger.error(
      { err, to: args.to, mode: args.mode, transport: 'resend' },
      `sendWelcomeEmail: Resend send threw — ${detail || 'unknown error'}`,
    );
    return false;
  }
}

async function sendViaSmtp(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
  mode: Mode;
}): Promise<boolean> {
  const tx = smtpTransporter();
  if (!tx) return false;
  // Inline the header logo only — confirmation emails no longer carry
  // an explanatory PDF (users now request reports on demand from the
  // bot's My Orders / My Deposits / Stats screens).
  const smtpAttachments: Array<{
    filename: string;
    path: string;
    contentType: string;
    cid?: string;
  }> = [
    {
      filename: LOGO_FILENAME,
      path: EMAIL_LOGO_PATH,
      contentType: 'image/png',
      cid: LOGO_CID,
    },
  ];
  try {
    const info = await tx.sendMail({
      from: fromAddress(),
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      attachments: smtpAttachments,
    });
    logger.info(
      {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
        to: args.to,
        mode: args.mode,
        transport: 'smtp',
      },
      `sendWelcomeEmail: delivered via SMTP (${info.response ?? 'ok'})`,
    );
    return true;
  } catch (err) {
    const e = err as {
      code?: string;
      command?: string;
      response?: string;
      responseCode?: number;
      message?: string;
    };
    const detail = [
      e.code ? `code=${e.code}` : null,
      e.responseCode ? `responseCode=${e.responseCode}` : null,
      e.command ? `command=${e.command}` : null,
      e.response ? `response="${e.response.replace(/\s+/g, ' ').trim()}"` : null,
      e.message ? `message="${e.message}"` : null,
    ]
      .filter(Boolean)
      .join(' ');
    logger.error(
      { err, to: args.to, mode: args.mode, transport: 'smtp' },
      `sendWelcomeEmail: SMTP send failed — ${detail || 'unknown error'}`,
    );
    return false;
  }
}

/**
 * Send the welcome / confirmation email. Returns `true` on success,
 * `false` if no transport is configured or the active transport
 * rejected the send. Never throws — fire-and-forget from the caller.
 *
 * `mode='change'` switches the subject + copy to the "your email
 * was updated" variant and includes the previous address (if known)
 * so users can spot unauthorised changes.
 */
export async function sendWelcomeEmail(args: {
  email: string;
  previousEmail?: string | null;
  firstName: string | null;
  username: string | null;
  mode?: Mode;
}): Promise<boolean> {
  if (!resendConfigured() && !smtpConfigured()) {
    logger.warn(
      { email: args.email },
      'sendWelcomeEmail: no transport configured — set RESEND_API_KEY (preferred) or SMTP_HOST/PORT/USER/PASS',
    );
    return false;
  }
  const mode: Mode = args.mode ?? 'set';
  const { html, text, subject } = welcomeBody({
    email: args.email,
    previousEmail: args.previousEmail ?? null,
    firstName: args.firstName,
    username: args.username,
    mode,
  });
  // Resend wins when both are configured — it's the only path that
  // actually works on Railway / Heroku / Fly / Vercel. Operators can
  // remove RESEND_API_KEY to force the SMTP path on self-hosted boxes.
  if (resendConfigured()) {
    return sendViaResend({ to: args.email, subject, html, text, mode });
  }
  return sendViaSmtp({ to: args.email, subject, html, text, mode });
}

/**
 * Quick health-check helper called from `src/index.ts` at startup.
 * Logs the chosen transport once so operators can immediately see
 * whether welcome emails will go out, without needing to trigger the
 * flow. For SMTP it also runs a `verify()` probe so auth/connection
 * problems surface at boot rather than only on the first send.
 */
/**
 * Plain-text snapshot of the active mail transport, suitable for the
 * admin `/mailerstatus` command. Mirrors the diagnostic output that
 * `logMailerStatus()` writes to the logs at boot.
 */
export function describeMailerStatus(): string {
  const lines: string[] = [`From: ${fromAddress()}`];
  if (resendConfigured()) {
    lines.push(
      'Transport: Resend (HTTPS API)',
      'RESEND_API_KEY: set',
      `RESEND_FROM: ${env.RESEND_FROM ? 'set' : 'unset (using fallback)'}`,
      'Welcome emails: enabled',
    );
    return lines.join('\n');
  }
  if (smtpConfigured()) {
    lines.push(
      'Transport: SMTP',
      `SMTP_HOST: ${env.SMTP_HOST}`,
      `SMTP_PORT: ${env.SMTP_PORT}`,
      `SMTP_USER: ${env.SMTP_USER}`,
      'SMTP_PASS: set',
      'Welcome emails: enabled (note: raw SMTP is blocked by Railway / Heroku / Fly / Vercel — set RESEND_API_KEY instead)',
    );
    return lines.join('\n');
  }
  lines.push(
    'Transport: NONE — welcome emails are disabled',
    'Set RESEND_API_KEY (preferred) or SMTP_HOST/PORT/USER/PASS in your environment to enable delivery from shopbot@safwantiger.com.',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
//  On-demand report emails (My Orders / My Deposits / My Stats PDFs)
// ---------------------------------------------------------------------------

export type ReportKind = 'orders' | 'deposits' | 'stats';

const REPORT_TITLES: Record<ReportKind, string> = {
  orders: 'My Orders',
  deposits: 'My Deposits',
  stats: 'My Stats',
};

const REPORT_INTROS: Record<ReportKind, string> = {
  orders:
    "Here's a full PDF copy of every order on your SafwanTiger Shop account. Each order includes its product, quantity, total, status and timestamp.",
  deposits:
    "Here's a full PDF copy of every deposit and wallet ledger entry on your SafwanTiger Shop account. Approved totals are summarised on the cover page.",
  stats:
    "Here's a PDF snapshot of your SafwanTiger Shop account stats — total orders, items, spend, deposits and last-order timestamp.",
};

function reportBody(args: {
  kind: ReportKind;
  email: string;
  firstName: string | null;
  username: string | null;
  generatedAt: string;
}): { html: string; text: string; subject: string } {
  const title = REPORT_TITLES[args.kind];
  const intro = REPORT_INTROS[args.kind];
  const subject = `SafwanTiger Shop — your ${title} report`;
  const greeting = args.firstName
    ? `Hi ${args.firstName},`
    : args.username
      ? `Hi @${args.username},`
      : 'Hello,';

  const lines = [
    greeting,
    '',
    intro,
    '',
    `Generated: ${args.generatedAt}`,
    '',
    'You requested this PDF from the SafwanTiger Shop Telegram bot. If',
    "this wasn't you, reply to this email so we can secure your account.",
    '',
    '— SafwanTiger Shop',
    'https://t.me/safwantigershopbot',
  ];
  const text = lines.join('\n');

  const logoBlock = `
    <!--[if mso]>
    <v:oval xmlns:v="urn:schemas-microsoft-com:vml" style="width:56pt;height:56pt;" stroked="t" strokeweight="1.5pt" strokecolor="#d4a574" fillcolor="#0a0a0a"><v:fill type="frame" src="cid:${LOGO_CID}"/></v:oval>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <img src="cid:${LOGO_CID}" alt="SafwanTiger Shop" width="56" height="56" style="display:block;width:56px;height:56px;border:1.5px solid #d4a574;border-radius:50%;background:#0a0a0a;object-fit:cover;">
    <!--<![endif]-->`;

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#070707;font-family:'SF Pro Display',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#d8d3c8;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#070707;">
    ${escapeHtml(`Your ${title} PDF report is attached.`)}
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#070707;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#0f0f10;border:1px solid rgba(212,165,116,0.20);border-radius:18px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.55);">
        <tr><td style="height:2px;line-height:2px;font-size:0;background:linear-gradient(90deg,rgba(212,165,116,0) 0%,#d4a574 50%,rgba(212,165,116,0) 100%);">&nbsp;</td></tr>
        <tr><td align="center" style="padding:40px 36px 28px 36px;background:#0a0a0a;">
          ${logoBlock}
          <div style="font-size:10px;letter-spacing:.32em;text-transform:uppercase;color:#d4a574;font-weight:600;margin-top:18px;">SafwanTiger Shop</div>
          <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8a8378;margin-top:4px;font-weight:500;">Report ready</div>
          <div style="font-size:26px;color:#f5f1e8;font-weight:600;margin-top:18px;letter-spacing:-0.015em;line-height:1.25;">Your ${escapeHtml(title)} report</div>
        </td></tr>
        <tr><td style="height:1px;line-height:1px;font-size:0;background:rgba(212,165,116,0.16);">&nbsp;</td></tr>
        <tr><td style="padding:32px 36px 10px 36px;">
          <p style="margin:0 0 16px 0;color:#f5f1e8;font-size:15px;line-height:1.6;font-weight:500;">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 22px 0;font-size:15px;line-height:1.7;color:#d8d3c8;">${escapeHtml(intro)}</p>
        </td></tr>
        <tr><td style="padding:0 36px 22px 36px;">
          <div style="padding:16px 20px;border-radius:10px;background:#16151a;border:1px solid rgba(255,255,255,0.06);font-size:13px;color:#8a8378;line-height:1.7;">
            <span style="color:#d4a574;font-weight:600;letter-spacing:.04em;text-transform:uppercase;font-size:10px;">Attached</span><br>
            <span style="color:#f5f1e8;font-weight:500;">SafwanTiger-Shop-${escapeHtml(args.kind)}.pdf</span>
            <span style="color:#5a5550;"> · generated ${escapeHtml(args.generatedAt)}</span>
          </div>
        </td></tr>
        <tr><td style="padding:0 36px 28px 36px;">
          <div style="padding:16px 20px;border-radius:10px;background:rgba(212,165,116,0.06);border:1px solid rgba(212,165,116,0.22);font-size:13px;color:#d8d3c8;line-height:1.7;">
            <strong style="color:#e6c08c;font-weight:600;letter-spacing:.02em;">Heads up.</strong> You requested this PDF from the SafwanTiger Shop Telegram bot. If this wasn't you, <a href="mailto:shopbot@safwantiger.com?subject=Report%20I%20did%20not%20request" style="color:#e6c08c;text-decoration:underline;text-underline-offset:2px;">reply to this email</a> so we can secure your account.
          </div>
        </td></tr>
        <tr><td style="height:1px;line-height:1px;font-size:0;background:rgba(255,255,255,0.06);">&nbsp;</td></tr>
        <tr><td align="center" style="padding:24px 36px 28px 36px;background:#0a0a0a;">
          <div style="font-size:13px;color:#d8d3c8;line-height:1.6;font-weight:500;">SafwanTiger Shop Team</div>
          <div style="margin-top:6px;font-size:13px;color:#8a8378;line-height:1.6;">
            <a href="https://t.me/safwantigershopbot" style="color:#e6c08c;text-decoration:none;">@safwantigershopbot</a>
            <span style="color:#3a3631;">&nbsp;·&nbsp;</span>
            <a href="mailto:shopbot@safwantiger.com" style="color:#8a8378;text-decoration:none;">shopbot@safwantiger.com</a>
          </div>
          <p style="margin:16px 0 0 0;font-size:11px;color:#5a5550;line-height:1.6;letter-spacing:.01em;">
            This is an automated message confirming a report you requested through the SafwanTiger Shop Telegram bot. Please don't share this email with anyone.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { html, text, subject };
}

/**
 * Send a generated PDF report (orders / deposits / stats) to the
 * user's email. Returns true on send success, false otherwise — never
 * throws. The caller (Telegram callback handler) decides what to show
 * the user.
 */
export async function sendReportEmail(args: {
  email: string;
  kind: ReportKind;
  pdf: Buffer;
  firstName: string | null;
  username: string | null;
}): Promise<boolean> {
  if (!resendConfigured() && !smtpConfigured()) {
    logger.warn(
      { email: args.email, kind: args.kind },
      'sendReportEmail: no transport configured — set RESEND_API_KEY (preferred) or SMTP_HOST/PORT/USER/PASS',
    );
    return false;
  }
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const { html, text, subject } = reportBody({
    kind: args.kind,
    email: args.email,
    firstName: args.firstName,
    username: args.username,
    generatedAt,
  });
  const filename = `SafwanTiger-Shop-${args.kind}.pdf`;

  if (resendConfigured()) {
    const client = resendClient();
    if (!client) return false;
    const logoB64 = readLogoBase64();
    const attachments: Array<{
      filename: string;
      content: string;
      contentType: string;
      contentId?: string;
    }> = [
      {
        filename,
        content: args.pdf.toString('base64'),
        contentType: 'application/pdf',
      },
    ];
    if (logoB64) {
      attachments.push({
        filename: LOGO_FILENAME,
        content: logoB64,
        contentType: 'image/png',
        contentId: LOGO_CID,
      });
    }
    try {
      const { data, error } = await client.emails.send({
        from: fromAddress(),
        to: args.email,
        subject,
        html,
        text,
        attachments,
      });
      if (error) {
        const e = error as { name?: string; message?: string; statusCode?: number };
        logger.error(
          { err: error, to: args.email, kind: args.kind, transport: 'resend' },
          `sendReportEmail: Resend rejected — statusCode=${e.statusCode} message="${e.message}"`,
        );
        return false;
      }
      logger.info(
        { id: data?.id, to: args.email, kind: args.kind, transport: 'resend' },
        `sendReportEmail: delivered via Resend (id=${data?.id ?? 'unknown'})`,
      );
      return true;
    } catch (err) {
      logger.error(
        { err, to: args.email, kind: args.kind, transport: 'resend' },
        'sendReportEmail: Resend send threw',
      );
      return false;
    }
  }

  // SMTP fallback
  const tx = smtpTransporter();
  if (!tx) return false;
  try {
    const info = await tx.sendMail({
      from: fromAddress(),
      to: args.email,
      subject,
      html,
      text,
      attachments: [
        {
          filename,
          content: args.pdf,
          contentType: 'application/pdf',
        },
        {
          filename: LOGO_FILENAME,
          path: EMAIL_LOGO_PATH,
          contentType: 'image/png',
          cid: LOGO_CID,
        },
      ],
    });
    logger.info(
      { messageId: info.messageId, to: args.email, kind: args.kind, transport: 'smtp' },
      'sendReportEmail: delivered via SMTP',
    );
    return true;
  } catch (err) {
    logger.error(
      { err, to: args.email, kind: args.kind, transport: 'smtp' },
      'sendReportEmail: SMTP send failed',
    );
    return false;
  }
}

export function logMailerStatus(): void {
  if (resendConfigured()) {
    logger.info(
      { from: fromAddress() },
      'mailer: Resend configured — welcome emails enabled (HTTPS API)',
    );
    // Resend has no "verify" API; the first `emails.send` will tell
    // us if the API key / domain are valid. We log once at boot and
    // rely on the verbose error in sendViaResend for diagnostics.
    return;
  }
  if (smtpConfigured()) {
    logger.info(
      { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER },
      'mailer: SMTP configured — welcome emails enabled (raw SMTP; may be blocked on cloud platforms)',
    );
    void (async () => {
      const tx = smtpTransporter();
      if (!tx) return;
      try {
        await tx.verify();
        logger.info('mailer: SMTP verify ok — relay accepted credentials');
      } catch (err) {
        const e = err as {
          code?: string;
          response?: string;
          responseCode?: number;
          message?: string;
        };
        const detail = [
          e.code ? `code=${e.code}` : null,
          e.responseCode ? `responseCode=${e.responseCode}` : null,
          e.response ? `response="${e.response.replace(/\s+/g, ' ').trim()}"` : null,
          e.message ? `message="${e.message}"` : null,
        ]
          .filter(Boolean)
          .join(' ');
        logger.error(
          { err },
          `mailer: SMTP verify FAILED — ${detail || 'unknown error'} (welcome emails will not deliver until this is fixed; consider setting RESEND_API_KEY instead)`,
        );
      }
    })();
    return;
  }
  logger.warn(
    'mailer: no transport configured — welcome emails disabled (set RESEND_API_KEY (preferred) or SMTP_HOST/PORT/USER/PASS)',
  );
}
