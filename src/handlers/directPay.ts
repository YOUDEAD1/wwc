/**
 * Phase B — per-order direct-pay handlers.
 *
 * Wires the same five auto-verify networks (Binance Pay, USDT BEP20
 * / TRC20 / TON, LTC) into the checkout flow so a buyer can pay for
 * a *specific* product directly with crypto rather than topping up
 * their wallet first.
 *
 * The user-facing surface mirrors `topup.ts`: a network picker, a
 * "Send X to <address>, paste tx hash below" screen, and a verifier
 * that auto-fulfils on success. The two flows are kept in separate
 * modules because:
 *   1. Direct-pay deposits carry an `order_intent` (locked product +
 *      qty + price), and the verifier uses that intent in
 *      `services/orderFulfill.ts` to deliver the order instead of
 *      crediting the wallet.
 *   2. The LTC step is collapsed to a single screen — USD is fixed
 *      at the order total, so we lock the rate as soon as the user
 *      picks LTC instead of asking for a USD amount first.
 *
 * On verifier failure the deposit stays pending and admin can
 * approve manually via the existing `🔁 Re-verify` panel; if the
 * order is approved later the same `fulfilOrderForDeposit` path
 * runs and the user gets their items.
 */
import crypto from 'node:crypto';
import type { Api, Composer } from 'grammy';
import { InlineKeyboard } from 'grammy';
import {
  createDeposit,
  getDeposit,
  getProduct,
  listPaymentMethods,
  setDepositNote,
  setDepositStatus,
} from '../db/queries.js';
import { btn, inlineBtn } from '../keyboards/helpers.js';
import type { AppCtx } from '../middleware/user.js';
import { renderMdHtml } from '../services/premium.js';
import { fetchLtcUsdRate, quoteLtc } from '../services/chainVerify.js';
import { verifyAndCreditDeposit } from '../services/depositVerify.js';
import { createOrder as binanceCreateOrder } from '../services/binance.js';
import {
  applyUserPriceToProduct,
} from '../services/pricing.js';
import { priceBreakdown, resolvePromo } from '../services/promo.js';
import { logger } from '../logger.js';
import * as adminLog from '../services/adminLog.js';
import { QTY_MIN } from '../../config/index.js';
import type {
  DBPaymentMethod,
  DBProduct,
  OrderIntent,
  PaymentProvider,
} from '../types.js';

const LTC_QUOTE_TTL_MIN = 10;

/**
 * Build the OrderIntent for a given product/user/qty pair. Resolves
 * the user's effective price + active promo server-side so the
 * total locked into the deposit matches what the user saw on the
 * product page.
 */
async function buildIntent(
  ctx: AppCtx,
  raw: DBProduct,
  qty: number,
): Promise<OrderIntent> {
  const p = await applyUserPriceToProduct(ctx.user.telegram_id, raw);
  const promo = await resolvePromo(ctx.user.telegram_id, p.id, qty, p.price);
  const { discount, total } = priceBreakdown(p.price, qty, promo);
  return {
    product_id: p.id,
    product_name: p.name,
    qty,
    unit_price: p.price,
    discount,
    promo_id: promo?.promo.id ?? null,
    total,
  };
}

export function registerDirectPay(bot: Composer<AppCtx>): void {
  // Step 1 — user tapped "💸 Pay Directly" on the buy-now picker.
  // Show the auto-verify network picker (same providers as top-up
  // minus 'manual' since manual providers can't auto-fulfil).
  bot.callbackQuery(/^pay:direct:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const raw = await getProduct(id);
    if (!raw) {
      await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
      return;
    }
    const p = await applyUserPriceToProduct(ctx.user.telegram_id, raw);
    if (!p.unlimited_stock && p.stock <= 0) {
      await ctx.answerCallbackQuery({
        text: ctx.t('shop.buy.no_stock'),
        show_alert: true,
      });
      return;
    }
    const qty = ctx.session.qty[id] ?? QTY_MIN;
    const intent = await buildIntent(ctx, raw, qty);

    const methods = (await listPaymentMethods()).filter(
      (m) => m.provider !== 'manual',
    );
    if (methods.length === 0) {
      await ctx.answerCallbackQuery({
        text: 'No direct-pay networks are configured yet — admin must add at least one auto-verify method.',
        show_alert: true,
      });
      return;
    }

    const kb = new InlineKeyboard();
    methods.forEach((m, i) => {
      kb.text(labelForMethod(m), `pdpm:${id}:${m.id}`);
      if (i % 2 === 1) kb.row();
    });
    if (methods.length % 2 === 1) kb.row();
    inlineBtn(kb, ctx.lang, 'back', `buy:${p.id}`);

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      renderMdHtml(
        [
          '💸 *Direct Pay — choose a network*',
          '',
          `*${intent.product_name}*  ×  *${intent.qty}*`,
          `Total to pay: *$${intent.total.toFixed(2)}*`,
          '',
          'Pick the network you want to pay on. The order is delivered as soon as your transaction confirms — no top-up required.',
        ].join('\n'),
      ),
      {
        parse_mode: 'HTML',
        reply_markup: kb,
      },
    );
  });

  // Step 2 — user picked a network. Branch on provider and either
  // show the Pay ID / address screen, or (for LTC) lock a quote
  // immediately + create the deposit row.
  bot.callbackQuery(/^pdpm:(\d+):(\d+)$/, async (ctx) => {
    const productId = Number(ctx.match[1]);
    const methodId = Number(ctx.match[2]);
    const raw = await getProduct(productId);
    if (!raw) {
      await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
      return;
    }
    const methods = await listPaymentMethods();
    const m = methods.find((x) => x.id === methodId);
    if (!m) {
      await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
      return;
    }
    const qty = ctx.session.qty[productId] ?? QTY_MIN;
    const intent = await buildIntent(ctx, raw, qty);

    await ctx.answerCallbackQuery();

    if (m.provider === 'binance_pay') {
      // Merchant Checkout flow: bot calls createOrder to mint a
      // unique merchantTradeNo + checkout URL, then polls queryOrder
      // until PAID. Pasting an Order ID is no longer required —
      // every direct-pay session has a server-generated tradeNo so
      // wrong / replayed IDs are impossible.
      ctx.session.userFlow = undefined;
      await startBinanceMerchantCheckout(ctx, m, intent, productId);
      return;
    }

    if (
      m.provider === 'usdt_trc20' ||
      m.provider === 'usdt_bep20' ||
      m.provider === 'usdt_ton'
    ) {
      if (!m.address) {
        await ctx.editMessageText(
          renderMdHtml(
            '⚠️ This payment method has no wallet address configured. Please contact support.',
          ),
          {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard().text(
              btn(ctx.lang, 'back'),
              `pay:direct:${productId}`,
            ),
          },
        );
        return;
      }
      ctx.session.userFlow = {
        type: 'direct_chain',
        step: 'tx_hash',
        data: {
          method_id: m.id,
          method_name: m.name,
          provider: m.provider,
          address: m.address,
          intent,
        },
      };
      await ctx.editMessageText(
        renderMdHtml(buildChainDirectScreen(m, intent)),
        {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().text(
            btn(ctx.lang, 'back'),
            `pay:direct:${productId}`,
          ),
        },
      );
      return;
    }

    if (m.provider === 'ltc') {
      if (!m.address) {
        await ctx.editMessageText(
          renderMdHtml(
            '⚠️ This payment method has no Litecoin address configured. Please contact support.',
          ),
          {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard().text(
              btn(ctx.lang, 'back'),
              `pay:direct:${productId}`,
            ),
          },
        );
        return;
      }
      let rate: number;
      try {
        rate = await fetchLtcUsdRate();
      } catch (err) {
        logger.warn({ err }, 'LTC rate fetch failed for direct-pay');
        await ctx.editMessageText(
          renderMdHtml(
            '⚠️ Could not fetch the LTC/USD rate right now. Please pick another network or try again in a minute.',
          ),
          {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard().text(
              btn(ctx.lang, 'back'),
              `pay:direct:${productId}`,
            ),
          },
        );
        return;
      }
      const { ltcAmount, expiresAt } = quoteLtc(intent.total, rate);
      const expiresAtMs = expiresAt.getTime();

      let depId: number;
      try {
        const dep = await createDeposit({
          user_id: ctx.user.telegram_id,
          method: m.name,
          amount: intent.total,
          expected_amount: ltcAmount,
          quote_expires_at: expiresAt.toISOString(),
          note: `Direct-pay LTC quote: $${intent.total} = ${ltcAmount} LTC @ $${rate}/LTC`,
          order_intent: intent,
        });
        depId = dep.id;
      } catch (err) {
        logger.error({ err }, 'direct-pay LTC deposit insert failed');
        await ctx.editMessageText(
          renderMdHtml(
            '⚠️ Could not lock the LTC quote. Please try again or contact support.',
          ),
          {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard().text(
              btn(ctx.lang, 'back'),
              `pay:direct:${productId}`,
            ),
          },
        );
        return;
      }

      ctx.session.userFlow = {
        type: 'direct_ltc',
        step: 'tx_hash',
        data: {
          method_id: m.id,
          method_name: m.name,
          address: m.address,
          deposit_id: depId,
          usd_amount: intent.total,
          ltc_amount: ltcAmount,
          ltc_rate: rate,
          expires_at_ms: expiresAtMs,
          intent,
        },
      };

      await ctx.editMessageText(
        renderMdHtml(
          [
            '⚪ *Litecoin — Direct Pay Quote*',
            '',
            `*${intent.product_name}*  ×  *${intent.qty}*`,
            `Total: *$${intent.total.toFixed(2)}*`,
            '',
            `*Send exactly:* \`${ltcAmount} LTC\``,
            `*To address:* \`${m.address}\``,
            '',
            `_Locked rate:_ $${rate.toFixed(2)} per LTC`,
            `_Quote expires:_ ${LTC_QUOTE_TTL_MIN} min from now`,
            '',
            '1️⃣ Send the exact LTC amount above to the address',
            '2️⃣ Paste your *transaction hash* below',
            '',
            '*Please send your TX hash below:*',
          ].join('\n'),
        ),
        {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().text(
            btn(ctx.lang, 'back'),
            `pay:direct:${productId}`,
          ),
        },
      );
      return;
    }

    // Defensive: unknown provider — should never happen because the
    // picker filters out 'manual' and only auto-verify providers
    // exist in the constraint, but keep a graceful fallback.
    await ctx.editMessageText(
      renderMdHtml(
        '⚠️ Direct-pay is not available for this payment method. Please pick another.',
      ),
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(
          btn(ctx.lang, 'back'),
          `pay:direct:${productId}`,
        ),
      },
    );
  });

  // Step 3a — Binance direct-pay user-tap "Check Payment".
  bot.callbackQuery(/^dpbc:(\d+)$/, async (ctx) => {
    const depositId = Number(ctx.match[1]);
    await handleBinanceCheckTap(ctx, depositId);
  });

  // Step 3b — Binance direct-pay user-tap "Cancel".
  bot.callbackQuery(/^dpbx:(\d+)$/, async (ctx) => {
    const depositId = Number(ctx.match[1]);
    await handleBinanceCancelTap(ctx, depositId);
  });

  // Step 4 — text submissions for in-flight direct-pay flows
  // (chain / LTC; Binance no longer needs user text input).
  bot.on('message:text', async (ctx, next) => {
    const flow = ctx.session.userFlow;
    if (!flow) return next();

    const text = ctx.message.text.trim();
    if (text === '/cancel' || text.startsWith('/')) {
      ctx.session.userFlow = undefined;
      return next();
    }

    if (flow.type === 'direct_chain') {
      await handleChainDirectSubmit(ctx, flow, text);
      return;
    }
    if (flow.type === 'direct_ltc') {
      await handleLtcDirectSubmit(ctx, flow, text);
      return;
    }
    return next();
  });
}

// ----- Binance Pay direct (Merchant Checkout flow) -----------------------
//
// Replaces the legacy "send to Pay ID + paste Order ID" UX with a
// proper merchant checkout: the bot mints a unique merchantTradeNo,
// calls Binance `createOrder` to get a checkout deep-link, shows
// the user a tap-to-pay button, and polls `queryOrder` in the
// background until the order is PAID or the 10-minute window
// expires. There is no user-typed Order ID — wrong / replayed IDs
// are architecturally impossible.

const BINANCE_POLL_INTERVAL_MS = 10_000;
const BINANCE_POLL_WINDOW_MS = 10 * 60 * 1000;

/**
 * Active poll handles, keyed by deposit id, so the user-tap and
 * background paths can cancel each other once a deposit reaches a
 * terminal state.
 */
const activePolls = new Map<number, NodeJS.Timeout>();

function stopPoll(depositId: number): void {
  const handle = activePolls.get(depositId);
  if (handle) {
    clearTimeout(handle);
    activePolls.delete(depositId);
  }
}

function makeMerchantTradeNo(): string {
  // Binance accepts up to 32 alphanumerics. Use a timestamp prefix +
  // random hex so trade numbers are sortable in our admin tools.
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `STB${ts}${rnd}`.slice(0, 32);
}

async function startBinanceMerchantCheckout(
  ctx: AppCtx,
  m: DBPaymentMethod,
  intent: OrderIntent,
  productId: number,
): Promise<void> {
  const tradeNo = makeMerchantTradeNo();

  // Try to mint the order with Binance first. If the merchant
  // account / API region rejects createOrder we surface a graceful
  // fallback so we don't leave a half-baked deposit row behind.
  let order: Awaited<ReturnType<typeof binanceCreateOrder>>;
  try {
    order = await binanceCreateOrder({
      merchantTradeNo: tradeNo,
      amount: intent.total,
      goodsName: intent.product_name,
      goodsId: intent.product_id,
    });
  } catch (err) {
    const reason = (err as Error)?.message ?? String(err);
    logger.warn({ err, tradeNo }, 'Binance createOrder failed for direct-pay');
    await ctx.editMessageText(
      renderMdHtml(
        [
          '⚠️ *Binance Pay direct-pay is not available right now.*',
          '',
          `Reason: _${reason}_`,
          '',
          'Please pick another network — USDT (BEP-20 / TRC-20 / TON) or LTC.',
        ].join('\n'),
      ),
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(
          btn(ctx.lang, 'back'),
          `pay:direct:${productId}`,
        ),
      },
    );
    return;
  }

  // Persist the deposit BEFORE we show the checkout link so the
  // poll loop has something to look up. The merchantTradeNo doubles
  // as the dedupe key (`tx_hash`) so the same Binance order can
  // never deliver more than once.
  let depId: number;
  try {
    const dep = await createDeposit({
      user_id: ctx.user.telegram_id,
      method: m.name,
      amount: intent.total,
      reference: tradeNo,
      tx_hash: tradeNo,
      note: `Direct-pay Binance merchant checkout — prepayId=${order.prepayId}`,
      order_intent: intent,
    });
    depId = dep.id;
  } catch (err) {
    logger.error({ err, tradeNo }, 'Direct-pay Binance deposit insert failed');
    await ctx.editMessageText(
      renderMdHtml(
        [
          '⚠️ *Could not record the payment.*',
          '',
          'Please try again or contact support.',
        ].join('\n'),
      ),
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(
          btn(ctx.lang, 'back'),
          `pay:direct:${productId}`,
        ),
      },
    );
    return;
  }

  const expiresAtMs = Date.now() + BINANCE_POLL_WINDOW_MS;
  const checkoutUrl = order.checkoutUrl ?? order.universalUrl ?? '';
  const kb = new InlineKeyboard();
  if (checkoutUrl) {
    kb.url('💳 Pay with Binance Pay', checkoutUrl).row();
  }
  kb.text('🔁 Check Payment', `dpbc:${depId}`).row();
  kb.text('❌ Cancel', `dpbx:${depId}`);

  await ctx.editMessageText(
    renderMdHtml(
      [
        '🟡 *Binance Pay — Direct Pay*',
        '',
        `*${intent.product_name}*  ×  *${intent.qty}*`,
        `Total: *$${intent.total.toFixed(2)} USDT*`,
        '',
        '1️⃣ Tap *Pay with Binance Pay* below — it opens the Binance app',
        '2️⃣ Confirm the payment in the Binance app',
        '3️⃣ The bot will detect the payment automatically (within ~30 sec) and deliver your order',
        '',
        `_Order expires:_ 10 min from now`,
        '',
        '_Or tap *🔁 Check Payment* once you\'ve paid to verify immediately._',
      ].join('\n'),
    ),
    { parse_mode: 'HTML', reply_markup: kb },
  );

  // Kick off the background poll. The user-tap callback uses the
  // same `runBinancePollOnce` helper so they share the dedupe path.
  schedulePoll(ctx.api, depId, expiresAtMs, m.name, ctx.user.telegram_id, {
    username: ctx.user.username ?? null,
    first_name: ctx.user.first_name ?? null,
    email: ctx.user.email ?? null,
  });
}

function schedulePoll(
  api: Api,
  depositId: number,
  expiresAtMs: number,
  methodName: string,
  userTgId: number,
  logUser: {
    username: string | null;
    first_name: string | null;
    email: string | null;
  },
): void {
  stopPoll(depositId);
  if (Date.now() >= expiresAtMs) return;
  const handle = setTimeout(() => {
    void runBinancePollOnce(
      api,
      depositId,
      expiresAtMs,
      methodName,
      userTgId,
      logUser,
    );
  }, BINANCE_POLL_INTERVAL_MS);
  activePolls.set(depositId, handle);
}

/**
 * Single poll attempt. Reads the deposit row, runs the verifier
 * once, and either fulfils, schedules another poll, or expires the
 * order. Used by both the background poll and the user-tap "Check
 * Payment" callback.
 */
async function runBinancePollOnce(
  api: Api,
  depositId: number,
  expiresAtMs: number,
  methodName: string,
  userTgId: number,
  logUser: {
    username: string | null;
    first_name: string | null;
    email: string | null;
  },
): Promise<{
  done: 'paid' | 'pending' | 'expired' | 'gone';
  reason?: string;
}> {
  const dep = await getDeposit(depositId);
  if (!dep || dep.status !== 'pending') {
    stopPoll(depositId);
    return { done: 'gone' };
  }

  let result;
  try {
    result = await verifyAndCreditDeposit({
      api,
      deposit: dep,
      submission: { merchantTradeNo: dep.tx_hash ?? dep.reference ?? '' },
      logUser: {
        telegram_id: userTgId,
        username: logUser.username,
        first_name: logUser.first_name,
        email: logUser.email,
      },
    });
  } catch (err) {
    logger.error({ err, depositId }, 'Binance direct-pay verifier crashed');
    result = {
      ok: false as const,
      reason: `verifier crashed: ${(err as Error)?.message ?? String(err)}`,
    };
  }

  if (result.ok) {
    stopPoll(depositId);
    return { done: 'paid' };
  }

  // Verifier returned a soft "not paid yet" — keep polling until
  // the 10-minute window closes. Hard errors (e.g. Binance API
  // 451) end the loop early and notify the user once.
  const reason = result.reason || '';
  const isPending =
    /not_paid|pending|INITIAL|status:\s*INITIAL|status:\s*PENDING|no record/i.test(
      reason,
    );

  if (Date.now() >= expiresAtMs) {
    stopPoll(depositId);
    try {
      await setDepositNote(depositId, `direct-pay expired: ${reason || 'no payment in window'}`);
      await setDepositStatus(depositId, 'rejected');
    } catch (err) {
      logger.warn({ err, depositId }, 'failed to mark expired deposit');
    }
    try {
      await api.sendMessage(
        userTgId,
        renderMdHtml(
          [
            `⏰ *Direct-pay window expired (deposit #${depositId}).*`,
            '',
            'No payment was detected within 10 minutes. The order has been cancelled — no charge has been made.',
            '',
            'You can start a new direct-pay any time from the product page.',
          ].join('\n'),
        ),
        { parse_mode: 'HTML' },
      );
    } catch (err) {
      logger.warn({ err, userTgId }, 'failed to dm user about expired direct-pay');
    }
    return { done: 'expired', reason };
  }

  if (!isPending) {
    // Hard verifier error — log it but keep polling in case it's a
    // transient API hiccup. The deposit will eventually expire.
    logger.warn(
      { reason, depositId },
      'Binance direct-pay verifier returned non-pending error; will retry',
    );
  }

  schedulePoll(api, depositId, expiresAtMs, methodName, userTgId, logUser);
  return { done: 'pending', reason };
}

async function handleBinanceCheckTap(ctx: AppCtx, depositId: number): Promise<void> {
  const dep = await getDeposit(depositId);
  if (!dep || dep.user_id !== ctx.user.telegram_id) {
    await ctx.answerCallbackQuery({ text: 'Deposit not found.', show_alert: true });
    return;
  }
  if (dep.status !== 'pending') {
    await ctx.answerCallbackQuery({
      text: `This order is already ${dep.status}.`,
      show_alert: true,
    });
    return;
  }
  await ctx.answerCallbackQuery({ text: 'Checking…' });

  const expiresAtMs = Date.now() + BINANCE_POLL_WINDOW_MS;
  const r = await runBinancePollOnce(
    ctx.api,
    depositId,
    expiresAtMs,
    dep.method,
    ctx.user.telegram_id,
    {
      username: ctx.user.username ?? null,
      first_name: ctx.user.first_name ?? null,
      email: ctx.user.email ?? null,
    },
  );
  if (r.done === 'paid') {
    // The fulfilment path already sent Payment Verified + Order
    // Delivered cards via `services/orderFulfill.ts`. The original
    // checkout message can stay — most of its buttons are now
    // no-ops, but we hide them by stripping the keyboard.
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch {
      /* message might be too old to edit; harmless */
    }
  } else if (r.done === 'pending') {
    await ctx.reply(
      renderMdHtml(
        [
          '⏳ *Payment not detected yet.*',
          '',
          'If you just paid, give it a few seconds and tap *🔁 Check Payment* again. The bot is also checking automatically every 10 sec.',
        ].join('\n'),
      ),
      { parse_mode: 'HTML' },
    );
  }
}

async function handleBinanceCancelTap(ctx: AppCtx, depositId: number): Promise<void> {
  const dep = await getDeposit(depositId);
  if (!dep || dep.user_id !== ctx.user.telegram_id) {
    await ctx.answerCallbackQuery({ text: 'Deposit not found.', show_alert: true });
    return;
  }
  if (dep.status !== 'pending') {
    await ctx.answerCallbackQuery({
      text: `This order is already ${dep.status}.`,
      show_alert: true,
    });
    return;
  }
  stopPoll(depositId);
  try {
    await setDepositNote(depositId, 'direct-pay cancelled by user');
    await setDepositStatus(depositId, 'rejected');
  } catch (err) {
    logger.warn({ err, depositId }, 'failed to cancel direct-pay deposit');
  }
  await ctx.answerCallbackQuery({ text: 'Cancelled.' });
  try {
    await ctx.editMessageText(
      renderMdHtml(
        [
          `❌ *Direct-pay cancelled (deposit #${depositId}).*`,
          '',
          'No payment was processed.',
        ].join('\n'),
      ),
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(btn(ctx.lang, 'back'), 'main:open'),
      },
    );
  } catch {
    /* message might be too old to edit; harmless */
  }
}

// ----- USDT chain direct (BEP20 / TRC20 / TON) ---------------------------

async function handleChainDirectSubmit(
  ctx: AppCtx,
  flow: Extract<
    NonNullable<AppCtx['session']['userFlow']>,
    { type: 'direct_chain' }
  >,
  text: string,
): Promise<void> {
  const cleaned = text.replace(/\s+/g, '');
  const provider = flow.data.provider;
  let txHash: string;

  if (provider === 'usdt_trc20') {
    const stripped = cleaned.replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]{64}$/.test(stripped)) {
      await ctx.reply(
        renderMdHtml(
          "❌ That doesn't look like a TRON tx hash. Paste the 64-character hex transaction id from your wallet.",
        ),
        { parse_mode: 'HTML' },
      );
      return;
    }
    txHash = stripped.toLowerCase();
  } else if (provider === 'usdt_bep20') {
    const stripped = cleaned.replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]{64}$/.test(stripped)) {
      await ctx.reply(
        renderMdHtml(
          "❌ That doesn't look like a BSC tx hash. Paste the `0x…` 66-character transaction id from your wallet.",
        ),
        { parse_mode: 'HTML' },
      );
      return;
    }
    txHash = '0x' + stripped.toLowerCase();
  } else {
    if (
      !/^[0-9a-fA-F]{64}$/.test(cleaned) &&
      !/^[A-Za-z0-9+/=_-]{43,44}$/.test(cleaned)
    ) {
      await ctx.reply(
        renderMdHtml(
          "❌ That doesn't look like a TON tx hash. Paste the 64-character hex hash from Tonviewer / Tonscan, or the base64 hash from your wallet.",
        ),
        { parse_mode: 'HTML' },
      );
      return;
    }
    txHash = cleaned;
  }

  const intent = flow.data.intent;
  let depId: number;
  try {
    const dep = await createDeposit({
      user_id: ctx.user.telegram_id,
      method: flow.data.method_name,
      amount: intent.total,
      reference: txHash,
      note: 'Direct-pay on-chain tx submitted via auto-verify',
      tx_hash: txHash,
      order_intent: intent,
    });
    depId = dep.id;
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? '';
    if (/23505|duplicate/i.test(msg)) {
      await ctx.reply(
        renderMdHtml('⚠️ This transaction hash has already been submitted.'),
        { parse_mode: 'HTML' },
      );
      ctx.session.userFlow = undefined;
      return;
    }
    logger.error({ err }, 'Direct-pay chain deposit insert failed');
    await ctx.reply(
      '⚠️ Could not record your payment. Please try again or contact support.',
    );
    ctx.session.userFlow = undefined;
    return;
  }
  ctx.session.userFlow = undefined;

  const dep = await getDeposit(depId);
  if (!dep) {
    await ctx.reply('⚠️ Internal error: deposit row missing right after insert.');
    return;
  }
  const status = await ctx.reply(
    renderMdHtml(`🔎 *Looking up tx on-chain…* (#${depId})`),
    { parse_mode: 'HTML' },
  );

  let result;
  try {
    result = await verifyAndCreditDeposit({
      api: ctx.api,
      deposit: dep,
      submission: { txHash },
      logUser: {
        telegram_id: ctx.user.telegram_id,
        username: ctx.user.username ?? null,
        first_name: ctx.user.first_name ?? null,
        email: ctx.user.email ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, depId, txHash }, 'direct chain auto-verify threw');
    result = {
      ok: false as const,
      reason: `verifier crashed: ${(err as Error)?.message ?? String(err)}`,
    };
  }

  if (result.ok) {
    await ctx.api.editMessageText(
      status.chat.id,
      status.message_id,
      renderMdHtml(
        [
          `✅ *Direct-pay verified (deposit #${depId}).*`,
          '',
          `Tx: \`${txHash}\``,
          `Charged: *$${result.amount.toFixed(2)}*`,
        ].join('\n'),
      ),
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(btn(ctx.lang, 'back'), 'main:open'),
      },
    );
  } else {
    try {
      await setDepositNote(depId, `auto-verify failed: ${result.reason}`);
    } catch {
      /* noop */
    }
    await ctx.api.editMessageText(
      status.chat.id,
      status.message_id,
      renderMdHtml(
        [
          `⏳ *Submitted (#${depId}) — pending admin review.*`,
          '',
          `Tx: \`${txHash}\``,
          `Reason auto-verify deferred: _${result.reason}_`,
          '',
          'Your order will be delivered as soon as admin verifies the payment manually.',
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
      reference: txHash,
      reason: result.reason,
    });
  }
}

// ----- LTC direct ---------------------------------------------------------

async function handleLtcDirectSubmit(
  ctx: AppCtx,
  flow: Extract<
    NonNullable<AppCtx['session']['userFlow']>,
    { type: 'direct_ltc' }
  >,
  text: string,
): Promise<void> {
  const cleaned = text.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleaned)) {
    await ctx.reply(
      renderMdHtml(
        "❌ That doesn't look like a Litecoin tx hash. Paste the 64-character hex transaction id from your wallet.",
      ),
      { parse_mode: 'HTML' },
    );
    return;
  }
  if (Date.now() > flow.data.expires_at_ms) {
    await ctx.reply(
      renderMdHtml(
        '⏰ Your LTC quote expired. Tap *Pay Directly* on the product page again to get a fresh rate.',
      ),
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(btn(ctx.lang, 'back'), 'main:open'),
      },
    );
    ctx.session.userFlow = undefined;
    return;
  }

  ctx.session.userFlow = undefined;
  const status = await ctx.reply(
    renderMdHtml(`🔎 *Looking up tx on Litecoin network…* (#${flow.data.deposit_id})`),
    { parse_mode: 'HTML' },
  );

  const dep = await getDeposit(flow.data.deposit_id);
  if (!dep) {
    await ctx.reply('⚠️ Internal error: deposit row missing.');
    return;
  }

  let result;
  try {
    result = await verifyAndCreditDeposit({
      api: ctx.api,
      deposit: dep,
      submission: { txHash: cleaned },
      logUser: {
        telegram_id: ctx.user.telegram_id,
        username: ctx.user.username ?? null,
        first_name: ctx.user.first_name ?? null,
        email: ctx.user.email ?? null,
      },
    });
  } catch (err) {
    logger.error(
      { err, depId: flow.data.deposit_id },
      'direct LTC auto-verify threw',
    );
    result = {
      ok: false as const,
      reason: `verifier crashed: ${(err as Error)?.message ?? String(err)}`,
    };
  }

  if (result.ok) {
    await ctx.api.editMessageText(
      status.chat.id,
      status.message_id,
      renderMdHtml(
        [
          `✅ *Direct-pay verified (deposit #${flow.data.deposit_id}).*`,
          '',
          `Tx: \`${cleaned}\``,
          `Charged: *$${result.amount.toFixed(2)}*`,
        ].join('\n'),
      ),
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(btn(ctx.lang, 'back'), 'main:open'),
      },
    );
  } else {
    try {
      await setDepositNote(flow.data.deposit_id, `auto-verify failed: ${result.reason}`);
    } catch {
      /* noop */
    }
    await ctx.api.editMessageText(
      status.chat.id,
      status.message_id,
      renderMdHtml(
        [
          `⏳ *Submitted (#${flow.data.deposit_id}) — pending admin review.*`,
          '',
          `Tx: \`${cleaned}\``,
          `Reason auto-verify deferred: _${result.reason}_`,
          '',
          'Your order will be delivered as soon as admin verifies the payment manually.',
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
      depositDbId: flow.data.deposit_id,
      method: flow.data.method_name,
      reference: cleaned,
      reason: result.reason,
    });
  }
}

// ----- Screen builders ----------------------------------------------------

function buildChainDirectScreen(
  m: DBPaymentMethod,
  intent: OrderIntent,
): string {
  const heading =
    m.provider === 'usdt_bep20'
      ? '🟡 *USDT (BEP-20) — Direct Pay*'
      : m.provider === 'usdt_trc20'
        ? '🟢 *USDT (TRC-20) — Direct Pay*'
        : '🔵 *USDT (TON) — Direct Pay*';
  const lines: string[] = [
    heading,
    '',
    `*${intent.product_name}*  ×  *${intent.qty}*`,
    `Total to pay: *$${intent.total.toFixed(2)}*`,
    '',
    `\`${m.address ?? '(address not set)'}\``,
    '',
    `1️⃣ Send *exactly $${intent.total.toFixed(2)}* in USDT to the address above`,
    '2️⃣ Paste your *Transaction Hash (TXID)* below',
    '',
  ];
  if (m.provider === 'usdt_bep20') {
    lines.push(
      '⚠️ _AA Wallet users: paste the *Bundle Hash* from BscScan, not the AA TxHash._',
    );
  }
  if (m.provider === 'usdt_ton') {
    lines.push(
      '⚠️ _Make sure you send USDT (TON Jetton), not native TON. Paste the tx hash from Tonviewer / Tonscan._',
    );
  }
  lines.push('');
  lines.push('*Please send your TX hash below:*');
  return lines.join('\n');
}

function labelForMethod(m: DBPaymentMethod): string {
  const icon: Record<PaymentProvider, string> = {
    manual: '💳',
    binance_pay: '🟡',
    usdt_trc20: '🟢',
    usdt_bep20: '🟡',
    usdt_ton: '🔵',
    ltc: '⚪',
  };
  return `${icon[m.provider]} ${m.name}`;
}
