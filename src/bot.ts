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
import { registerResellerApi } from './handlers/resellerApi.js';
import { registerPublicGroup } from './handlers/publicGroup.js';
import { adminBot } from './handlers/admin/index.js';
import { superAdminBot } from './handlers/superAdmin.js';

export type BotOptions = {
  isTenant?: boolean;
};

export async function buildBot(opts: BotOptions = {}): Promise<Bot<AppCtx>> {
  const isTenant = opts.isTenant === true;
  const bot = new Bot<AppCtx>(env.BOT_TOKEN);

  bot.use(sessionMiddleware as unknown as (ctx: SessionCtx, next: () => Promise<void>) => Promise<void>);
  bot.use(userMiddleware);
  bot.use(banMiddleware);

  registerStart(bot);
  registerShop(bot);
  registerProfile(bot);
  registerSupport(bot);
  registerTopup(bot);
  registerDirectPay(bot);
  registerResellerApi(bot);
  registerPublicGroup(bot);
  bot.use(adminBot);

  // Super Admin panel — فقط على البوت الرئيسي
  if (!isTenant) {
    bot.use(superAdminBot);
  }

  bot.catch((err) => {
    const msg = (err.error as { description?: string } | undefined)?.description ?? '';
    if (msg.includes('message is not modified')) return;
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