/**
 * Unified deposit auto-verification.
 *
 * The user-facing top-up flow calls into `verifyAndCreditDeposit()`.
 * It:
 *   1. Looks at the deposit's payment method to pick a verifier
 *      (Binance Pay / TRC20 / BEP20 / TON / LTC).
 *   2. Calls the verifier with the user-submitted tx hash or
 *      Binance Pay Order ID.
 *   3. On success, atomically updates the deposit's amount + status
 *      to `approved`, persists the tx hash for dedupe, and credits
 *      the user's wallet via the existing `credit()` helper.
 *   4. Returns a structured result the caller can show to the user.
 *
 * Manual-only providers (`provider === 'manual'`) skip auto-verify
 * entirely so the existing admin-approval UX is preserved.
 */
import type { Api } from 'grammy';
import { logger } from '../logger.js';
import {
  findDepositByTxHash,
  setDepositStatus,
  setDepositAmount,
  setDepositTxHash,
  listPaymentMethods,
} from '../db/queries.js';
import type { DBDeposit, DBPaymentMethod } from '../types.js';
import { credit } from './wallet.js';
import * as adminLog from './adminLog.js';
import {
  verifyTrc20Tx,
  verifyBep20Tx,
  verifyTonUsdtTx,
  verifyLtcTx,
} from './chainVerify.js';
import { findPayTransactionByOrderId, isBinancePayEnabled } from './binance.js';
import { fulfilOrderForDeposit } from './orderFulfill.js';

/**
 * How long after a deposit row is created can a Binance Pay Order ID
 * still be accepted. Matches the in-bot copy: "Only payments started
 * after opening this screen and completed within 30 minutes will be
 * credited."
 */
const BINANCE_PAY_WINDOW_MS = 30 * 60 * 1000;

/**
 * Lenient pre-window slack — the Binance `transactionTime` may land
 * a few seconds before the deposit row's `created_at` because of
 * clock skew between Binance and Supabase, so we accept anything
 * within a 5-minute pre-window.
 */
const BINANCE_PAY_PRE_WINDOW_SLACK_MS = 5 * 60 * 1000;

/** Truncate a decimal value to 3 places (matches the Loguetown UX). */
function truncate3(n: number): number {
  return Math.floor(n * 1000) / 1000;
}

export type AutoVerifyResult =
  | {
      ok: true;
      /**
       * Amount processed in USD. For LTC deposits this is the
       * locked-in USD quote (NOT the on-chain LTC value).
       */
      amount: number;
      /**
       * Wallet balance after credit. Only meaningful when the
       * deposit was a wallet top-up OR when a direct-pay deposit
       * fell back to a wallet refund (e.g. out-of-stock). For a
       * delivered direct-pay order this is the user's existing
       * balance (untouched).
       */
      newBalance: number;
      sender?: string | null;
      provider: DBPaymentMethod['provider'];
      /**
       * When the deposit was a per-order direct-pay and the order
       * was delivered, the public order ID for the user-facing
       * confirmation message. Null for plain wallet top-ups and for
       * direct-pay orders that fell back to a wallet refund.
       */
      orderPublicId?: string | null;
    }
  | { ok: false; reason: string };

/**
 * Resolve the payment method row for a deposit. Match on
 * `payment_methods.name === deposits.method`.
 */
async function resolveMethod(deposit: DBDeposit): Promise<DBPaymentMethod | null> {
  const methods = await listPaymentMethods();
  return methods.find((m) => m.name === deposit.method) ?? null;
}

export async function verifyAndCreditDeposit(args: {
  api: Api;
  deposit: DBDeposit;
  submission: { txHash?: string; orderId?: string };
  logUser?: {
    telegram_id: number;
    username: string | null;
    first_name: string | null;
    email: string | null;
  };
}): Promise<AutoVerifyResult> {
  const { deposit, submission } = args;
  if (deposit.status !== 'pending') {
    return { ok: false, reason: `deposit already ${deposit.status}` };
  }
  const method = await resolveMethod(deposit);
  if (!method) {
    return { ok: false, reason: 'payment method not found' };
  }
  const provider = method.provider;
  if (provider === 'manual') {
    return { ok: false, reason: 'manual provider — no auto-verify' };
  }

  // ----- Binance Pay (personal-account /sapi/v1/pay/transactions) -----
  if (provider === 'binance_pay') {
    const orderId = submission.orderId?.trim();
    if (!orderId) return { ok: false, reason: 'binance pay order id required' };
    if (!method.address) {
      return { ok: false, reason: 'merchant pay id not configured on payment method' };
    }
    if (!isBinancePayEnabled()) {
      return {
        ok: false,
        reason: 'binance api credentials not set on this deployment',
      };
    }

    // Pre-window slack absorbs clock skew. The post-window cap is
    // the user-visible promise ("completed within 30 minutes").
    const depositCreatedAt = new Date(deposit.created_at).getTime();
    if (!Number.isFinite(depositCreatedAt)) {
      return { ok: false, reason: 'deposit created_at unparseable' };
    }
    const startTime = depositCreatedAt - BINANCE_PAY_PRE_WINDOW_SLACK_MS;
    const endTime = depositCreatedAt + BINANCE_PAY_WINDOW_MS;

    const result = await findPayTransactionByOrderId(orderId, { startTime, endTime });
    if (!result.ok) return { ok: false, reason: result.reason };
    const tx = result.data;
    if (!tx) {
      return {
        ok: false,
        reason:
          'order id not found in your Binance Pay history within the 30-minute window',
      };
    }

    if (tx.orderType !== 'C2C') {
      return {
        ok: false,
        reason: `unsupported binance pay order type: ${tx.orderType}`,
      };
    }
    if (tx.currency !== 'USDT') {
      return {
        ok: false,
        reason: `only USDT binance pay deposits are auto-verified (got ${tx.currency})`,
      };
    }
    const receiverPayId = tx.receiverInfo?.binanceId;
    if (receiverPayId === undefined || String(receiverPayId) !== String(method.address)) {
      return {
        ok: false,
        reason:
          "order receiver doesn't match the merchant pay id — transaction belongs to another account",
      };
    }

    const txTime = Number(tx.transactionTime);
    if (!Number.isFinite(txTime)) {
      return { ok: false, reason: 'binance returned non-numeric transactionTime' };
    }
    if (txTime < depositCreatedAt - BINANCE_PAY_PRE_WINDOW_SLACK_MS) {
      return {
        ok: false,
        reason: 'order was paid before this deposit screen was opened',
      };
    }
    if (txTime > depositCreatedAt + BINANCE_PAY_WINDOW_MS) {
      return {
        ok: false,
        reason: 'order was paid more than 30 minutes after this deposit screen was opened',
      };
    }

    const rawAmount = Number(tx.amount);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      return { ok: false, reason: `binance returned non-positive amount: ${tx.amount}` };
    }
    const amount = truncate3(rawAmount);

    // Direct-pay amount guard. When the deposit carries an order
    // intent, the user is paying for a *specific* product —
    // anything less than the locked total must defer so we never
    // fulfil an order for less than its price. Allow a tiny epsilon
    // for floating-point rounding.
    if (deposit.order_intent) {
      const required = Number(deposit.order_intent.total);
      if (Number.isFinite(required) && amount + 0.005 < required) {
        return {
          ok: false,
          reason: `paid amount $${amount.toFixed(3)} is less than order total $${required.toFixed(2)}`,
        };
      }
    }

    // Dedupe on the Binance internal transactionId. Stored in the
    // existing `tx_hash` column whose partial-unique index already
    // prevents double-credit across providers.
    const txId = String(tx.transactionId);
    const dedupeOk = await checkDedupe(txId, deposit.id);
    if (!dedupeOk.ok) return dedupeOk;

    return finalizeApproval({
      api: args.api,
      deposit,
      method,
      amount,
      txHash: txId,
      sender: tx.payerInfo?.name ?? null,
      logUser: args.logUser,
    });
  }

  // ----- USDT chain providers (TRC20 / BEP20 / TON) -----
  if (
    provider === 'usdt_trc20' ||
    provider === 'usdt_bep20' ||
    provider === 'usdt_ton'
  ) {
    const txHash = submission.txHash?.trim();
    if (!txHash) return { ok: false, reason: 'tx hash required' };
    if (!method.address) return { ok: false, reason: 'wallet address not set' };

    const dedupeOk = await checkDedupe(txHash, deposit.id);
    if (!dedupeOk.ok) return dedupeOk;

    // Minimum-amount enforcement was removed at the user's request —
    // verifiers now accept any non-zero on-chain amount.
    const expectedAddress = method.address;

    let result;
    if (provider === 'usdt_trc20') {
      result = await verifyTrc20Tx({ txHash, expectedAddress, minAmount: 0 });
    } else if (provider === 'usdt_bep20') {
      result = await verifyBep20Tx({ txHash, expectedAddress, minAmount: 0 });
    } else {
      result = await verifyTonUsdtTx({ txHash, expectedAddress, minAmount: 0 });
    }
    if (!result.ok) return { ok: false, reason: result.reason };

    // Direct-pay amount guard. Same logic as the binance_pay branch:
    // never fulfil an order if the user paid less than the locked
    // total. The chain verifiers report the on-chain USDT amount,
    // which is 1:1 with USD for our purposes.
    if (deposit.order_intent) {
      const required = Number(deposit.order_intent.total);
      if (
        Number.isFinite(required) &&
        Number(result.amount) + 0.01 < required
      ) {
        return {
          ok: false,
          reason: `paid amount $${Number(result.amount).toFixed(2)} is less than order total $${required.toFixed(2)}`,
        };
      }
    }

    return finalizeApproval({
      api: args.api,
      deposit,
      method,
      amount: result.amount,
      txHash,
      sender: result.sender,
      logUser: args.logUser,
    });
  }

  // ----- LTC native (quote-on-display flow) -----
  if (provider === 'ltc') {
    const txHash = submission.txHash?.trim();
    if (!txHash) return { ok: false, reason: 'tx hash required' };
    if (!method.address) return { ok: false, reason: 'wallet address not set' };

    if (deposit.expected_amount === null || deposit.expected_amount === undefined) {
      return {
        ok: false,
        reason: 'LTC deposit has no locked quote — admin should approve manually',
      };
    }
    if (deposit.quote_expires_at) {
      const exp = new Date(deposit.quote_expires_at).getTime();
      if (Number.isFinite(exp) && Date.now() > exp) {
        return {
          ok: false,
          reason: 'LTC quote expired — admin should approve manually',
        };
      }
    }

    const dedupeOk = await checkDedupe(txHash, deposit.id);
    if (!dedupeOk.ok) return dedupeOk;

    const result = await verifyLtcTx({
      txHash,
      expectedAddress: method.address,
      expectedLtcAmount: Number(deposit.expected_amount),
    });
    if (!result.ok) return { ok: false, reason: result.reason };

    // Credit the locked-in USD amount, not the on-chain LTC value.
    const usdToCredit = Number(deposit.amount);
    return finalizeApproval({
      api: args.api,
      deposit,
      method,
      amount: usdToCredit,
      txHash,
      sender: result.sender,
      logUser: args.logUser,
    });
  }

  return { ok: false, reason: `unsupported provider: ${provider as string}` };
}

async function checkDedupe(
  txHash: string,
  depositId: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const existing = await findDepositByTxHash(txHash);
  if (existing && existing.id !== depositId) {
    return { ok: false, reason: `tx already used by deposit #${existing.id}` };
  }
  return { ok: true };
}

async function finalizeApproval(args: {
  api: Api;
  deposit: DBDeposit;
  method: DBPaymentMethod;
  amount: number;
  txHash: string;
  sender: string | null;
  logUser?: {
    telegram_id: number;
    username: string | null;
    first_name: string | null;
    email: string | null;
  };
}): Promise<AutoVerifyResult> {
  const { api, deposit, method } = args;
  if (Number(deposit.amount) !== args.amount) {
    await setDepositAmount(deposit.id, args.amount);
  }
  await setDepositTxHash(deposit.id, args.txHash);
  await setDepositStatus(deposit.id, 'approved');

  // ----- Direct-pay branch (per-order) -----
  // When the deposit carries an `order_intent`, we deliver the order
  // directly instead of crediting the wallet. fulfilOrderForDeposit
  // refunds to the wallet when the product is gone / out of stock,
  // so the user is never out of money.
  if (deposit.order_intent) {
    const intent = deposit.order_intent;
    let orderPublicId: string | null = null;
    let refundedToWallet = false;
    try {
      const result = await fulfilOrderForDeposit({
        api,
        deposit,
        intent,
        provider: method.provider,
        methodName: method.name,
      });
      if (result.ok) {
        orderPublicId = result.orderPublicId;
      } else if (result.refundedToWallet) {
        refundedToWallet = true;
      }
    } catch (err) {
      logger.error(
        { err, deposit_id: deposit.id },
        'finalizeApproval: direct-pay fulfilment threw — refunding to wallet',
      );
      await credit(
        deposit.user_id,
        Number(intent.total),
        `deposit:${deposit.id}:fulfil_error`,
        'deposit_credit',
      );
      refundedToWallet = true;
    }

    void adminLog
      .logTopupResolved(api, {
        user: args.logUser ?? {
          telegram_id: deposit.user_id,
          username: null,
          first_name: null,
          email: null,
        },
        depositDbId: deposit.id,
        method: deposit.method,
        amount: args.amount,
        status: 'approved',
        balanceAfter: null,
        resolvedBy: 0,
      })
      .catch((err) => logger.warn({ err }, 'auto-verify: adminLog failed'));

    logger.info(
      {
        deposit_id: deposit.id,
        user: deposit.user_id,
        amount: args.amount,
        provider: method.provider,
        orderPublicId,
        refundedToWallet,
      },
      'Direct-pay deposit auto-approved',
    );

    return {
      ok: true,
      amount: args.amount,
      newBalance: 0,
      sender: args.sender,
      provider: method.provider,
      orderPublicId,
    };
  }

  // ----- Wallet top-up branch (legacy) -----
  const newBalance = await credit(
    deposit.user_id,
    args.amount,
    deposit.reference ?? `deposit:${deposit.id}`,
    'deposit_credit',
  );
  logger.info(
    {
      deposit_id: deposit.id,
      user: deposit.user_id,
      amount: args.amount,
      newBalance,
      provider: method.provider,
    },
    'Deposit auto-approved',
  );

  void adminLog
    .logTopupResolved(api, {
      user: args.logUser ?? {
        telegram_id: deposit.user_id,
        username: null,
        first_name: null,
        email: null,
      },
      depositDbId: deposit.id,
      method: deposit.method,
      amount: args.amount,
      status: 'approved',
      balanceAfter: Number(newBalance.toFixed(3)),
      resolvedBy: 0,
    })
    .catch((err) => logger.warn({ err }, 'auto-verify: adminLog failed'));

  return {
    ok: true,
    amount: args.amount,
    newBalance,
    sender: args.sender,
    provider: method.provider,
  };
}




