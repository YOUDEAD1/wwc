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

/**
 * Default Telegram chat for `LOG_CHAT_ID` when the env var is unset
 * or blank. Hard-coded to the bot owner's public sales channel so
 * fresh deployments route deep-detail notifications correctly with
 * zero configuration. Override per-deployment by setting
 * `LOG_CHAT_ID` explicitly (use `LOG_CHAT_ID=0` to opt out).
 */
const DEFAULT_LOG_CHAT = '@safwantigershopsales';

/**
 * Default Telegram chat for `ORDER_LOG_CHAT_ID` — the dedicated
 * "Orders" feed the bot owner asked to keep separate from the
 * generic shop-sales channel. Only `logOrderCreated` events flow
 * here; everything else (top-ups, support, settings, PDFs, etc.)
 * still goes to the main `LOG_CHAT_ID` channel.
 */
const DEFAULT_ORDER_LOG_CHAT = '@SafwanTigerShopBotInfo';

/**
 * Shared transformer for the `LOG_CHAT_ID` family of env vars. Each
 * one accepts the same input shapes — `@channelusername` (with or
 * without `@`), numeric `-100…` id, or an opt-out marker — and
 * resolves to a value the grammY API can use directly, falling back
 * to the supplied default when the env var is unset or blank.
 */
function logChannelTransformer(defaultValue: string) {
  return (value: string | undefined): number | string | undefined => {
    if (value === undefined) return defaultValue;
    const cleaned = value.replace(/^["']|["']$/g, '').trim();
    if (cleaned === '') return defaultValue;
    if (/^(0|off|none|disabled)$/i.test(cleaned)) return undefined;
    if (/^-?\d+$/.test(cleaned)) return Number(cleaned);
    return cleaned.startsWith('@') ? cleaned : `@${cleaned}`;
  };
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
  // Defaults to `@safwantigershopsales` (the bot owner's public log
  // channel) so a fresh deployment routes deep-detail notifications
  // to the channel without needing any env wiring. Set
  // `LOG_CHAT_ID=0` (or `off` / `none` / `disabled`) to opt out and
  // fall back to the admin DM. The bot must be added to the
  // channel as an admin with "Post Messages" + "Send Documents"
  // permission for transcripts to land.
  LOG_CHAT_ID: z
    .string()
    .trim()
    .optional()
    .transform(logChannelTransformer(DEFAULT_LOG_CHAT)),

  // ----------------------------------------------------------------
  //  Orders log channel
  // ----------------------------------------------------------------
  // Telegram chat that receives only product-order notifications
  // (`logOrderCreated`). Kept separate from `LOG_CHAT_ID` so the
  // owner can pin the orders channel for at-a-glance "what just
  // sold" visibility while leaving the noisier sales / support /
  // settings feed elsewhere. Same input shapes as `LOG_CHAT_ID`
  // (`@username`, numeric `-100…`, or `0` to opt out). When
  // `ORDER_LOG_CHAT_ID` is opted out, orders fall back to the main
  // `LOG_CHAT_ID` channel — and only after that, the admin DM.
  ORDER_LOG_CHAT_ID: z
    .string()
    .trim()
    .optional()
    .transform(logChannelTransformer(DEFAULT_ORDER_LOG_CHAT)),
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
