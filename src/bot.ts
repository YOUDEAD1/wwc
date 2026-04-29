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
    logger.error({ err: err.error }, 'Unhandled bot error');
  });

  // Pre-load admin-editable settings into memory.
  await refreshSettings();

  // Set Telegram bot commands so they appear in the menu hint.
  await bot.api.setMyCommands([
    { command: 'start', description: 'Open the main menu' },
    { command: 'menu', description: 'Show the main menu' },
    { command: 'admin', description: 'Admin commands (admin only)' },
  ]);

  return bot;
}
