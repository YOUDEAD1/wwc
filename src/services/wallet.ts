import { adjustBalance, recordLedger } from '../db/queries.js';

/** Charge the user's wallet, throwing if insufficient. Returns new balance. */
export async function charge(
  user_id: number,
  amount: number,
  current_balance: number,
  reference: string | null = null,
): Promise<number> {
  if (current_balance < amount) {
    throw Object.assign(new Error('insufficient'), { code: 'INSUFFICIENT_FUNDS' });
  }
  const next = await adjustBalance(user_id, -amount);
  await recordLedger(user_id, 'wallet_purchase', -amount, reference);
  return next;
}

/** Credit the user's wallet (e.g. on deposit approval). */
export async function credit(
  user_id: number,
  amount: number,
  reference: string | null = null,
  type: string = 'deposit_credit',
): Promise<number> {
  const next = await adjustBalance(user_id, amount);
  await recordLedger(user_id, type, amount, reference);
  return next;
}
