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

const PDF_FILENAME = 'why-we-need-your-email.pdf';

let pdfBase64Cache: string | null = null;
function readPdfBase64(): string | null {
  if (pdfBase64Cache) return pdfBase64Cache;
  try {
    pdfBase64Cache = fs.readFileSync(WHY_EMAIL_PDF_PATH).toString('base64');
    return pdfBase64Cache;
  } catch (err) {
    logger.error({ err, path: WHY_EMAIL_PDF_PATH }, 'mailer: could not read Why-Email PDF — sending without attachment');
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
      ? '🐯 SafwanTiger Shop — your email has been removed'
      : args.mode === 'change'
        ? '🐯 SafwanTiger Shop — your email has been updated'
        : '🐯 Welcome to SafwanTiger Shop — your email is connected';

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
      'third parties, or send unsolicited messages. The attached PDF',
      '"Why we need your email" goes into more detail.',
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
  const previousEmailBlock =
    args.mode === 'change' && args.previousEmail
      ? `<tr><td style="padding:0 28px 14px 28px;">
          <div style="padding:14px 16px;border-radius:8px;background:#0d1117;border:1px solid #30363d;font-size:13px;color:#7d8590;line-height:1.6;">
            Previous address on file: <span style="color:#c9d1d9;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(args.previousEmail)}</span>
          </div>
        </td></tr>`
      : '';

  const securityNote =
    args.mode === 'delete'
      ? "If you didn't just delete this address yourself, <a href=\"mailto:shopbot@safwantiger.com?subject=Unauthorised%20email%20deletion\" style=\"color:#fbbf24;text-decoration:underline;\">reply to this email immediately</a> so we can secure your account."
      : args.mode === 'change'
        ? "If you didn't just update this address yourself, <a href=\"mailto:shopbot@safwantiger.com?subject=Unauthorised%20email%20change\" style=\"color:#fbbf24;text-decoration:underline;\">reply to this email immediately</a> so we can secure your account."
        : "Didn't just save this address? <a href=\"mailto:shopbot@safwantiger.com?subject=Remove%20my%20email\" style=\"color:#fbbf24;text-decoration:underline;\">Reply to this email</a> and we'll remove it from your account.";

  const introCopy =
    args.mode === 'delete'
      ? `Just confirming: <strong style="color:#fbbf24;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(args.email)}</strong> has been deleted from the bot successfully. You will no longer receive receipts at this address.`
      : args.mode === 'change'
        ? `Just confirming: the email on file for your SafwanTiger Shop account has been updated to <strong style="color:#fbbf24;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(args.email)}</strong>.`
        : `Thanks for setting up your email with SafwanTiger Shop. We've securely linked <strong style="color:#fbbf24;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(args.email)}</strong> to your Telegram account.`;

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#c9d1d9;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#0d1117;">
    ${escapeHtml(
      args.mode === 'delete'
        ? `Email ${args.email} has been removed from your account.`
        : args.mode === 'change'
          ? `Email on file changed to ${args.email}.`
          : `Welcome aboard — ${args.email} is now linked to your account.`,
    )}
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0d1117;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#161b22;border:1px solid #30363d;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.45);">
        <tr><td style="background:linear-gradient(135deg,#f97316 0%,#fbbf24 100%);padding:28px 32px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="vertical-align:middle;">
                <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#1c1917;font-weight:700;opacity:.85;">SafwanTiger Shop</div>
                <div style="font-size:13px;color:#1c1917;font-weight:600;margin-top:2px;opacity:.7;">${escapeHtml(headlineEyebrow)}</div>
              </td>
              <td align="right" style="vertical-align:middle;">
                <div style="font-size:34px;line-height:1;">🐯</div>
              </td>
            </tr>
          </table>
          <div style="font-size:26px;color:#1c1917;font-weight:800;margin-top:14px;letter-spacing:-0.01em;">${escapeHtml(headlineTitle)}</div>
        </td></tr>

        <tr><td style="padding:28px 32px 8px 32px;">
          <p style="margin:0 0 14px 0;color:#e6edf3;font-size:15px;line-height:1.6;">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;color:#c9d1d9;">${introCopy}</p>
        </td></tr>

        ${previousEmailBlock}

        ${
          args.mode === 'delete'
            ? `<tr><td style="padding:0 32px 18px 32px;">
                <p style="margin:0;font-size:14px;line-height:1.7;color:#c9d1d9;">
                  Need to re-link an email later? Open the bot any time and head to
                  <strong style="color:#fbbf24;">Settings → Email Settings → Set Email</strong>.
                </p>
              </td></tr>`
            : `<tr><td style="padding:0 32px 18px 32px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:12px;background:#0d1117;border:1px solid #30363d;">
                  <tr><td style="padding:18px 22px;">
                    <div style="font-size:11px;color:#7d8590;text-transform:uppercase;letter-spacing:.12em;margin-bottom:12px;font-weight:600;">What this email is used for</div>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;line-height:1.7;color:#c9d1d9;">
                      <tr><td style="padding:4px 0;width:28px;vertical-align:top;">📦</td><td style="padding:4px 0;">Order receipts &amp; delivery confirmations</td></tr>
                      <tr><td style="padding:4px 0;width:28px;vertical-align:top;">🔐</td><td style="padding:4px 0;">Account recovery if you lose Telegram access</td></tr>
                      <tr><td style="padding:4px 0;width:28px;vertical-align:top;">⚠️</td><td style="padding:4px 0;">Critical security notices</td></tr>
                    </table>
                  </td></tr>
                </table>
              </td></tr>

              <tr><td style="padding:0 32px 18px 32px;">
                <p style="margin:0;font-size:14px;line-height:1.7;color:#c9d1d9;">
                  We will <strong style="color:#fbbf24;">never</strong> use this address for marketing or share it with anyone. The attached PDF goes into more detail.
                </p>
              </td></tr>`
        }

        <tr><td style="padding:0 32px 24px 32px;">
          <div style="padding:14px 16px;border-radius:8px;background:rgba(249,115,22,0.08);border:1px solid rgba(249,115,22,0.35);font-size:13px;color:#fde6c7;line-height:1.6;">
            <strong style="color:#fbbf24;">Security notice.</strong> ${securityNote}
          </div>
        </td></tr>

        <tr><td style="padding:18px 32px 24px 32px;border-top:1px solid #30363d;background:#0d1117;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="font-size:13px;color:#7d8590;line-height:1.6;">
                <span style="color:#c9d1d9;font-weight:600;">SafwanTiger Shop Team</span><br>
                <a href="https://t.me/safwantigershopbot" style="color:#fbbf24;text-decoration:none;">@safwantigershopbot</a>
                &nbsp;·&nbsp;
                <a href="mailto:shopbot@safwantiger.com" style="color:#7d8590;text-decoration:none;">shopbot@safwantiger.com</a>
              </td>
            </tr>
          </table>
          <p style="margin:14px 0 0 0;font-size:11px;color:#484f58;line-height:1.5;">
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
  // Only set / change emails attach the explanatory PDF — a deletion
  // confirmation should NOT carry it (the user just opted out).
  const pdfB64 = args.mode === 'delete' ? null : readPdfBase64();
  try {
    const { data, error } = await client.emails.send({
      from: fromAddress(),
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      attachments: pdfB64
        ? [
            {
              filename: PDF_FILENAME,
              content: pdfB64,
              contentType: 'application/pdf',
            },
          ]
        : undefined,
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
  try {
    const info = await tx.sendMail({
      from: fromAddress(),
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      // Skip the explanatory PDF for delete confirmations — see
      // sendViaResend() for the rationale.
      attachments:
        args.mode === 'delete'
          ? undefined
          : [
              {
                filename: PDF_FILENAME,
                path: WHY_EMAIL_PDF_PATH,
                contentType: 'application/pdf',
              },
            ],
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
