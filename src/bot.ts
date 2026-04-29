import { Bot } from 'grammy';
import { env } from './env.js';
import { logger } from './logger.js';
import { sessionMiddleware, type SessionCtx } from './middleware/session.js';
import { userMiddleware, type AppCtx } from './middleware/user.js';
import { registerStart } from './handlers/start.js';
import { registerShop } from './handlers/shop.js';
import { registerProfile } from './handlers/profile.js';
import { registerSupport } from './handlers/support.js';
import { registerTopup } from './handlers/topup.js';
import { adminBot } from './handlers/admin/index.js';
import { refreshSettings } from './services/settings.js';

export async function buildBot(): Promise<Bot<AppCtx>> {
  const bot = new Bot<AppCtx>(env.BOT_TOKEN);

  // Order matters: session → user (which depends on session) → handlers.
  bot.use(sessionMiddleware as unknown as (ctx: SessionCtx, next: () => Promise<void>) => Promise<void>);
  bot.use(userMiddleware);

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

  // Public users see only /start in the slash-menu.
  await bot.api.setMyCommands([{ command: 'start', description: 'Open the main menu' }]);

  // The admin gets /admin too, scoped to their private chat so it
  // doesn't leak into the public command list.
  if (env.ADMIN_USER_ID) {
    try {
      await bot.api.setMyCommands(
        [
          { command: 'start', description: 'Open the main menu' },
          { command: 'admin', description: 'Open the admin dashboard' },
        ],
        { scope: { type: 'chat', chat_id: env.ADMIN_USER_ID } },
      );
    } catch (err) {
      logger.warn({ err }, 'Could not set admin-scoped commands');
    }
  }

  return bot;
}
