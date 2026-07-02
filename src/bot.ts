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