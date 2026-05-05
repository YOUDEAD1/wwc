/**
 * Unified deposit auto-verification.
 *
 * The user-facing top-up flow and the background reconciliation poller
 * both call into `verifyAndCreditDeposit()`. It:
 *
 *   1. Looks at the deposit's payment method to pick a verifier
 *      (TRC20 / BEP20 / Binance Pay).
 *   2. Calls the verifier with the user-submitted reference (tx hash
 *      or merchant trade number).
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
import { verifyTrc20Tx, verifyBep20Tx } from './chainVerify.js';
import { binanceEnabled, queryOrder } from './binance.js';

export type AutoVerifyResult =
  | {
      ok: true;
      amount: number;
      newBalance: number;
      sender?: string | null;
      provider: DBPaymentMethod['provider'];
    }
  | { ok: false; reason: string };

/**
 * Resolve the payment method row for a deposit. We match on
 * `payment_methods.name === deposits.method` because that's what the
 * existing top-up flow records — the deposit row doesn't carry the
 * payment_method id directly.
 */
async function resolveMethod(deposit: DBDeposit): Promise<DBPaymentMethod | null> {
  const methods = await listPaymentMethods();
  return methods.find((m) => m.name === deposit.method) ?? null;
}

/**
 * Run the appropriate verifier for `deposit`, and on success credit
 * the wallet + persist tx hash + flip status to approved.
 *
 * `submission` carries whatever the user pasted:
 *   - `txHash`         for chain providers
 *   - `merchantTradeNo` for Binance Pay (= the user-submitted Order ID)
 */
export async function verifyAndCreditDeposit(args: {
  api: Api;
  deposit: DBDeposit;
  submission: { txHash?: string; merchantTradeNo?: string };
  /** Telegram username/first_name etc. for the admin log. */
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

  // ----- Chain providers -----
  if (provider === 'usdt_trc20' || provider === 'usdt_bep20') {
    const txHash = submission.txHash?.trim();
    if (!txHash) return { ok: false, reason: 'tx hash required' };
    if (!method.address) return { ok: false, reason: 'wallet address not set' };

    // Dedupe: same hash can't credit two deposits.
    const existing = await findDepositByTxHash(txHash);
    if (existing && existing.id !== deposit.id) {
      return {
        ok: false,
        reason: `tx already used by deposit #${existing.id}`,
      };
    }

    const result =
      provider === 'usdt_trc20'
        ? await verifyTrc20Tx({
            txHash,
            expectedAddress: method.address,
            minAmount: Number(method.min_amount) || 0,
          })
        : await verifyBep20Tx({
            txHash,
            expectedAddress: method.address,
            minAmount: Number(method.min_amount) || 0,
          });
    if (!result.ok) return { ok: false, reason: result.reason };

    return finalizeApproval({
      api: args.api,
      deposit,
      provider,
      amount: result.amount,
      txHash,
      sender: result.sender,
      logUser: args.logUser,
    });
  }

  // ----- Binance Pay queryOrder -----
  if (provider === 'binance_pay') {
    if (!binanceEnabled()) {
      return { ok: false, reason: 'Binance Pay API keys not configured' };
    }
    const tradeNo = submission.merchantTradeNo?.trim();
    if (!tradeNo) return { ok: false, reason: 'order id required' };
    let data;
    try {
      data = await queryOrder({ merchantTradeNo: tradeNo });
    } catch (err) {
      logger.warn({ err, tradeNo }, 'Binance queryOrder threw');
      return { ok: false, reason: `Binance API error: ${stringifyErr(err)}` };
    }
    if (!data) {
      return {
        ok: false,
        reason:
          'Binance has no record of that Order ID for our merchant account — admin will verify manually.',
      };
    }
    if (data.status !== 'PAID') {
      return {
        ok: false,
        reason: `Binance status: ${data.status ?? 'unknown'}`,
      };
    }
    const amount = Number(data.orderAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, reason: 'Binance returned no orderAmount' };
    }
    if (amount + 1e-9 < Number(method.min_amount || 0)) {
      return {
        ok: false,
        reason: `amount ${amount.toFixed(2)} < min ${method.min_amount}`,
      };
    }
    return finalizeApproval({
      api: args.api,
      deposit,
      provider,
      amount: round2(amount),
      txHash: tradeNo,
      sender: null,
      logUser: args.logUser,
    });
  }

  return { ok: false, reason: `unsupported provider: ${provider as string}` };
}

async function finalizeApproval(args: {
  api: Api;
  deposit: DBDeposit;
  provider: DBPaymentMethod['provider'];
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
  const { api, deposit } = args;
  // Persist the verified amount BEFORE flipping status so the admin
  // log + wallet ledger see the right number.
  if (Number(deposit.amount) !== args.amount) {
    await setDepositAmount(deposit.id, args.amount);
  }
  await setDepositTxHash(deposit.id, args.txHash);
  await setDepositStatus(deposit.id, 'approved');
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
      provider: args.provider,
    },
    'Deposit auto-approved',
  );

  // Best-effort admin log + user DM. Failures here must NOT roll back
  // the credit (the funds are real).
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
    provider: args.provider,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return JSON.stringify(err);
}
