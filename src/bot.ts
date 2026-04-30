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
import { recordMessage } from './services/messageTracker.js';
import { callbackToButtonKey, playClick } from './services/clickSound.js';

export async function buildBot(): Promise<Bot<AppCtx>> {
  const bot = new Bot<AppCtx>(env.BOT_TOKEN);

  // Track every outgoing message we send into a chat so the user's
  // "Clear Cache" button (in Settings) can delete old menu / navigation
  // messages and speed the chat up. Order/delivery confirmations are
  // marked protected separately and won't be wiped.
  bot.api.config.use(async (prev, method, payload, signal) => {
    const result = await prev(method, payload, signal);
    if (result && typeof result === 'object') {
      const r = result as { message_id?: number; chat?: { id?: number } };
      if (typeof r.message_id === 'number' && typeof r.chat?.id === 'number') {
        recordMessage(r.chat.id, r.message_id);
      }
    }
    return result;
  });

  // Order matters: session → user (which depends on session) → handlers.
  bot.use(sessionMiddleware as unknown as (ctx: SessionCtx, next: () => Promise<void>) => Promise<void>);
  bot.use(userMiddleware);

  // Click-sound effect on every inline-button tap. Fired before the
  // actual handler runs (fire-and-forget) so the sound message lands
  // alongside the screen change rather than after it. Skipped when the
  // user has the master switch off OR has muted the specific button
  // category. Click-sound bubbles auto-delete after a few seconds.
  bot.on('callback_query', async (ctx, next) => {
    try {
      const u = ctx.user;
      const chatId = ctx.chat?.id;
      // Default to ON for users created before the click_sound columns
      // existed (Supabase will report `undefined` for missing columns).
      const masterOn = u?.click_sound !== false;
      if (masterOn && typeof chatId === 'number') {
        const key = callbackToButtonKey(ctx.callbackQuery?.data);
        const off = Array.isArray(u?.click_sound_off) ? u.click_sound_off : [];
        if (!off.includes(key)) {
          playClick(ctx.api, chatId);
        }
      }
    } catch (err) {
      logger.debug({ err }, 'click-sound middleware threw');
    }
    return next();
  });

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
