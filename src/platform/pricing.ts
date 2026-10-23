// Prices are explicit operator settings. Never infer dollars from a Stars price.
export function walletPrice(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!/^\d{1,7}(?:\.\d{1,6})?$/.test(text)) throw Error('Invalid WWC_SUBSCRIPTION_USD');
  const [whole, fraction = ''] = text.split('.');
  const micros = BigInt(whole!) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (micros <= 0n || micros > 1000000000000n) throw Error('Invalid WWC_SUBSCRIPTION_USD');
  return `${BigInt(whole!)}.${fraction.padEnd(2, '0')}`;
}
