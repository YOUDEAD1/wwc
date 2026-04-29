import type { Composer } from 'grammy';
import type { AppCtx } from '../middleware/user.js';
import { mainMenuKeyboard } from '../keyboards/mainMenu.js';
import { renderPremium } from '../services/premium.js';

export function registerStart(bot: Composer<AppCtx>): void {
  bot.command('start', async (ctx) => {
    const welcome = ctx.t('welcome');
    const tap = ctx.t('welcome.tap_menu');
    const { text, entities } = renderPremium(`{tiger} ${welcome}\n\n${tap}`, { tiger: 'tiger' });
    await ctx.reply(text, {
      entities,
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(ctx.lang),
    });
  });

  bot.command('menu', async (ctx) => {
    await ctx.reply(ctx.t('menu.title'), {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(ctx.lang),
    });
  });
}
