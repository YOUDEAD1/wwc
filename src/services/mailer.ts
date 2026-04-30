/**
 * Outbound email — wraps `nodemailer` and the project's SMTP_* env
 * vars into a tiny, fire-and-forget helper. The bot uses this for a
 * professional welcome message when a user saves their email through
 * Settings → Email Settings.
 *
 * Design notes:
 *   - All four SMTP_* vars are *optional*. If any are missing the
 *     module never connects; `sendWelcomeEmail` becomes a no-op that
 *     logs a single warning. This keeps local-dev / fresh deploys
 *     from breaking just because operator hasn't configured SMTP yet.
 *   - The transport is created lazily on first send and cached so
 *     `nodemailer`'s connection pool can be reused across requests.
 *   - Errors are caught and logged — saving the address must never
 *     fail just because the SMTP relay is down.
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
 * Falls back to the SMTP user when SMTP_FROM is unset.
 */
function fromAddress(): string {
  const addr = env.SMTP_FROM || env.SMTP_USER || '';
  const name = env.SMTP_FROM_NAME || 'SafwanTiger Shop';
  return `"${name}" <${addr}>`;
}

/**
 * Render the welcome email body (HTML + plain-text). Kept verbose
 * because the email is the user's first off-platform impression of
 * the shop and we want it to look polished without external CSS.
 */
function welcomeBody(args: {
  email: string;
  firstName: string | null;
  username: string | null;
}): { html: string; text: string; subject: string } {
  const greeting = args.firstName
    ? `Hi ${args.firstName},`
    : args.username
      ? `Hi @${args.username},`
      : 'Hi there,';

  const subject = '🐯 Welcome to SafwanTiger Shop — your email is now connected';

  const text = [
    greeting,
    '',
    'Thanks for setting up your email with SafwanTiger Shop. We have',
    `securely linked ${args.email} to your Telegram account.`,
    '',
    'What this email is used for:',
    '  • Order receipts and delivery confirmations',
    '  • Account recovery if you ever lose access to Telegram',
    '  • Critical security notices',
    '',
    'We will never use this address for marketing, share it with',
    'third parties, or send unsolicited messages. The attached PDF',
    '"Why we need your email" goes into more detail.',
    '',
    'If you did not just save this address in our bot, please reply',
    'to this email and we will remove it from your account.',
    '',
    'Welcome aboard,',
    'The SafwanTiger Shop Team',
    'https://t.me/safwantigershopbot',
  ].join('\n');

  // Keep HTML self-contained — every styled element uses inline CSS so
  // it renders the same in Gmail, Outlook, Apple Mail, etc.
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#c9d1d9;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0d1117;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#161b22;border:1px solid #30363d;border-radius:12px;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#f97316,#fbbf24);padding:24px 28px;">
          <div style="font-size:14px;letter-spacing:.16em;text-transform:uppercase;color:#1c1917;font-weight:600;">SafwanTiger Shop</div>
          <div style="font-size:24px;color:#1c1917;font-weight:700;margin-top:6px;">🐯 Email connected</div>
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 16px 0;color:#e6edf3;font-size:15px;line-height:1.6;">${greeting}</p>
          <p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;">
            Thanks for setting up your email with SafwanTiger Shop. We've
            securely linked <strong style="color:#fbbf24;">${escapeHtml(args.email)}</strong>
            to your Telegram account.
          </p>
          <div style="margin:0 0 18px 0;padding:16px 18px;border-radius:8px;background:#0d1117;border:1px solid #30363d;">
            <div style="font-size:13px;color:#7d8590;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Used for</div>
            <ul style="margin:0;padding:0 0 0 18px;font-size:14px;line-height:1.7;color:#c9d1d9;">
              <li>📦 Order receipts &amp; delivery confirmations</li>
              <li>🔐 Account recovery if you lose Telegram access</li>
              <li>⚠️ Critical security notices</li>
            </ul>
          </div>
          <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#c9d1d9;">
            We'll <strong style="color:#fbbf24;">never</strong> use it for marketing
            or share it with third parties. The attached PDF goes into more detail.
          </p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#7d8590;">
            Didn't just save this address? Reply to this email and we'll
            remove it from your account.
          </p>
        </td></tr>
        <tr><td style="padding:18px 28px 24px 28px;border-top:1px solid #30363d;background:#0d1117;">
          <div style="font-size:13px;color:#7d8590;line-height:1.6;">
            Welcome aboard,<br>
            <span style="color:#c9d1d9;">The SafwanTiger Shop Team</span><br>
            <a href="https://t.me/safwantigershopbot" style="color:#fbbf24;text-decoration:none;">@safwantigershopbot</a>
          </div>
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
 * Send the welcome confirmation email. Returns `true` on success,
 * `false` if SMTP is unconfigured or the relay rejected the send.
 * Never throws — the email is fire-and-forget from the caller's POV.
 */
export async function sendWelcomeEmail(args: {
  email: string;
  firstName: string | null;
  username: string | null;
}): Promise<boolean> {
  const tx = transporter();
  if (!tx) {
    logger.warn(
      { email: args.email },
      'sendWelcomeEmail: SMTP not configured — set SMTP_HOST/PORT/USER/PASS to enable welcome emails',
    );
    return false;
  }
  const { html, text, subject } = welcomeBody(args);
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
      { messageId: info.messageId, accepted: info.accepted, to: args.email },
      'sendWelcomeEmail: delivered',
    );
    return true;
  } catch (err) {
    logger.error({ err, to: args.email }, 'sendWelcomeEmail: send failed');
    return false;
  }
}

/**
 * Quick health-check helper called from `src/index.ts` at startup.
 * Logs the SMTP state once so operators can immediately see whether
 * welcome emails will go out, without needing to trigger the flow.
 */
export function logMailerStatus(): void {
  if (smtpConfigured()) {
    logger.info(
      { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER },
      'mailer: SMTP configured — welcome emails enabled',
    );
  } else {
    logger.warn(
      'mailer: SMTP not configured — welcome emails disabled (set SMTP_HOST/PORT/USER/PASS)',
    );
  }
}
