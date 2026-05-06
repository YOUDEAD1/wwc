import type { Composer } from 'grammy';
import { InlineKeyboard } from 'grammy';
import {
  createDeposit,
  getDeposit,
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
import { logger } from '../logger.js';
import * as adminLog from '../services/adminLog.js';
import type { DBPaymentMethod } from '../types.js';
import { getAdminContactUrlWithPrefill } from '../services/settings.js';

const LTC_QUOTE_TTL_MIN = 10;

export function registerTopup(bot: Composer<AppCtx>): void {
  bot.callbackQuery('topup:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.userFlow = undefined;
    await showTopupMenu(ctx, /* asEdit */ true);
  });

  // "Others" payment method — opens a small support card whose CTA
  // deep-links the user to the admin DM with a prefilled message
  // asking about adding another payment method. The :origin suffix
  // tells us which "Back" callback to use (top-up screen vs
  // direct-pay screen).
  bot.callbackQuery(/^pay:others:(topup|direct(?::\d+(?::\d+)?)?)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const origin = ctx.match[1] ?? 'topup';
    const backCallback = origin === 'topup' ? 'topup:open' : `pdpm:${origin.replace(/^direct:/, '')}`;
    const url = getAdminContactUrlWithPrefill(
      'Hey Admin i need help about another payment method for bot payment method name is : ',
    );
    const text = [
      '💡 *Other payment method*',
      '',
      'Please support, Us For another payment method.',
      '',
      'Tap the button below to message admin and let us know which method you\'d like — we\'ll add it as soon as we can.',
    ].join('\n');
    const kb = new InlineKeyboard()
      .url('💬 Message Admin', url)
      .row()
      .text(btn(ctx.lang, 'back'), backCallback);
    await ctx.editMessageText(renderMdHtml(text), {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
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
            reply_markup: new InlineKeyboard().text(btn(ctx.lang, 'back'), 'topup:open'),
          },
        );
        return;
      }
      ctx.session.userFlow = {
        type: 'chain_topup',
        step: 'tx_hash',
        data: {
          method_id: m.id,
          method_name: m.name,
          provider: m.provider,
          address: m.address,
        },
      };
      await ctx.editMessageText(renderMdHtml(buildChainTopupScreen(m)), {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(btn(ctx.lang, 'back'), 'topup:open'),
      });
      return;
    }

    if (m.provider === 'binance_pay') {
      if (!m.address || !m.pay_name) {
        await ctx.editMessageText(
          renderMdHtml(
            '⚠️ This Binance Pay method has no Pay ID / Pay Name configured. Please contact support.',
          ),
          {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard().text(btn(ctx.lang, 'back'), 'topup:open'),
          },
        );
        return;
      }
      // Anchor the 30-minute acceptance window on a real deposit row.
      let deposit_id: number;
      try {
        const dep = await createDeposit({
          user_id: ctx.user.telegram_id,
          method: m.name,
          amount: 0.01,
          note: 'Binance Pay screen opened — awaiting order id',
        });
        deposit_id = dep.id;
      } catch (err) {
        logger.error({ err }, 'Binance Pay: pre-deposit insert failed');
        await ctx.editMessageText(
          '⚠️ Could not start the Binance Pay top-up. Please try again or contact support.',
        );
        return;
      }
      ctx.session.userFlow = {
        type: 'binance_pay_topup',
        step: 'order_id',
        data: {
          method_id: m.id,
          method_name: m.name,
          pay_id: m.address,
          pay_name: m.pay_name,
          deposit_id,
        },
      };
      await ctx.editMessageText(renderMdHtml(buildBinancePayTopupScreen(m)), {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(btn(ctx.lang, 'back'), 'topup:open'),
      });
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
            reply_markup: new InlineKeyboard().text(btn(ctx.lang, 'back'), 'topup:open'),
          },
        );
        return;
      }
      ctx.session.userFlow = {
        type: 'ltc_topup',
        step: 'usd_amount',
        data: {
          method_id: m.id,
          method_name: m.name,
          address: m.address,
        },
      };
      await ctx.editMessageText(renderMdHtml(buildLtcUsdAmountScreen(m)), {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(btn(ctx.lang, 'back'), 'topup:open'),
      });
      return;
    }

    // ----- Manual provider — original simple flow -----
    const methodBody = ctx.t('topup.method.body', {
      name: m.name,
      instructions: m.instructions,
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
      amount: 0,
    });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(renderMdHtml(ctx.t('topup.requested', { id: dep.id })), {
      parse_mode: 'HTML',
    });
  });

  // ----- Auto-verify top-up flows -----
  bot.on('message:text', async (ctx, next) => {
    const flow = ctx.session.userFlow;
    if (!flow) return next();

    const text = ctx.message.text.trim();
    if (text === '/cancel' || text.startsWith('/')) {
      ctx.session.userFlow = undefined;
      return next();
    }

    if (flow.type === 'chain_topup') {
      await handleChainTopupSubmit(ctx, flow, text);
      return;
    }
    if (flow.type === 'binance_pay_topup') {
      await handleBinancePayOrderId(ctx, flow, text);
      return;
    }
    if (flow.type === 'ltc_topup') {
      if (flow.step === 'usd_amount') {
        await handleLtcUsdAmount(ctx, flow, text);
        return;
      }
      if (flow.step === 'tx_hash') {
        await handleLtcTxHash(ctx, flow, text);
        return;
      }
    }
    return next();
  });
}
// ----- USDT chain flow (BEP20 / TRC20 / TON) -----------------------------

async function handleChainTopupSubmit(
  ctx: AppCtx,
  flow: Extract<NonNullable<AppCtx['session']['userFlow']>, { type: 'chain_topup' }>,
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
    // TON: accept hex (64 chars) or base64 (43-44 chars)
    if (!/^[0-9a-fA-F]{64}$/.test(cleaned) && !/^[A-Za-z0-9+/=_-]{43,44}$/.test(cleaned)) {
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

  let depId: number;
  try {
    const dep = await createDeposit({
      user_id: ctx.user.telegram_id,
      method: flow.data.method_name,
      amount: 0.01,
      reference: txHash,
      note: 'On-chain tx submitted via auto-verify',
      tx_hash: txHash,
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
    logger.error({ err }, 'Chain top-up deposit insert failed');
    await ctx.reply(
      '⚠️ Could not record your submission. Please try again or contact support.',
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
    logger.error({ err, depId, txHash }, 'chain auto-verify threw');
    result = {
      ok: false as const,
      reason: `verifier crashed: ${(err as Error)?.message ?? String(err)}`,
    };
  }

  if (result.ok) {
    await verifying.done({
      text: [
        `✅ *Auto-verified (#${depId}).*`,
        '',
        `Tx: \`${txHash}\``,
        `Credited: *$${result.amount.toFixed(2)}*`,
        `New balance: *$${Number(result.newBalance).toFixed(2)}*`,
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
          'Admin will check your payment manually and credit your wallet shortly.',
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

// ----- LTC quote-on-display flow -----------------------------------------

async function handleLtcUsdAmount(
  ctx: AppCtx,
  flow: Extract<NonNullable<AppCtx['session']['userFlow']>, { type: 'ltc_topup'; step: 'usd_amount' }>,
  text: string,
): Promise<void> {
  const usd = Number(text.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(usd) || usd <= 0) {
    await ctx.reply(
      renderMdHtml('❌ Please send a positive USD amount (e.g. `10` or `25.50`).'),
      { parse_mode: 'HTML' },
    );
    return;
  }

  let rate: number;
  try {
    rate = await fetchLtcUsdRate();
  } catch (err) {
    logger.warn({ err }, 'LTC rate fetch failed');
    await ctx.reply(
      renderMdHtml(
        '⚠️ Could not fetch the LTC/USD rate right now. Please try again in a minute, or use a different payment method.',
      ),
      { parse_mode: 'HTML' },
    );
    return;
  }

  const { ltcAmount, expiresAt } = quoteLtc(usd, rate);
  const expiresAtMs = expiresAt.getTime();

  // Insert a pending deposit with the locked quote.
  let depId: number;
  try {
    const dep = await createDeposit({
      user_id: ctx.user.telegram_id,
      method: flow.data.method_name,
      amount: usd,
      expected_amount: ltcAmount,
      quote_expires_at: expiresAt.toISOString(),
      note: `LTC quote: $${usd} = ${ltcAmount} LTC @ $${rate}/LTC`,
    });
    depId = dep.id;
  } catch (err) {
    logger.error({ err }, 'LTC deposit insert failed');
    await ctx.reply(
      '⚠️ Could not lock the LTC quote. Please try again or contact support.',
    );
    ctx.session.userFlow = undefined;
    return;
  }

  ctx.session.userFlow = {
    type: 'ltc_topup',
    step: 'tx_hash',
    data: {
      ...flow.data,
      deposit_id: depId,
      usd_amount: usd,
      ltc_amount: ltcAmount,
      ltc_rate: rate,
      expires_at_ms: expiresAtMs,
    },
  };

  await ctx.reply(
    renderMdHtml(
      [
        '🟢 *Litecoin Top-Up Quote*',
        '',
        `*Send exactly:* \`${ltcAmount} LTC\``,
        `*To address:* \`${flow.data.address}\``,
        '',
        `_Locked rate:_ $${rate.toFixed(2)} per LTC`,
        `_Quote expires:_ ${LTC_QUOTE_TTL_MIN} min from now`,
        `_Credit on success:_ *$${usd.toFixed(2)}*`,
        '',
        '1️⃣ Send the LTC amount above to the address',
        '2️⃣ Paste your *transaction hash* below',
        '',
        '*Please send your TX hash below:*',
      ].join('\n'),
    ),
    {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text(btn(ctx.lang, 'back'), 'topup:open'),
    },
  );
}

async function handleLtcTxHash(
  ctx: AppCtx,
  flow: Extract<NonNullable<AppCtx['session']['userFlow']>, { type: 'ltc_topup'; step: 'tx_hash' }>,
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
        '⏰ Your LTC quote expired. Tap *Top-up* again to get a fresh rate.',
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

  // Persist the tx hash on the existing deposit row so dedupe works.
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
    logger.error({ err, depId }, 'LTC auto-verify threw');
    result = {
      ok: false as const,
      reason: `verifier crashed: ${(err as Error)?.message ?? String(err)}`,
    };
  }

  if (result.ok) {
    await verifying.done({
      text: [
        `✅ *Auto-verified (#${depId}).*`,
        '',
        `Tx: \`${cleaned}\``,
        `Credited: *$${result.amount.toFixed(2)}*`,
        `New balance: *$${Number(result.newBalance).toFixed(2)}*`,
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
          'Admin will check your payment manually and credit your wallet shortly.',
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

// ----- Screen builders ---------------------------------------------------

function buildBinancePayTopupScreen(m: DBPaymentMethod): string {
  return [
    '🟡 *Binance Pay — Deposit*',
    '',
    `*Pay ID:* \`${m.address ?? '(not set)'}\``,
    `*Binance Pay Name:* \`${m.pay_name ?? '(not set)'}\``,
    '',
    'Send any USDT amount to the Pay ID above, then paste your *Order ID* below.',
    '',
    '⏰ _Only payments started after opening this screen and completed within 30 minutes will be credited._',
    '',
    '*Please send your Order ID below:*',
  ].join('\n');
}

async function handleBinancePayOrderId(
  ctx: AppCtx,
  flow: Extract<
    NonNullable<AppCtx['session']['userFlow']>,
    { type: 'binance_pay_topup' }
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

  // Rate-limit Binance Pay order-id submissions per user to prevent
  // brute-force lookups. 5 attempts / 60s is generous for a real
  // user (one paste per deposit) and tight enough to make scripted
  // probing useless.
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
        `⚠️ This deposit has already been ${dep.status}. Open a fresh Binance Pay screen to submit a new order id.`,
      ),
      { parse_mode: 'HTML' },
    );
    return;
  }
  // Persist the user-pasted order id on the deposit row's reference
  // for admin-side traceability. The verifier will overwrite tx_hash
  // with the Binance internal transactionId on success.
  try {
    await setDepositNote(depId, `Binance Pay order id submitted: ${orderId}`);
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
    logger.error({ err, depId, orderId }, 'binance_pay auto-verify threw');
    result = {
      ok: false as const,
      reason: `verifier crashed: ${(err as Error)?.message ?? String(err)}`,
    };
  }

  if (result.ok) {
    await verifying.done({
      text: [
        `✅ *Transaction Confirmed!* (#${depId})`,
        '',
        `Order ID: \`${orderId}\``,
        `Credited: *$${result.amount.toFixed(3)}*`,
        `New balance: *$${Number(result.newBalance).toFixed(2)}*`,
      ].join('\n'),
      reply_markup: successKeyboard(ctx.lang),
    });
  } else {
    const klass = classifyReason(result.reason);
    try {
      await setDepositNote(depId, `auto-verify failed: ${result.reason} (order id ${orderId})`);
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
          'Admin will check your payment manually and credit your wallet shortly.',
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

function buildChainTopupScreen(m: DBPaymentMethod): string {
  const heading =
    m.provider === 'usdt_bep20'
      ? '🟡 *USDT (BEP-20) Top-Up*'
      : m.provider === 'usdt_trc20'
        ? '🟢 *USDT (TRC-20) Top-Up*'
        : '🔵 *USDT (TON) Top-Up*';
  const lines: string[] = [
    heading,
    '',
    `\`${m.address ?? '(address not set)'}\``,
    '',
    '1️⃣ Send any USDT amount to the address above',
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
  lines.push('*Please send your TX hash below:*');
  return lines.join('\n');
}

function buildLtcUsdAmountScreen(m: DBPaymentMethod): string {
  return [
    '⚪ *Litecoin Top-Up*',
    '',
    `*Receiving address:* \`${m.address ?? '(not configured)'}\``,
    '',
    'Litecoin is a volatile coin, so we lock a USD↔LTC rate for *10 minutes* before you send.',
    '',
    '*How much (in USD) do you want to top up?*',
    '_Reply with just the amount, e.g._ `10` _or_ `25.50`',
  ].join('\n');
}

async function showTopupMenu(ctx: AppCtx, asEdit = false) {
  const methods = await listPaymentMethods();
  if (methods.length === 0) {
    const text = renderMdHtml(ctx.t('topup.no_methods'));
    if (asEdit) await ctx.editMessageText(text, { parse_mode: 'HTML' });
    else await ctx.reply(text);
    return;
  }
  const kb = paymentMethodsKeyboard(
    ctx.lang,
    methods,
    (id) => `topup:method:${id}`,
    'pay:others:topup',
    'main:open',
  );
  // `topup.choose_method` is now the user-facing heading
  // ("👛 Top Up Wallet") — no need to prepend the legacy title key
  // since the locale already includes the wallet emoji.
  const text = ctx.t('topup.choose_method');
  const html = renderMdHtml(text);
  if (asEdit) {
    await ctx.editMessageText(html, { parse_mode: 'HTML', reply_markup: kb });
  } else {
    await ctx.reply(html, { parse_mode: 'HTML', reply_markup: kb });
  }
}


