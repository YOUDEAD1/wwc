/**
 * Phase B — per-order direct-pay handlers.
 *
 * Wires the four auto-verify networks (USDT BEP20 / TRC20 / TON,
 * LTC) into the checkout flow so a buyer can pay for a *specific*
 * product directly with crypto rather than topping up their wallet
 * first.
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
import type { Composer } from 'grammy';
import { InlineKeyboard } from 'grammy';
import {
  createDeposit,
  getDeposit,
  getProduct,
  listPaymentMethods,
  setDepositNote,
  setDepositStatus,
} from '../db/queries.js';
import { btn } from '../keyboards/helpers.js';
import { paymentMethodsKeyboard } from '../keyboards/payMethods.js';
import type { AppCtx } from '../middleware/user.js';
import { renderMdHtml } from '../services/premium.js';
import { fetchLtcUsdRate, quoteLtc } from '../services/chainVerify.js';
import { verifyAndCreditDeposit } from '../services/depositVerify.js';
import { classifyReason, friendlyReason } from '../services/verifyReason.js';
import { startVerifyingMessage } from '../services/verifyingMsg.js';
import {
  manualReviewKeyboard,
  rejectionKeyboard,
  successKeyboard,
} from '../keyboards/verifyResult.js';
import { consume, formatRetryAfter } from '../services/rateLimit.js';
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

    const kb = paymentMethodsKeyboard(
      ctx.lang,
      methods,
      (mid) => `pdpm:${id}:${mid}`,
      `pay:others:direct:${id}`,
      `buy:${p.id}`,
    );

    // Direct-Pay "Select payment method" card — minimal layout per
    // user spec:
    //
    //   💸 Select payment method
    //   <product-glyph> Product name × Qty
    //   💳 Total: 2.00 USDT
    //   🔎 Please send the exact amount for verification.
    //
    // The Order-summary block stays on the *Buy Now* card (shop.ts);
    // this screen is only the actual pay-method picker, so it just
    // re-states the product + total before the keyboard.
    //
    // The product glyph uses the product's own premium emoji_id (with
    // the unicode emoji as fallback). We can't register it in the
    // EMOJI map (it's per-product / dynamic), so we render via a
    // placeholder token that's safe across the markdown→HTML pipeline
    // (alphanumerics + underscore aren't HTML-escaped), then swap it
    // post-render for the raw `<tg-emoji>` HTML.
    const PRODUCT_GLYPH_PLACEHOLDER = 'XPRODUCTGLYPHX';
    const productUnicode = p.emoji && p.emoji.length > 0 ? p.emoji : '🎁';
    // Defensive HTML-escape of the product fields so a stray `"` /
    // `<` in admin-typed values can't break out of the attribute or
    // smuggle markup.
    const escAttr = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const escText = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const productGlyphHtml =
      p.emoji_id && p.emoji_id.length > 0
        ? `<tg-emoji emoji-id="${escAttr(p.emoji_id)}">${escText(productUnicode)}</tg-emoji>`
        : escText(productUnicode);
    const body = [
      '{title} *Select payment method*',
      '',
      `${PRODUCT_GLYPH_PLACEHOLDER} *${intent.product_name}* × *${intent.qty}*`,
      `{total} *Total:* ${intent.total.toFixed(2)} USDT`,
      '',
      '{verify} Please send the exact amount for verification.',
    ].join('\n');
    const html = renderMdHtml(body, {
      title: 'direct_pay_title',
      total: 'direct_pay_total',
      verify: 'direct_pay_verify',
    }).replace(PRODUCT_GLYPH_PLACEHOLDER, productGlyphHtml);

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(html, {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
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

    if (m.provider === 'binance_pay') {
      if (!m.address || !m.pay_name) {
        await ctx.editMessageText(
          renderMdHtml(
            '⚠️ This Binance Pay method has no Pay ID / Pay Name configured. Please pick another network.',
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

      // Anchor the 30-minute acceptance window on a real deposit row,
      // and lock the OrderIntent into it so the verifier can fulfil
      // the order on success instead of crediting the wallet.
      let depId: number;
      try {
        const dep = await createDeposit({
          user_id: ctx.user.telegram_id,
          method: m.name,
          amount: intent.total,
          note: 'Direct-pay Binance Pay screen opened — awaiting order id',
          order_intent: intent,
        });
        depId = dep.id;
      } catch (err) {
        logger.error({ err }, 'direct-pay Binance Pay deposit insert failed');
        await ctx.editMessageText(
          '⚠️ Could not start the Binance Pay payment. Please try again or pick another network.',
        );
        return;
      }

      ctx.session.userFlow = {
        type: 'direct_binance',
        step: 'order_id',
        data: {
          method_id: m.id,
          method_name: m.name,
          pay_id: m.address,
          pay_name: m.pay_name,
          deposit_id: depId,
          intent,
        },
      };

      await ctx.editMessageText(
        renderMdHtml(buildBinanceDirectScreen(m, intent)),
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

  // Step 4 — text submissions for in-flight direct-pay flows.
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
    if (flow.type === 'direct_binance') {
      await handleBinanceDirectSubmit(ctx, flow, text);
      return;
    }
    return next();
  });
}

// ----- Binance Pay direct -------------------------------------------------

async function handleBinanceDirectSubmit(
  ctx: AppCtx,
  flow: Extract<
    NonNullable<AppCtx['session']['userFlow']>,
    { type: 'direct_binance' }
  >,
  text: string,
): Promise<void> {
  const cleaned = text.replace(/\s+/g, '');
  if (!/^\d{6,}$/.test(cleaned)) {
    await ctx.reply(
      renderMdHtml(
        "❌ That doesn't look like a Binance Pay Order ID. It should be the 18-digit numeric ID shown on the Binance Pay receipt (e.g. `430098765432109876`).",
      ),
      { parse_mode: 'HTML' },
    );
    return;
  }
  const orderId = cleaned;
  const depId = flow.data.deposit_id;

  // Rate-limit per user (shares the same key namespace as topup so
  // a single user can't probe via both flows in parallel).
  const rl = consume(`binance_pay:${ctx.user.telegram_id}`, 5, 60_000);
  if (!rl.ok) {
    await ctx.reply(
      renderMdHtml(
        `⏱ Too many Order ID attempts. Please try again in ${formatRetryAfter(rl.retryAfterMs)}.`,
      ),
      { parse_mode: 'HTML' },
    );
    return;
  }
  ctx.session.userFlow = undefined;

  const dep = await getDeposit(depId);
  if (!dep) {
    await ctx.reply('⚠️ Internal error: deposit row missing. Please reopen the screen.');
    return;
  }
  if (dep.status !== 'pending') {
    await ctx.reply(
      renderMdHtml(
        `⚠️ This deposit has already been ${dep.status}. Open a fresh direct-pay screen if you want to pay again.`,
      ),
      { parse_mode: 'HTML' },
    );
    return;
  }
  try {
    await setDepositNote(depId, `Direct-pay Binance Pay order id submitted: ${orderId}`);
  } catch {
    /* noop */
  }

  const verifying = await startVerifyingMessage({
    api: ctx.api,
    chatId: ctx.chat!.id,
    txId: orderId,
  });

  let result;
  try {
    result = await verifyAndCreditDeposit({
      api: ctx.api,
      deposit: dep,
      submission: { orderId },
      logUser: {
        telegram_id: ctx.user.telegram_id,
        username: ctx.user.username ?? null,
        first_name: ctx.user.first_name ?? null,
        email: ctx.user.email ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, depId, orderId }, 'direct binance auto-verify threw');
    result = {
      ok: false as const,
      reason: 'verifier crashed — admin will check manually',
    };
  }

  if (result.ok) {
    await verifying.done({
      text: [
        `✅ *Direct-pay verified (deposit #${depId}).*`,
        '',
        `Order ID: \`${orderId}\``,
        `Charged: *$${Number(result.amount).toFixed(3)}*`,
      ].join('\n'),
      reply_markup: successKeyboard(ctx.lang),
    });
  } else {
    const klass = classifyReason(result.reason);
    try {
      await setDepositNote(
        depId,
        `auto-verify failed: ${result.reason} (order id ${orderId})`,
      );
    } catch {
      /* noop */
    }
    if (klass === 'duplicate') {
      await verifying.done({
        text: [
          `❌ *Already-used order (#${depId}).*`,
          '',
          `Order ID: \`${orderId}\``,
          '_This Binance Pay order has already been used to credit a previous deposit. Each order can only be used once._',
        ].join('\n'),
        reply_markup: successKeyboard(ctx.lang),
      });
    } else if (klass === 'reject') {
      await setDepositStatus(depId, 'rejected').catch(() => undefined);
      await verifying.done({
        text: [
          `❌ *Disapproved (#${depId}).*`,
          '',
          `Order ID: \`${orderId}\``,
          `_${friendlyReason(result.reason)}_`,
          '',
          'This order did not match our records. If you believe this is a mistake, tap *Admin Help* below.',
        ].join('\n'),
        reply_markup: rejectionKeyboard(ctx.lang, depId, orderId, result.reason),
      });
    } else {
      await verifying.done({
        text: [
          `⏳ *Submitted (#${depId}) — pending admin review.*`,
          '',
          `Order ID: \`${orderId}\``,
          `_${friendlyReason(result.reason)}_`,
          '',
          'Your order will be delivered as soon as admin verifies the payment manually.',
        ].join('\n'),
        reply_markup: manualReviewKeyboard(ctx.lang, depId, orderId),
      });
      void adminLog.logTopupSubmitted(ctx.api, {
        user: {
          telegram_id: ctx.user.telegram_id,
          username: ctx.user.username ?? null,
          first_name: ctx.user.first_name ?? null,
          email: ctx.user.email ?? null,
        },
        depositDbId: depId,
        method: flow.data.method_name,
        reference: orderId,
        reason: result.reason,
      });
    }
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
        renderMdHtml(
          '❌ *Already-used transaction.*\n\nThis transaction hash has already been used to credit a previous deposit. Each transaction can only be used once.',
        ),
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
  const verifying = await startVerifyingMessage({
    api: ctx.api,
    chatId: ctx.chat!.id,
    txId: txHash,
  });

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
    await verifying.done({
      text: [
        `✅ *Direct-pay verified (deposit #${depId}).*`,
        '',
        `Tx: \`${txHash}\``,
        `Charged: *$${result.amount.toFixed(2)}*`,
      ].join('\n'),
      reply_markup: successKeyboard(ctx.lang),
    });
  } else {
    const klass = classifyReason(result.reason);
    try {
      await setDepositNote(depId, `auto-verify failed: ${result.reason}`);
    } catch {
      /* noop */
    }
    if (klass === 'duplicate') {
      await verifying.done({
        text: [
          `❌ *Already-used transaction (#${depId}).*`,
          '',
          `Tx: \`${txHash}\``,
          '_This transaction has already been used to credit a previous deposit. Each transaction can only be used once._',
        ].join('\n'),
        reply_markup: successKeyboard(ctx.lang),
      });
    } else if (klass === 'reject') {
      await setDepositStatus(depId, 'rejected').catch(() => undefined);
      await verifying.done({
        text: [
          `❌ *Disapproved (#${depId}).*`,
          '',
          `Tx: \`${txHash}\``,
          `_${friendlyReason(result.reason)}_`,
          '',
          'This transaction did not match our records. If you believe this is a mistake, tap *Admin Help* below.',
        ].join('\n'),
        reply_markup: rejectionKeyboard(ctx.lang, depId, txHash, result.reason),
      });
    } else {
      await verifying.done({
        text: [
          `⏳ *Submitted (#${depId}) — pending admin review.*`,
          '',
          `Tx: \`${txHash}\``,
          `_${friendlyReason(result.reason)}_`,
          '',
          'Your order will be delivered as soon as admin verifies the payment manually.',
        ].join('\n'),
        reply_markup: manualReviewKeyboard(ctx.lang, depId, txHash),
      });
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
  const depId = flow.data.deposit_id;

  const dep = await getDeposit(depId);
  if (!dep) {
    await ctx.reply('⚠️ Internal error: deposit row missing.');
    return;
  }
  const verifying = await startVerifyingMessage({
    api: ctx.api,
    chatId: ctx.chat!.id,
    txId: cleaned,
  });

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
    logger.error({ err, depId }, 'direct LTC auto-verify threw');
    result = {
      ok: false as const,
      reason: `verifier crashed: ${(err as Error)?.message ?? String(err)}`,
    };
  }

  if (result.ok) {
    await verifying.done({
      text: [
        `✅ *Direct-pay verified (deposit #${depId}).*`,
        '',
        `Tx: \`${cleaned}\``,
        `Charged: *$${result.amount.toFixed(2)}*`,
      ].join('\n'),
      reply_markup: successKeyboard(ctx.lang),
    });
  } else {
    const klass = classifyReason(result.reason);
    try {
      await setDepositNote(depId, `auto-verify failed: ${result.reason}`);
    } catch {
      /* noop */
    }
    if (klass === 'duplicate') {
      await verifying.done({
        text: [
          `❌ *Already-used transaction (#${depId}).*`,
          '',
          `Tx: \`${cleaned}\``,
          '_This transaction has already been used to credit a previous deposit. Each transaction can only be used once._',
        ].join('\n'),
        reply_markup: successKeyboard(ctx.lang),
      });
    } else if (klass === 'reject') {
      await setDepositStatus(depId, 'rejected').catch(() => undefined);
      await verifying.done({
        text: [
          `❌ *Disapproved (#${depId}).*`,
          '',
          `Tx: \`${cleaned}\``,
          `_${friendlyReason(result.reason)}_`,
          '',
          'This transaction did not match our records. If you believe this is a mistake, tap *Admin Help* below.',
        ].join('\n'),
        reply_markup: rejectionKeyboard(ctx.lang, depId, cleaned, result.reason),
      });
    } else {
      await verifying.done({
        text: [
          `⏳ *Submitted (#${depId}) — pending admin review.*`,
          '',
          `Tx: \`${cleaned}\``,
          `_${friendlyReason(result.reason)}_`,
          '',
          'Your order will be delivered as soon as admin verifies the payment manually.',
        ].join('\n'),
        reply_markup: manualReviewKeyboard(ctx.lang, depId, cleaned),
      });
      void adminLog.logTopupSubmitted(ctx.api, {
        user: {
          telegram_id: ctx.user.telegram_id,
          username: ctx.user.username ?? null,
          first_name: ctx.user.first_name ?? null,
          email: ctx.user.email ?? null,
        },
        depositDbId: depId,
        method: flow.data.method_name,
        reference: cleaned,
        reason: result.reason,
      });
    }
  }
}

// ----- Screen builders ----------------------------------------------------

function buildBinanceDirectScreen(
  m: DBPaymentMethod,
  intent: OrderIntent,
): string {
  return [
    '🟡 *Binance Pay — Direct Pay*',
    '',
    `*${intent.product_name}*  ×  *${intent.qty}*`,
    `Total to pay: *$${intent.total.toFixed(2)}*`,
    '',
    `*Pay ID:* \`${m.address ?? '(not set)'}\``,
    `*Binance Pay Name:* \`${m.pay_name ?? '(not set)'}\``,
    '',
    `1️⃣ Send *exactly $${intent.total.toFixed(2)}* in USDT to the Pay ID above`,
    '2️⃣ Paste your *Order ID* below',
    '',
    '⏰ _Only payments completed within 30 minutes of opening this screen are auto-verified. Earlier or later payments still go to manual admin review._',
    '',
    '*Please send your Order ID below:*',
  ].join('\n');
}

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


