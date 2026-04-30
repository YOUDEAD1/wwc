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
