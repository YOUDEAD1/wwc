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
import {
  BINANCE_PAY_ID,
  BINANCE_PAY_NAME,
  BINANCE_TOPUP_WINDOW_MINUTES,
  generateNoteCode,
} from '../services/binance.js';
import { verifyAndCreditDeposit } from '../services/depositVerify.js';
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

    if (m.provider === 'usdt_trc20' || m.provider === 'usdt_bep20') {
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

  // ----- Auto-verify top-up flows: user submits Order ID / TX hash -----
  bot.on('message:text', async (ctx, next) => {
    const flow = ctx.session.userFlow;
    if (!flow) return next();

    // Slash commands always pass through to other handlers (and
    // simultaneously cancel the active flow so /menu, /start, /cancel
    // immediately return the user to a clean state).
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
    return next();
  });
}

async function handleBinancePayIdSubmit(
  ctx: AppCtx,
  flow: Extract<NonNullable<AppCtx['session']['userFlow']>, { type: 'binance_payid_topup' }>,
  text: string,
): Promise<void> {
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

  // Record a pending deposit. Amount starts as a placeholder (0.01)
  // so the database CHECK (amount > 0) passes — auto-verify will
  // overwrite it with the real Binance order amount on success.
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

  // Try auto-verify via Binance Pay queryOrder. If it succeeds the
  // user gets an instant credit; if not (e.g. direct Pay-ID transfers
  // that the merchant API can't introspect), we fall back to the
  // existing manual-verify message + admin log entry.
  const dep = await findDepositByReference(flow.data.note_code);
  let autoOk = false;
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
        logger.info(
          { depId, reason: result.reason },
          'Binance Pay auto-verify deferred to manual',
        );
      }
    } catch (err) {
      logger.warn({ err }, 'Binance Pay auto-verify threw');
    }
  }

  if (!autoOk) {
    await ctx.reply(
      renderMdHtml(
        [
          `✅ *Submitted (#${depId}).*`,
          '',
          `Order ID: \`${orderId}\``,
          `Note code: \`${flow.data.note_code}\``,
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
      noteCode: flow.data.note_code,
      orderId,
    });
  }
}

async function handleChainTopupSubmit(
  ctx: AppCtx,
  flow: Extract<NonNullable<AppCtx['session']['userFlow']>, { type: 'chain_topup' }>,
  text: string,
): Promise<void> {
  // Light validation on the tx hash format. TRC20: 64 hex chars.
  // BEP20: 0x + 64 hex chars. Accept either with optional 0x prefix.
  const cleaned = text.replace(/\s+/g, '');
  const expectsHexLen = flow.data.provider === 'usdt_trc20' ? 64 : 64;
  const stripped = cleaned.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]+$/.test(stripped) || stripped.length !== expectsHexLen) {
    await ctx.reply(
      renderMdHtml(
        flow.data.provider === 'usdt_trc20'
          ? '❌ That doesn\'t look like a TRON tx hash. Paste the 64-character hex transaction id from your wallet.'
          : '❌ That doesn\'t look like a BSC tx hash. Paste the `0x…` 66-character transaction id from your wallet.',
      ),
      { parse_mode: 'HTML' },
    );
    return;
  }

  const txHash = flow.data.provider === 'usdt_bep20' ? '0x' + stripped.toLowerCase() : stripped.toLowerCase();

  // Insert a pending deposit row first so we have something to credit
  // (and so failed verifications still show up in the admin pending
  // list with the tx hash + the verifier's reason note).
  let depId: number;
  try {
    const dep = await createDeposit({
      user_id: ctx.user.telegram_id,
      method: flow.data.method_name,
      amount: 0.01,
      reference: txHash,
      note: `On-chain tx submitted via auto-verify`,
      tx_hash: txHash,
    });
    depId = dep.id;
  } catch (err) {
    // The unique index on tx_hash will reject duplicates with code
    // 23505 — surface that to the user.
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
    // Persist the verifier's reason on the deposit note so the admin
    // sees it inline in the pending list.
    try {
      await setDepositNote(depId, `auto-verify failed: ${result.reason}`);
    } catch {
      /* noop — note column is best-effort */
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
          "Admin will check your payment manually and credit your wallet shortly.",
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
      noteCode: txHash,
      orderId: result.reason,
    });
  }
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

function buildChainTopupScreen(m: {
  name: string;
  address: string | null;
  min_amount: number;
  provider: string;
}): string {
  const network = m.provider === 'usdt_trc20' ? 'TRON (TRC20)' : 'BSC (BEP20)';
  const explorer =
    m.provider === 'usdt_trc20' ? 'https://tronscan.org/#/transaction/' : 'https://bscscan.com/tx/';
  return [
    `🟢 *${m.name}*`,
    '',
    `*Network:* ${network}`,
    `*Address:*`,
    `\`${m.address ?? '(not set)'}\``,
    `*Minimum:* $${m.min_amount}`,
    '',
    '1️⃣ Send any USDT amount to the address above.',
    '2️⃣ Wait for *1 confirmation* on-chain.',
    `3️⃣ Copy the *transaction hash* from your wallet (or [explorer](${explorer})) and paste it below.`,
    '',
    'The bot will automatically verify the transfer on-chain and credit your wallet — no admin approval needed.',
    '',
    '*Send your TX hash below.*',
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
    let label: string;
    if (m.provider === 'binance_pay') label = `💎 ${m.name}`;
    else if (m.provider === 'usdt_trc20') label = `🟢 ${m.name}`;
    else if (m.provider === 'usdt_bep20') label = `🟡 ${m.name}`;
    else label = `💳 ${m.name}`;
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
