/**
 * Outbound email — wraps `nodemailer` and the project's SMTP_* env
 * vars into a tiny, fire-and-forget helper. The bot uses this to send
 * a polished welcome / confirmation email when a user saves OR
 * changes their address in Settings → Email Settings.
 *
 * Design notes:
 *   - All four SMTP_* vars are *optional*. If any are missing the
 *     module never connects; `sendWelcomeEmail` becomes a no-op that
 *     logs a single warning. This keeps local-dev / fresh deploys
 *     from breaking just because operator hasn't configured SMTP yet.
 *   - The transport is created lazily on first send and cached so
 *     `nodemailer`'s connection pool can be reused across requests.
 *   - SMTP errors are logged with their code AND text inline (in
 *     addition to pino's structured fields) so they surface in
 *     hosted-log viewers like Railway, which sometimes drop
 *     structured payloads when rendering.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';
import { env } from '../env.js';
import { logger } from '../logger.js';

/** Path to the bundled "Why we need your email" PDF. */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const WHY_EMAIL_PDF_PATH = path.resolve(
  __dirname,
  '../../../assets/email-explanation.pdf',
);

/** All four SMTP envs must be present for the mailer to do anything. */
function smtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS);
}

let cached: Transporter<SMTPPool.SentMessageInfo> | null = null;

function transporter(): Transporter<SMTPPool.SentMessageInfo> | null {
  if (!smtpConfigured()) return null;
  if (cached) return cached;
  cached = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 → implicit TLS; 587 → STARTTLS upgrade. nodemailer infers
    // the right behaviour from `secure` so we just key it off the port.
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER as string,
      pass: env.SMTP_PASS as string,
    },
    pool: true,
  });
  return cached;
}

/**
 * Build the canonical "From: SafwanTiger Shop <shopbot@…>" header.
 * Falls back to the SMTP user when SMTP_FROM is unset. Many SMTP
 * relays (Spacemail/PrivateEmail included) reject sends whose From:
 * domain doesn't match the authenticated user, so we always coerce
 * the from-address to the SMTP_USER mailbox.
 */
function fromAddress(): string {
  const addr = env.SMTP_USER || env.SMTP_FROM || '';
  const name = env.SMTP_FROM_NAME || 'SafwanTiger Shop';
  return `"${name}" <${addr}>`;
}

type Mode = 'set' | 'change';

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
    args.mode === 'change'
      ? '🐯 SafwanTiger Shop — your email has been updated'
      : '🐯 Welcome to SafwanTiger Shop — your email is connected';

  const headlineEyebrow =
    args.mode === 'change' ? 'Email updated' : 'Welcome aboard';
  const headlineTitle =
    args.mode === 'change' ? 'Your email was updated' : 'Your email is connected';

  // ---------- plain-text alternative ----------
  const lines: string[] = [
    greeting,
    '',
    args.mode === 'change'
      ? `Just confirming: the email on file for your SafwanTiger Shop account has been updated to ${args.email}.`
      : `Thanks for setting up your email with SafwanTiger Shop. We've securely linked ${args.email} to your Telegram account.`,
  ];
  if (args.mode === 'change' && args.previousEmail) {
    lines.push('', `Previous email on file: ${args.previousEmail}`);
  }
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
  const text = lines.join('\n');

  // ---------- HTML body ----------
  // Self-contained inline CSS so it renders identically across
  // Gmail / Outlook / Apple Mail / Yahoo / etc. The colour palette
  // (charcoal background + tiger-orange accents) matches the bot.
  const previousEmailBlock =
    args.mode === 'change' && args.previousEmail
      ? `<tr><td style="padding:0 28px 14px 28px;">
          <div style="padding:14px 16px;border-radius:8px;background:#0d1117;border:1px solid #30363d;font-size:13px;color:#7d8590;line-height:1.6;">
            Previous address on file: <span style="color:#c9d1d9;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(args.previousEmail)}</span>
          </div>
        </td></tr>`
      : '';

  const securityNote =
    args.mode === 'change'
      ? "If you didn't just update this address yourself, <a href=\"mailto:shopbot@safwantiger.com?subject=Unauthorised%20email%20change\" style=\"color:#fbbf24;text-decoration:underline;\">reply to this email immediately</a> so we can secure your account."
      : "Didn't just save this address? <a href=\"mailto:shopbot@safwantiger.com?subject=Remove%20my%20email\" style=\"color:#fbbf24;text-decoration:underline;\">Reply to this email</a> and we'll remove it from your account.";

  const introCopy =
    args.mode === 'change'
      ? `Just confirming: the email on file for your SafwanTiger Shop account has been updated to <strong style="color:#fbbf24;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(args.email)}</strong>.`
      : `Thanks for setting up your email with SafwanTiger Shop. We've securely linked <strong style="color:#fbbf24;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(args.email)}</strong> to your Telegram account.`;

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#c9d1d9;-webkit-font-smoothing:antialiased;">
  <!-- Hidden preheader text shown next to the subject in inbox lists -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#0d1117;">
    ${escapeHtml(args.mode === 'change' ? `Email on file changed to ${args.email}.` : `Welcome aboard — ${args.email} is now linked to your account.`)}
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0d1117;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#161b22;border:1px solid #30363d;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.45);">
        <!-- Header strip -->
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

        <!-- Greeting + intro -->
        <tr><td style="padding:28px 32px 8px 32px;">
          <p style="margin:0 0 14px 0;color:#e6edf3;font-size:15px;line-height:1.6;">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;color:#c9d1d9;">${introCopy}</p>
        </td></tr>

        ${previousEmailBlock}

        <!-- Used-for box -->
        <tr><td style="padding:0 32px 18px 32px;">
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

        <!-- Privacy reassurance -->
        <tr><td style="padding:0 32px 18px 32px;">
          <p style="margin:0;font-size:14px;line-height:1.7;color:#c9d1d9;">
            We will <strong style="color:#fbbf24;">never</strong> use this address for marketing or share it with anyone. The attached PDF goes into more detail.
          </p>
        </td></tr>

        <!-- Security notice -->
        <tr><td style="padding:0 32px 24px 32px;">
          <div style="padding:14px 16px;border-radius:8px;background:rgba(249,115,22,0.08);border:1px solid rgba(249,115,22,0.35);font-size:13px;color:#fde6c7;line-height:1.6;">
            <strong style="color:#fbbf24;">Security notice.</strong> ${securityNote}
          </div>
        </td></tr>

        <!-- Footer -->
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

/**
 * Send the welcome / confirmation email. Returns `true` on success,
 * `false` if SMTP is unconfigured or the relay rejected the send.
 * Never throws — the email is fire-and-forget from the caller's POV.
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
  const tx = transporter();
  if (!tx) {
    logger.warn(
      { email: args.email },
      'sendWelcomeEmail: SMTP not configured — set SMTP_HOST/PORT/USER/PASS to enable welcome emails',
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
  try {
    const info = await tx.sendMail({
      from: fromAddress(),
      to: args.email,
      subject,
      text,
      html,
      attachments: [
        {
          filename: 'why-we-need-your-email.pdf',
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
        to: args.email,
        mode,
      },
      `sendWelcomeEmail: delivered (${info.response ?? 'ok'})`,
    );
    return true;
  } catch (err) {
    // SMTP errors carry a `code` (EAUTH / ECONNECTION / ETIMEDOUT
    // / ESOCKET / EENVELOPE / etc.) and a `response` from the relay.
    // Pull both into the human-readable line so they show up in
    // hosted-log viewers (Railway, Fly, etc.) which often drop
    // pino's structured payload from the visible message.
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
      { err, to: args.email, mode },
      `sendWelcomeEmail: send failed — ${detail || 'unknown error'}`,
    );
    return false;
  }
}

/**
 * Quick health-check helper called from `src/index.ts` at startup.
 * Logs the SMTP state once so operators can immediately see whether
 * welcome emails will go out, without needing to trigger the flow.
 *
 * Also asynchronously runs `transporter.verify()` so we surface
 * authentication / connection errors at boot rather than only on the
 * first user-triggered send.
 */
export function logMailerStatus(): void {
  if (!smtpConfigured()) {
    logger.warn(
      'mailer: SMTP not configured — welcome emails disabled (set SMTP_HOST/PORT/USER/PASS)',
    );
    return;
  }
  logger.info(
    { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER },
    'mailer: SMTP configured — welcome emails enabled',
  );
  // Fire-and-forget verify — non-blocking, just for early diagnostics.
  void (async () => {
    const tx = transporter();
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
        `mailer: SMTP verify FAILED — ${detail || 'unknown error'} (welcome emails will not deliver until this is fixed)`,
      );
    }
  })();
}
