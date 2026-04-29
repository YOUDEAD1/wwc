import type { Composer } from 'grammy';
import type { AppCtx } from '../middleware/user.js';
import { mainMenuKeyboard } from '../keyboards/mainMenu.js';
import { renderPremium } from '../services/premium.js';

/**
 * Build the welcome screen text (with balance line) and entities for
 * any premium-emoji placeholders.
 */
function buildWelcome(ctx: AppCtx) {
  const title = ctx.t('welcome.title');
  const balance = ctx.t('welcome.balance', { balance: Number(ctx.user.balance).toFixed(2) });
  const body = `{wave} *${title}*\n\n{wallet} ${balance}`;
  return renderPremium(body, { wave: 'wave', wallet: 'wallet' });
}

async function showMainMenu(ctx: AppCtx, opts: { fresh?: boolean } = {}): Promise<void> {
  const { text, entities } = buildWelcome(ctx);
  const reply_markup = mainMenuKeyboard(ctx.lang);

  // If we got here via callback (e.g. "⬅️ Main Menu" button) edit in place.
  if (!opts.fresh && ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, {
        entities,
        parse_mode: entities.length ? undefined : 'Markdown',
        reply_markup,
      });
      return;
    } catch {
      // editing failed (e.g. message too old) → fall through to send
    }
  }

  // Send the welcome message with the inline menu attached.
  await ctx.reply(text, {
    entities,
    parse_mode: entities.length ? undefined : 'Markdown',
    reply_markup,
  });
}

export function registerStart(bot: Composer<AppCtx>): void {
  bot.command('start', async (ctx) => {
    await showMainMenu(ctx, { fresh: true });
  });

  bot.command('menu', async (ctx) => {
    await showMainMenu(ctx, { fresh: true });
  });

  // "⬅️ Main Menu" inline button used across screens.
  bot.callbackQuery('main:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMainMenu(ctx);
  });

  // Fallback for the channel button when admin hasn't set the URL yet.
  // (When the URL is set, mainMenuKeyboard renders a direct URL button
  // and Telegram never sends us this callback.)
  bot.callbackQuery('channel:open', async (ctx) => {
    await ctx.answerCallbackQuery({ text: ctx.t('channel.not_set'), show_alert: true });
  });
}
