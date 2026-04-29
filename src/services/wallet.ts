import { adjustBalance } from '../db/queries.js';

/** Charge the user's wallet, throwing if insufficient. Returns new balance. */
export async function charge(
  user_id: number,
  amount: number,
  current_balance: number,
): Promise<number> {
  if (current_balance < amount) {
    throw Object.assign(new Error('insufficient'), { code: 'INSUFFICIENT_FUNDS' });
  }
  return adjustBalance(user_id, -amount);
}

/** Credit the user's wallet (e.g. on deposit approval). */
export async function credit(user_id: number, amount: number): Promise<number> {
  return adjustBalance(user_id, amount);
}
