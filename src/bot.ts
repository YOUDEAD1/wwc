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
import { adminBot } from './handlers/admin/index.js';
import { refreshSettings } from './services/settings.js';
import { seedDefaultPaymentMethods } from './services/seed.js';

export async function buildBot(): Promise<Bot<AppCtx>> {
  const bot = new Bot<AppCtx>(env.BOT_TOKEN);

  // Order matters: session → user (which depends on session) → ban
  // (which depends on the loaded user row) → handlers.
  bot.use(sessionMiddleware as unknown as (ctx: SessionCtx, next: () => Promise<void>) => Promise<void>);
  bot.use(userMiddleware);
  bot.use(banMiddleware);

  registerStart(bot);
  registerShop(bot);
  registerProfile(bot);
  registerSupport(bot);
  registerTopup(bot);
  bot.use(adminBot);

  bot.catch((err) => {
    // "message is not modified" fires whenever the user taps a button
    // that re-renders the exact same screen — purely cosmetic and harmless.
    const msg = (err.error as { description?: string } | undefined)?.description ?? '';
    if (msg.includes('message is not modified')) return;
    logger.error({ err: err.error }, 'Unhandled bot error');
  });

  // Pre-load admin-editable settings into memory.
  await refreshSettings();

  // First-run seed: drop in default Binance Pay + USDT (BEP-20)
  // payment methods if the table is empty.
  await seedDefaultPaymentMethods();

  // Rehydrate any in-flight Live Support session from the DB so a
  // Render redeploy mid-session doesn't break the user→admin relay.
  await restoreLiveSupportSession();

  // Slash-menu shows only /start to everyone. /admin and /menu still
  // work as typed commands but are intentionally hidden.
  await bot.api.setMyCommands([{ command: 'start', description: 'Open the main menu' }]);

  // Wipe any lingering admin-scoped commands left over from earlier
  // versions of the bot (so /admin doesn't show up in the popup for
  // the admin either).
  if (env.ADMIN_USER_ID) {
    try {
      await bot.api.deleteMyCommands({
        scope: { type: 'chat', chat_id: env.ADMIN_USER_ID },
      });
    } catch (err) {
      logger.debug({ err }, 'No admin-scoped commands to delete');
    }
  }

  return bot;
}
