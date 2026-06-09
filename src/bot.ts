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
import { refreshSettings } from './services/settings.js';

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
  registerDirectPay(bot);
  registerResellerApi(bot);
  registerPublicGroup(bot);
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

    // Live Support reachability probe: Telegram won't let the bot
    // initiate a DM to an account that has never tapped Start on it.
    // We test this with a `sendChatAction(typing)` — lightweight, no
    // visible artifact when it succeeds — so the operator can spot
    // the misconfiguration in Railway logs (`live-support: ADMIN
    // CHAT NOT REACHABLE …`) the moment the bot boots, instead of
    // waiting for a user to open Live Support and get a silent fail.
    try {
      await bot.api.sendChatAction(env.ADMIN_USER_ID, 'typing');
      logger.info(
        { adminUserId: env.ADMIN_USER_ID },
        'live-support: admin chat reachable',
      );
    } catch (err) {
      logger.error(
        { err, adminUserId: env.ADMIN_USER_ID },
        'live-support: ADMIN CHAT NOT REACHABLE — Live Support relay will fail until the admin account opens this bot and taps Start. Check that ADMIN_USER_ID is set correctly and that the admin has started the bot at least once.',
      );
    }
  }

  return bot;
}
