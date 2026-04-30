import type { Composer } from 'grammy';
import type { AppCtx } from '../middleware/user.js';
import { mainMenuKeyboard } from '../keyboards/mainMenu.js';
import { renderMdHtml } from '../services/premium.js';

/**
 * Silently dismiss any leftover persistent reply keyboard from older
 * versions of the bot. We send a near-invisible message with
 * `remove_keyboard: true`, then immediately delete it. The keyboard
 * removal sticks even after the message is gone. Once-per-session.
 */
async function clearOldReplyKeyboard(ctx: AppCtx): Promise<void> {
  if (ctx.session.kbCleared) return;
  ctx.session.kbCleared = true;
  if (!ctx.chat) return;
  try {
    const m = await ctx.api.sendMessage(ctx.chat.id, '\u2063', {
      reply_markup: { remove_keyboard: true },
    });
    try {
      await ctx.api.deleteMessage(ctx.chat.id, m.message_id);
    } catch {
      /* deletion is best-effort */
    }
  } catch {
    /* sending is best-effort */
  }
}

/**
 * Build the welcome screen as HTML, wrapping every configured
 * premium emoji in `<tg-emoji>` tags so premium subscribers see the
 * styled glyph and everyone else sees the unicode fallback.
 */
function buildWelcomeHtml(ctx: AppCtx): string {
  const title = ctx.t('welcome.title');
  const balance = ctx.t('welcome.balance', { balance: Number(ctx.user.balance).toFixed(2) });
  const body = `{welcome_banner} *${title}*\n\n{welcome_balance} ${balance}`;
  return renderMdHtml(body, {
    welcome_banner: 'welcome_banner',
    welcome_balance: 'welcome_balance',
  });
}

async function showMainMenu(ctx: AppCtx, opts: { fresh?: boolean } = {}): Promise<void> {
  const html = buildWelcomeHtml(ctx);
  const reply_markup = mainMenuKeyboard(ctx.lang);

  // If we got here via callback (e.g. "⬅️ Main Menu" button) edit in place.
  if (!opts.fresh && ctx.callbackQuery) {
    try {
      await ctx.editMessageText(html, { parse_mode: 'HTML', reply_markup });
      return;
    } catch {
      // editing failed (e.g. message too old) → fall through to send
    }
  }

  await ctx.reply(html, { parse_mode: 'HTML', reply_markup });
}

export function registerStart(bot: Composer<AppCtx>): void {
  bot.command('start', async (ctx) => {
    await clearOldReplyKeyboard(ctx);
    await showMainMenu(ctx, { fresh: true });
  });

  bot.command('menu', async (ctx) => {
    await clearOldReplyKeyboard(ctx);
    await showMainMenu(ctx, { fresh: true });
  });

  // "⬅️ Main Menu" inline button used across screens.
  bot.callbackQuery('main:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    // Reset any in-flight user flow when returning to the main menu so
    // a stale prompt (e.g. set_email) can't capture later messages.
    ctx.session.userFlow = undefined;
    await showMainMenu(ctx);
  });

  // Fallback for the channel button when admin hasn't set the URL yet.
  // (When the URL is set, mainMenuKeyboard renders a direct URL button
  // and Telegram never sends us this callback.)
  bot.callbackQuery('channel:open', async (ctx) => {
    await ctx.answerCallbackQuery({ text: ctx.t('channel.not_set'), show_alert: true });
  });
}
