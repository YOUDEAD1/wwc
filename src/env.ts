import 'dotenv/config';
import { z } from 'zod';

// Accept either TELEGRAM_BOT_TOKEN (preferred) or BOT_TOKEN (legacy alias).
if (!process.env.TELEGRAM_BOT_TOKEN && process.env.BOT_TOKEN) {
  process.env.TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN;
}

// Same idea for SMTP — the production deploy uses generic SMTP_*
// names, but Devin's saved-secret manager stores the mailbox password
// under the more specific `SAFWANTIGER_SMTP_PASS` so it can be reused
// for other tooling. Either name works at runtime.
if (!process.env.SMTP_PASS && process.env.SAFWANTIGER_SMTP_PASS) {
  process.env.SMTP_PASS = process.env.SAFWANTIGER_SMTP_PASS;
}

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(10, 'TELEGRAM_BOT_TOKEN (or BOT_TOKEN) missing'),
  ADMIN_USER_ID: z.coerce.number().int().positive(),
  BOT_USERNAME: z.string().min(3),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  BOT_MODE: z.enum(['polling', 'webhook']).default('polling'),
  WEBHOOK_URL: z.string().url().optional().or(z.literal('')),
  WEBHOOK_SECRET: z.string().optional().or(z.literal('')),
  PORT: z.coerce.number().int().default(3000),

  DEFAULT_LANG: z.enum(['en', 'ar', 'vi']).default('en'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  OPENAI_API_KEY: z.string().optional().or(z.literal('')),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  // Binance Pay (auto-approval). When both key and secret are set, the
  // bot exposes Binance Pay as a payment provider and listens for
  // webhook callbacks at PUBLIC_BASE_URL/webhook/binance.
  BINANCE_PAY_API_KEY: z.string().optional().or(z.literal('')),
  BINANCE_PAY_API_SECRET: z.string().optional().or(z.literal('')),
  // Public HTTPS URL of this bot service (e.g. Railway domain). Used
  // as the Binance Pay returnUrl + webhookUrl. No trailing slash.
  PUBLIC_BASE_URL: z.string().url().optional().or(z.literal('')),

  // ----------------------------------------------------------------
  //  Outbound email (welcome / receipts / password-style notices)
  // ----------------------------------------------------------------
  // When all four SMTP_* values are present, the bot sends a
  // professionally written welcome email (with the Why-Email PDF
  // attached) the moment a user saves an address through the
  // Settings → Email Settings flow. If anything is missing the bot
  // silently skips the send and just logs a warning at startup.
  SMTP_HOST: z.string().optional().or(z.literal('')),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional().or(z.literal('')),
  SMTP_PASS: z.string().optional().or(z.literal('')),
  // Defaults to SMTP_USER when unset. Lets you send as
  // "SafwanTiger Shop <shopbot@safwantiger.com>" while authenticating
  // as the same mailbox.
  SMTP_FROM: z.string().optional().or(z.literal('')),
  SMTP_FROM_NAME: z.string().default('SafwanTiger Shop'),

  // ----------------------------------------------------------------
  //  Resend (HTTPS API) — preferred transport on cloud platforms
  //  that block raw SMTP egress (Railway, Heroku, Fly, Vercel...).
  // ----------------------------------------------------------------
  // When RESEND_API_KEY is set, the mailer uses Resend's HTTPS API
  // instead of nodemailer. This bypasses the SMTP-port firewall on
  // cloud platforms while preserving the same "From: shopbot@safwantiger.com"
  // identity (provided the safwantiger.com domain has been verified
  // in the Resend dashboard via DKIM + SPF DNS records).
  RESEND_API_KEY: z.string().optional().or(z.literal('')),
  // Defaults to "shopbot@safwantiger.com" if both this and SMTP_USER
  // are unset. Must be an address whose domain is verified in Resend.
  RESEND_FROM: z.string().optional().or(z.literal('')),

  // ----------------------------------------------------------------
  //  Deep-detail log channel
  // ----------------------------------------------------------------
  // Telegram chat to receive every "deep details" notification
  // emitted by `services/adminLog.ts` (orders, top-ups, support
  // sessions, support transcripts, PDF sends, language /
  // notification toggles, etc.). Accepts either:
  //
  //   - `@channelusername` for a public channel (e.g.
  //     `@safwantigershopsales`), OR
  //   - a numeric chat id starting with `-100…` for a private
  //     channel/supergroup (forward any message from it to
  //     @userinfobot to read the id).
  //
  // Falls back to `ADMIN_USER_ID` (admin DM) when unset so existing
  // deployments keep working with no migration needed. The bot must
  // be added to the channel as an admin with "Post Messages" +
  // "Manage Topics" permission for documents (transcripts) to land.
  LOG_CHAT_ID: z
    .string()
    .trim()
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return undefined;
      // Strip a leading `=` accidentally pasted from the env file
      // and any surrounding quotes.
      const cleaned = value.replace(/^["']|["']$/g, '').trim();
      if (cleaned === '') return undefined;
      // Numeric id (`-1001234567890`) — coerce to number so the
      // grammY API can use the integer fast-path.
      if (/^-?\d+$/.test(cleaned)) return Number(cleaned);
      // Otherwise treat as @channelusername (with or without the @).
      return cleaned.startsWith('@') ? cleaned : `@${cleaned}`;
    }),
});

// Provide a stable alias `BOT_TOKEN` on the parsed env for consumers.
export type EnvWithAlias = z.infer<typeof schema> & { BOT_TOKEN: string };

export type Env = EnvWithAlias;

export const env: Env = (() => {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return { ...parsed.data, BOT_TOKEN: parsed.data.TELEGRAM_BOT_TOKEN };
})();
