import type { Composer } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { createDeposit, listPaymentMethods } from '../db/queries.js';
import { btn } from '../keyboards/helpers.js';
import type { AppCtx } from '../middleware/user.js';

export function registerTopup(bot: Composer<AppCtx>): void {
  bot.callbackQuery('topup:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showTopupMenu(ctx, /* asEdit */ true);
  });

  bot.callbackQuery(/^topup:method:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const methods = await listPaymentMethods();
    const m = methods.find((x) => x.id === id);
    if (!m) {
      await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      ctx.t('topup.method.body', {
        name: m.name,
        instructions: m.instructions,
        min: m.min_amount,
      }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('💸 ' + m.name, `topup:request:${m.id}`)
          .row()
          .text(btn(ctx.lang, 'back'), 'topup:open'),
      },
    );
  });

  // For simplicity: clicking the "request" button creates a pending
  // deposit of the method's min_amount. A real implementation would
  // collect amount + reference via a multi-step conversation.
  bot.callbackQuery(/^topup:request:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const methods = await listPaymentMethods();
    const m = methods.find((x) => x.id === id);
    if (!m) {
      await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
      return;
    }
    const dep = await createDeposit({
      user_id: ctx.user.telegram_id,
      method: m.name,
      amount: m.min_amount,
    });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(ctx.t('topup.requested', { id: dep.id }), {
      parse_mode: 'Markdown',
    });
  });
}

async function showTopupMenu(ctx: AppCtx, asEdit = false) {
  const methods = await listPaymentMethods();
  if (methods.length === 0) {
    const text = ctx.t('topup.empty_methods');
    if (asEdit) await ctx.editMessageText(text);
    else await ctx.reply(text);
    return;
  }
  const kb = new InlineKeyboard();
  methods.forEach((m, i) => {
    kb.text(`💳 ${m.name}`, `topup:method:${m.id}`);
    if (i % 2 === 1) kb.row();
  });
  if (methods.length % 2 === 1) kb.row();
  kb.text(btn(ctx.lang, 'main_menu'), 'main:open');
  const text = `${ctx.t('topup.title')}\n\n${ctx.t('topup.choose_method')}`;
  if (asEdit) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
  }
}
