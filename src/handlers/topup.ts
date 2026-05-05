import type { Composer } from 'grammy';
import { InlineKeyboard } from 'grammy';
import {
  createDeposit,
  findDepositByReference,
  getDeposit,
  listPaymentMethods,
  setDepositNote,
} from '../db/queries.js';
import { btn, inlineBtn } from '../keyboards/helpers.js';
import type { AppCtx } from '../middleware/user.js';
import { renderMdHtml } from '../services/premium.js';
import { fetchLtcUsdRate, quoteLtc } from '../services/chainVerify.js';
import { verifyAndCreditDeposit } from '../services/depositVerify.js';
import { logger } from '../logger.js';
import * as adminLog from '../services/adminLog.js';
import type { DBPaymentMethod, PaymentProvider } from '../types.js';

const LTC_QUOTE_TTL_MIN = 10;

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
      ctx.session.userFlow = {
        type: 'binance_payid_topup',
        step: 'order_id',
        data: {
          method_id: m.id,
          method_name: m.name,
          opened_at: Date.now(),
        },
      };
      await ctx.editMessageText(renderMdHtml(buildBinancePayScreen(m)), {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(btn(ctx.lang, 'back'), 'topup:open'),
      });
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
          min_amount: Number(m.min_amount) || 0,
        },
      };
      await ctx.editMessageText(renderMdHtml(buildChainTopupScreen(m)), {
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
          min_amount: Number(m.min_amount) || 1,
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

  // ----- Auto-verify top-up flows -----
  bot.on('message:text', async (ctx, next) => {
    const flow = ctx.session.userFlow;
    if (!flow) return next();

    const text = ctx.message.text.trim();
    if (text === '/cancel' || text.startsWith('/')) {
      ctx.session.userFlow = undefined;
      return next();
    }

    if (flow.type === 'binance_payid_topup') {
      await handleBinancePayIdSubmit(ctx, flow, text);
      return;
    }
    if (flow.type === 'chain_topup') {
      await handleChainTopupSubmit(ctx, flow, text);
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

// ----- Binance Pay Order-ID flow -----------------------------------------

async function handleBinancePayIdSubmit(
  ctx: AppCtx,
  flow: Extract<NonNullable<AppCtx['session']['userFlow']>, { type: 'binance_payid_topup' }>,
  text: string,
): Promise<void> {
  const orderId = text.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9]{6,64}$/.test(orderId)) {
    await ctx.reply(
      renderMdHtml(
        "❌ That doesn't look like a valid Binance Pay Order ID. Please paste only the order ID (digits/letters, 6–64 chars).",
      ),
      { parse_mode: 'HTML' },
    );
    return;
  }

  let depId: number;
  try {
    const dep = await createDeposit({
      user_id: ctx.user.telegram_id,
      method: flow.data.method_name,
      amount: 0.01,
      reference: orderId,
      tx_hash: orderId,
      note: `Binance Pay Order ID: ${orderId}`,
    });
    depId = dep.id;
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? '';
    if (/23505|duplicate/i.test(msg)) {
      await ctx.reply(
        renderMdHtml('⚠️ This Order ID has already been submitted.'),
        { parse_mode: 'HTML' },
      );
      ctx.session.userFlow = undefined;
      return;
    }
    logger.error({ err }, 'Pay-ID deposit insert failed');
    await ctx.reply(
      '⚠️ Could not record your submission. Please try again or contact support.',
    );
    ctx.session.userFlow = undefined;
    return;
  }
  ctx.session.userFlow = undefined;

  const dep = await findDepositByReference(orderId);
  let autoOk = false;
  let lastReason: string | null = null;
  if (dep) {
    try {
      const result = await verifyAndCreditDeposit({
        api: ctx.api,
        deposit: dep,
        submission: { merchantTradeNo: orderId },
        logUser: {
          telegram_id: ctx.user.telegram_id,
          username: ctx.user.username ?? null,
          first_name: ctx.user.first_name ?? null,
          email: ctx.user.email ?? null,
        },
      });
      if (result.ok) {
        autoOk = true;
        await ctx.reply(
          renderMdHtml(
            [
              `✅ *Auto-verified (#${depId}).*`,
              '',
              `Order ID: \`${orderId}\``,
              `Credited: *$${result.amount.toFixed(2)}*`,
              `New balance: *$${Number(result.newBalance).toFixed(2)}*`,
            ].join('\n'),
          ),
          {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard().text(btn(ctx.lang, 'back'), 'main:open'),
          },
        );
      } else {
        lastReason = result.reason;
        logger.info({ depId, reason: result.reason }, 'Binance Pay auto-verify deferred');
      }
    } catch (err) {
      lastReason = (err as Error)?.message ?? String(err);
      logger.warn({ err }, 'Binance Pay auto-verify threw');
    }
  }

  if (!autoOk) {
    if (lastReason) {
      try {
        await setDepositNote(depId, `auto-verify failed: ${lastReason}`);
      } catch {
        /* noop */
      }
    }
    await ctx.reply(
      renderMdHtml(
        [
          `✅ *Submitted (#${depId}).*`,
          '',
          `Order ID: \`${orderId}\``,
          '',
          "Admin will verify your payment on the Binance Pay dashboard and credit your wallet shortly. You'll get a confirmation message when it's done.",
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
      reference: orderId,
      reason: lastReason ?? undefined,
    });
  }
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
        renderMdHtml('⚠️ This transaction hash has already been submitted.'),
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
    logger.error({ err, depId, txHash }, 'chain auto-verify threw');
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
          `✅ *Auto-verified (#${depId}).*`,
          '',
          `Tx: \`${txHash}\``,
          `Credited: *$${result.amount.toFixed(2)}*`,
          `New balance: *$${Number(result.newBalance).toFixed(2)}*`,
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
          'Admin will check your payment manually and credit your wallet shortly.',
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
  if (usd < flow.data.min_amount) {
    await ctx.reply(
      renderMdHtml(
        `❌ Minimum top-up for this method is *$${flow.data.min_amount}*.`,
      ),
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
  const status = await ctx.reply(
    renderMdHtml(`🔎 *Looking up tx on Litecoin network…* (#${flow.data.deposit_id})`),
    { parse_mode: 'HTML' },
  );

  // Persist the tx hash on the existing deposit row so dedupe works.
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
    logger.error({ err, depId: flow.data.deposit_id }, 'LTC auto-verify threw');
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
          `✅ *Auto-verified (#${flow.data.deposit_id}).*`,
          '',
          `Tx: \`${cleaned}\``,
          `Credited: *$${result.amount.toFixed(2)}*`,
          `New balance: *$${Number(result.newBalance).toFixed(2)}*`,
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
          'Admin will check your payment manually and credit your wallet shortly.',
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

// ----- Screen builders ---------------------------------------------------

function buildBinancePayScreen(m: DBPaymentMethod): string {
  const lines = [
    '🟡 *Binance Pay Top-Up*',
    '',
    `*Pay ID:* \`${m.address ?? '(not configured)'}\``,
    `*Pay Name:* ${m.name}`,
    '',
    '1️⃣ Send any USDT amount to the Pay ID above',
    '2️⃣ Paste your *Order ID* below',
    '',
    `_Minimum:_ *$${m.min_amount}*`,
    '',
    '*Please send your Order ID below:*',
  ];
  return lines.join('\n');
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
  lines.push(`_Minimum:_ *$${m.min_amount}*`);
  lines.push('');
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
    `_Minimum top-up:_ *$${m.min_amount}*`,
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
  const kb = new InlineKeyboard();
  methods.forEach((m, i) => {
    kb.text(labelForMethod(m), `topup:method:${m.id}`);
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
