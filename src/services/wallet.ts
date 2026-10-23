/** Charge the user's wallet, throwing if insufficient. Returns new balance. */
export async function charge(
  user_id: number,
  amount: number,
  current_balance: number,
  reference: string | null = null,
): Promise<number> {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('INVALID_AMOUNT');
  const { walletChange } = await import('./checkout.js');
  return walletChange(user_id, -amount, 'wallet_purchase', reference ?? undefined);
}

/** Credit the user's wallet (e.g. on deposit approval). */
export async function credit(
  user_id: number,
  amount: number,
  reference: string | null = null,
  type: string = 'deposit_credit',
): Promise<number> {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');
  const { walletChange } = await import('./checkout.js');
  return walletChange(user_id, amount, type, reference ?? undefined);
}
