/**
 * Loads the user from Supabase (creating them on first contact) and
 * attaches `ctx.user` + `ctx.lang` + `ctx.t()` for handlers.
 */
import type { MiddlewareFn } from 'grammy';
import type { Lang } from '../../config/index.js';
import { getOrCreateUser } from '../db/queries.js';
import { env } from '../env.js';
import { t as translate } from '../i18n/index.js';
import type { DBUser } from '../types.js';
import type { SessionCtx } from './session.js';
import { maybeSendEmailNag } from '../services/emailNag.js';

export type AppCtx = SessionCtx & {
  user: DBUser;
  lang: Lang;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

/**
 * Look at the most recent /start payload (if any) for a referral code
 * like `?start=R12AB`. Stored on the user via getOrCreateUser.
 */
function extractReferral(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.match(/^\/start(?:@\S+)?\s+R([A-Z0-9]+)/i);
  if (!m) return null;
  const id = parseInt(m[1]!, 36);
  return Number.isFinite(id) ? id : null;
}

export const userMiddleware: MiddlewareFn<AppCtx> = async (ctx, next) => {
  if (!ctx.from) return next();
  const referred_by = extractReferral(ctx.message?.text ?? undefined);

  const user = await getOrCreateUser({
    telegram_id: ctx.from.id,
    username: ctx.from.username ?? null,
    first_name: ctx.from.first_name ?? null,
    last_name: ctx.from.last_name ?? null,
    language: env.DEFAULT_LANG,
    referred_by,
  });

  ctx.user = user;
  ctx.lang = user.language;
  ctx.t = (key, vars) => translate(ctx.lang, key, vars);

  // Fire-and-forget the 12h email nag.
  void maybeSendEmailNag(ctx);

  // If this is a newly created user with a referrer, send notification to bot channel
  if (
    (user as DBUser & { __just_created?: boolean }).__just_created &&
    user.referred_by &&
    env.BOT_REFERS_CHANNEL
  ) {
    void sendReferralNotification(ctx, user.referred_by, ctx.from.id, ctx.from.username ?? null, ctx.from.first_name);
  }

  return next();
};

/**
 * Send referral notification to the bot refers channel
 */
async function sendReferralNotification(
  ctx: AppCtx,
  referrerId: number,
  refereeId: number,
  refereeUsername: string | null,
  refereeFirstName: string | null,
) {
  const { getUserByTelegramId } = await import('../db/queries.js');
  const { countReferrals } = await import('../db/queries.js');

  const referrer = await getUserByTelegramId(referrerId);
  if (!referrer || !env.BOT_REFERS_CHANNEL) return;

  const referrerUsername = referrer.username ? `@${referrer.username}` : referrer.first_name ?? `User ${referrer.telegram_id}`;
  const refereeDisplay = refereeUsername ? `@${refereeUsername}` : refereeFirstName ?? `User ${refereeId}`;

  // Get total referrals count
  const totalRefs = await countReferrals(referrerId);
  const remaining = Math.max(0, 10 - totalRefs);

  const notificationMsg = `📈 *New Active Referral!*

👤 *Referrer:* ${referrerUsername}
🫠 *Refer to:* ${refereeDisplay}
✅ *Active Referrals:* ${totalRefs}
⏳ *${remaining} more to earn $0.50*`;

  await ctx.api.sendMessage(env.BOT_REFERS_CHANNEL, notificationMsg, { parse_mode: 'Markdown' }).catch(() => {});
}
