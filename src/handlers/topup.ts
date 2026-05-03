import type { Composer } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { createDeposit, listPaymentMethods } from '../db/queries.js';
import { btn, inlineBtn } from '../keyboards/helpers.js';
import type { AppCtx } from '../middleware/user.js';
import { renderMdHtml } from '../services/premium.js';
import {
  BINANCE_PAY_ID,
  BINANCE_PAY_NAME,
  BINANCE_TOPUP_WINDOW_MINUTES,
  generateNoteCode,
} from '../services/binance.js';
import { logger } from '../logger.js';
import * as adminLog from '../services/adminLog.js';

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
      // Open a Pay-ID top-up session. The 6-digit note code is the
      // user's proof of ownership when they later submit an Order ID.
      const noteCode = generateNoteCode();
      ctx.session.userFlow = {
        type: 'binance_payid_topup',
        step: 'order_id',
        data: {
          method_id: m.id,
          method_name: m.name,
          note_code: noteCode,
          opened_at: Date.now(),
        },
      };
      await ctx.editMessageText(renderMdHtml(buildPayIdScreen(noteCode)), {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(btn(ctx.lang, 'back'), 'topup:open'),
      });
      return;
    }

    // Payment-method body is rendered through HTML so admin-supplied
    // instructions get auto-premium-emoji treatment for any
    // unicode emoji whose key has a configured `custom_emoji_id`.
    const methodBody = ctx.t('topup.method.body', {
      name: m.name,
      instructions: m.instructions,
      min: m.min_amount,
    });
    await ctx.editMessageText(renderMdHtml(methodBody), {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard()
        .text('💸 ' + m.name, `topup:request:${m.id}`)
        .row()
        .text(btn(ctx.lang, 'back'), 'topup:open'),
    });
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
    await ctx.editMessageText(renderMdHtml(ctx.t('topup.requested', { id: dep.id })), {
      parse_mode: 'HTML',
    });
  });

  // ----- Binance Pay-ID top-up: user submits Order ID -----
  bot.on('message:text', async (ctx, next) => {
    const flow = ctx.session.userFlow;
    if (!flow || flow.type !== 'binance_payid_topup') return next();
    const text = ctx.message.text.trim();
    if (text === '/cancel' || text.startsWith('/')) {
      ctx.session.userFlow = undefined;
      return next();
    }

    // Enforce the 30-minute submission window.
    const elapsedMs = Date.now() - flow.data.opened_at;
    const windowMs = BINANCE_TOPUP_WINDOW_MINUTES * 60_000;
    if (elapsedMs > windowMs) {
      ctx.session.userFlow = undefined;
      await ctx.reply(
        renderMdHtml(
          `⏰ This top-up window expired (${BINANCE_TOPUP_WINDOW_MINUTES} min limit). Please reopen Binance Pay top-up to get a fresh note code.`,
        ),
        { parse_mode: 'HTML' },
      );
      return;
    }

    // Light validation on the order ID. Binance Pay order IDs are
    // typically long digit strings (e.g. ~18-22 chars). We accept any
    // alphanumeric of reasonable length to stay future-proof.
    const orderId = text.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9]{6,64}$/.test(orderId)) {
      await ctx.reply(
        renderMdHtml(
          '❌ That doesn\'t look like a valid Binance Pay Order ID. Please paste only the order ID (digits/letters, 6–64 chars).',
        ),
        { parse_mode: 'HTML' },
      );
      return;
    }

    // Record a pending deposit. Amount is a placeholder (0.01) so the
    // database CHECK (amount > 0) passes — the admin will set the
    // real amount when verifying the order on the Binance dashboard.
    let depId: number;
    try {
      const dep = await createDeposit({
        user_id: ctx.user.telegram_id,
        method: flow.data.method_name,
        amount: 0.01,
        reference: flow.data.note_code,
        note: `Order ID: ${orderId}`,
      });
      depId = dep.id;
    } catch (err) {
      logger.error({ err }, 'Pay-ID deposit insert failed');
      await ctx.reply(
        '⚠️ Could not record your submission. Please try again or contact support.',
      );
      ctx.session.userFlow = undefined;
      return;
    }
    ctx.session.userFlow = undefined;

    await ctx.reply(
      renderMdHtml(
        [
          `✅ *Submitted (#${depId}).*`,
          '',
          `Order ID: \`${orderId}\``,
          `Note code: \`${flow.data.note_code}\``,
          '',
          'Admin will verify your payment on the Binance Pay dashboard and credit your wallet shortly. You\'ll get a confirmation message when it\'s done.',
        ].join('\n'),
      ),
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(btn(ctx.lang, 'back'), 'main:open'),
      },
    );
    void adminLog.logTopupSubmitted(ctx.api, {
      user: {
        telegram_id: ctx.user.telegram_id,
        username: ctx.user.username ?? null,
        first_name: ctx.user.first_name ?? null,
        email: ctx.user.email ?? null,
      },
      depositDbId: depId,
      method: flow.data.method_name,
      noteCode: flow.data.note_code,
      orderId,
    });
  });
}

/**
 * Build the Pay-ID top-up screen body. The note code is highlighted
 * because it MUST be pasted into Binance Pay's Remark field — without
 * it the admin has no way to attribute the transfer to this user.
 */
function buildPayIdScreen(noteCode: string): string {
  return [
    '💎 *Binance Pay — Deposit*',
    '',
    `*Pay ID:* \`${BINANCE_PAY_ID}\``,
    `*Binance Pay Name:* *${BINANCE_PAY_NAME}*`,
    `*Your note code:* \`${noteCode}\``,
    '',
    `1️⃣ Open Binance Pay → *Send* → enter Pay ID \`${BINANCE_PAY_ID}\`.`,
    '2️⃣ Send any USDT amount.',
    `3️⃣ Paste the note code \`${noteCode}\` into the *Remark* / *Note* field — without this, your payment cannot be credited.`,
    '4️⃣ Copy the Binance *Order ID* from the receipt and paste it below.',
    '',
    `⏰ Only payments completed within *${BINANCE_TOPUP_WINDOW_MINUTES} minutes* of opening this screen will be credited.`,
    '⚠️ Up to *2 decimal places* will be credited (USDT amounts are stored to 2 decimals).',
    '',
    '*Send your Order ID below.*',
  ].join('\n');
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
  inlineBtn(kb, ctx.lang, 'back', 'main:open');
  const text = `${ctx.t('topup.title')}\n\n${ctx.t('topup.choose_method')}`;
  const html = renderMdHtml(text);
  if (asEdit) {
    await ctx.editMessageText(html, { parse_mode: 'HTML', reply_markup: kb });
  } else {
    await ctx.reply(html, { parse_mode: 'HTML', reply_markup: kb });
  }
}
