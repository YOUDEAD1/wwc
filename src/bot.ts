import { Bot } from 'grammy';
import { env } from './env.js';
import { logger } from './logger.js';
import { sessionMiddleware, type SessionCtx } from './middleware/session.js';
import { userMiddleware, type AppCtx } from './middleware/user.js';
import { banMiddleware } from './middleware/ban.js';
import { registerStart } from './handlers/start.js';
import { registerShop } from './handlers/shop.js';
import { registerProfile } from './handlers/profile.js';
import { registerSupport, restoreLiveSupportSession } from './handlers/support.js';
import { registerTopup } from './handlers/topup.js';
import { registerDirectPay } from './handlers/directPay.js';
// import { registerResellerApi } from './handlers/resellerApi.js';
import { registerPublicGroup } from './handlers/publicGroup.js';
import { adminBot } from './handlers/admin/index.js';
import { superAdminBot } from './handlers/superAdmin.js';

export type BotOptions = {
  isTenant?: boolean;
};

export async function buildBot(opts: BotOptions = {}): Promise<Bot<AppCtx>> {
  const isTenant = opts.isTenant === true;
  const bot = new Bot<AppCtx>(env.BOT_TOKEN);

  // منظم تسلسلي لكل مستخدم لمنع التعارض والعمليات المتكررة وتخفيف الضغط
  const userLocks = new Map<number, Promise<void>>();
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const prevPromise = userLocks.get(userId) || Promise.resolve();

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutId = setTimeout(() => {
        logger.warn({ userId }, 'User request queue lock timed out');
        resolve();
      }, 15000);
    });

    let resolveLock: () => void;
    const newPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });

    userLocks.set(userId, newPromise);

    try {
      await Promise.race([prevPromise, timeoutPromise]);
      if (timeoutId) clearTimeout(timeoutId);
      await next();
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      resolveLock!();
      if (userLocks.get(userId) === newPromise) {
        userLocks.delete(userId);
      }
    }
  });

  bot.use(sessionMiddleware as unknown as (ctx: SessionCtx, next: () => Promise<void>) => Promise<void>);
  bot.use(userMiddleware);
  bot.use(banMiddleware);

  // ===== Forced Subscription Middleware =====
  bot.use(async (ctx, next) => {
    // Only intercept messages and callback queries
    if (!ctx.message && !ctx.callbackQuery) {
      return next();
    }

    // Bypass if the user is an admin
    const userId = ctx.from?.id;
    if (userId) {
      const { isAdmin } = await import('./db/queries.js');
      const admin = await isAdmin(userId).catch(() => false);
      if (admin) return next();
    }

    // Allow start command and forcesub check callback
    const text = ctx.message?.text ?? '';
    if (text.startsWith('/start')) {
      return next();
    }
    const data = ctx.callbackQuery?.data ?? '';
    if (data === 'forcesub:check' || data.startsWith('startlang:')) {
      return next();
    }

    // Check subscription
    if (userId) {
      const { enforceSubscription } = await import('./services/forceSub.js');
      const subCheck = await enforceSubscription(ctx.api, userId);
      if (!subCheck.pass) {
        if (ctx.callbackQuery) {
          await ctx.answerCallbackQuery({
            text: '⛔ يجب الاشتراك في القناة أولاً لتتمكن من استخدام البوت!',
            show_alert: true,
          });
        } else {
          const { InlineKeyboard } = await import('grammy');
          const { renderMdHtml } = await import('./services/premium.js');
          const kb = new InlineKeyboard();
          let idx = 1;
          for (const ch of subCheck.channels) {
            const channelLink = ch.startsWith('@')
              ? `https://t.me/${ch.slice(1)}`
              : `https://t.me/c/${ch.replace('-100', '')}`;
            kb.url(`📢 اشترك في القناة ${idx++}`, channelLink).row();
          }
          kb.text('✅ اشتركت، تحقق الآن', 'forcesub:check');
          await ctx.reply(
            renderMdHtml(subCheck.message),
            { parse_mode: 'HTML', reply_markup: kb },
          );
        }
        return;
      }
    }

    return next();
  });

  // ===== Chat Member Leave Handler =====
  bot.on('chat_member', async (ctx) => {
    const update = ctx.chatMember;
    const oldStatus = update.old_chat_member.status;
    const newStatus = update.new_chat_member.status;
    const targetUserId = update.new_chat_member.user.id;
    const channelId = update.chat.id;

    const leftStatuses = ['left', 'kicked'];
    const isLeft = leftStatuses.includes(newStatus) && !leftStatuses.includes(oldStatus);

    if (isLeft) {
      const { getForceSub } = await import('./services/forceSub.js');
      const config = await getForceSub();
      
      const isFsubChannel = 
        config.channelId === String(channelId) || 
        (config.channels && config.channels.some(c => c === String(channelId) || c === `@${update.chat.username}`));

      if (isFsubChannel) {
        logger.info({ userId: targetUserId, channelId }, 'User left forced subscription channel, invalidating referral');
        const { invalidateReferral } = await import('./services/forceSub.js');
        await invalidateReferral(ctx.api, targetUserId);
      }
    }
  });

  registerStart(bot);
  registerShop(bot);
  registerProfile(bot);
  registerSupport(bot);
  registerTopup(bot);
  registerDirectPay(bot);
  // registerResellerApi(bot);
  registerPublicGroup(bot);
  bot.use(adminBot);

  // Super Admin panel — فقط على البوت الرئيسي
  if (!isTenant) {
    bot.use(superAdminBot);
  }

  bot.catch((err) => {
    const msg = (err.error as { description?: string } | undefined)?.description ?? '';
    if (msg.includes('message is not modified')) return;
    if (msg.includes('query is too old') || msg.includes('query ID is invalid')) return;
    if (msg.includes('blocked by the user') || msg.includes('chat not found') || msg.includes('user is deactivated')) return;
    logger.error({ err: err.error }, 'Unhandled bot error');
  });

  if (!isTenant) {
    await restoreLiveSupportSession();
  }

  try {
    await bot.api.setMyCommands([{ command: 'start', description: 'Open the main menu' }]);
  } catch { /* ignore */ }

  const adminId = env.ADMIN_USER_ID;
  if (adminId) {
    try {
      await bot.api.sendChatAction(adminId, 'typing');
      logger.info({ adminUserId: adminId }, 'live-support: admin chat reachable');
    } catch (err) {
      logger.warn({ err, adminUserId: adminId }, 'live-support: admin chat not reachable');
    }
  }

  return bot;
}