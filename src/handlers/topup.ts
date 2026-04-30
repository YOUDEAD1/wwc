import type { Composer } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { createDeposit, listPaymentMethods } from '../db/queries.js';
import { btn } from '../keyboards/helpers.js';
import type { AppCtx } from '../middleware/user.js';
import { binanceEnabled, createOrder, makeMerchantTradeNo } from '../services/binance.js';
import { env } from '../env.js';
import { logger } from '../logger.js';

export function registerTopup(bot: Composer<AppCtx>): void {
  bot.callbackQuery('topup:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.userFlow = undefined;
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

    if (m.provider === 'binance_pay') {
      if (!binanceEnabled()) {
        await ctx.editMessageText(
          '⚠️ Binance Pay isn\'t configured on the server yet. Please contact the admin.',
          { reply_markup: new InlineKeyboard().text(btn(ctx.lang, 'back'), 'topup:open') },
        );
        return;
      }
      ctx.session.userFlow = {
        type: 'binance_topup',
        step: 'amount',
        data: { method_id: m.id, method_name: m.name, min: Number(m.min_amount) },
      };
      await ctx.editMessageText(
        `💳 *${m.name}*\n\nEnter the amount in *USDT* you want to top up (minimum *$${m.min_amount}*).`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text(btn(ctx.lang, 'back'), 'topup:open'),
        },
      );
      return;
    }

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

  // ----- Binance Pay amount entry -----
  bot.on('message:text', async (ctx, next) => {
    const flow = ctx.session.userFlow;
    if (!flow || flow.type !== 'binance_topup') return next();
    const text = ctx.message.text.trim();
    if (text === '/cancel' || text.startsWith('/')) {
      ctx.session.userFlow = undefined;
      return next();
    }
    const amount = Number(text);
    if (!Number.isFinite(amount) || amount < flow.data.min) {
      await ctx.reply(`❌ Send a number ≥ *$${flow.data.min}* (e.g. \`10\`).`, {
        parse_mode: 'Markdown',
      });
      return;
    }
    const merchantTradeNo = makeMerchantTradeNo(ctx.user.telegram_id);
    const baseUrl = env.PUBLIC_BASE_URL || env.WEBHOOK_URL || '';
    let order;
    try {
      order = await createOrder({
        merchantTradeNo,
        amount,
        currency: 'USDT',
        goodsName: `Wallet top-up for ${ctx.user.telegram_id}`,
        ...(baseUrl
          ? {
              returnUrl: `${baseUrl}/binance/return`,
              webhookUrl: `${baseUrl}/webhook/binance`,
            }
          : {}),
      });
    } catch (err) {
      logger.error({ err }, 'Binance createOrder failed');
      await ctx.reply('⚠️ Could not create the Binance Pay order. Please try again later.');
      ctx.session.userFlow = undefined;
      return;
    }
    if (!order) {
      await ctx.reply('⚠️ Could not create the Binance Pay order.');
      ctx.session.userFlow = undefined;
      return;
    }
    // Record a pending deposit. The webhook will look it up by reference.
    await createDeposit({
      user_id: ctx.user.telegram_id,
      method: flow.data.method_name,
      amount,
      reference: merchantTradeNo,
      note: 'Binance Pay (auto)',
    });
    ctx.session.userFlow = undefined;

    const kb = new InlineKeyboard()
      .url('💎 Pay with Binance', order.checkoutUrl)
      .row()
      .text(btn(ctx.lang, 'back'), 'topup:open');
    await ctx.reply(
      `🧾 *Order created*\n\nAmount: *$${amount.toFixed(2)} USDT*\nOrder #: \`${merchantTradeNo}\`\n\nTap the button below to pay. Your wallet will be auto-credited within seconds of confirmation.`,
      { parse_mode: 'Markdown', reply_markup: kb },
    );
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
    const label = m.provider === 'binance_pay' ? `💎 ${m.name}` : `💳 ${m.name}`;
    kb.text(label, `topup:method:${m.id}`);
    if (i % 2 === 1) kb.row();
  });
  if (methods.length % 2 === 1) kb.row();
  kb.text(btn(ctx.lang, 'back'), 'main:open');
  const text = `${ctx.t('topup.title')}\n\n${ctx.t('topup.choose_method')}`;
  if (asEdit) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
  }
}
