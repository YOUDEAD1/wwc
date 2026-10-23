import { createHash, randomUUID } from 'node:crypto';
import { freeShop, allowedProduct } from '../platform/policy.js';
import { getStoreIdentity } from '../db/db_context.js';
import { supabase } from '../db/supabase.js';
import type { DBDeposit, DBOrder } from '../types.js';
import { del } from './cache.js';
export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (error.message?.includes('INSUFFICIENT_FUNDS'))
      throw Object.assign(new Error(error.message), { code: 'INSUFFICIENT_FUNDS' });
    throw error;
  }
  return data as T;
}
export async function assertSchemaReady() {
  await rpc('runtime_revisions');
}
export async function walletChange(
  user: number,
  delta: number,
  type: string,
  key: string = randomUUID(),
) {
  const balance = Number(
    await rpc('apply_wallet_change', { p_user_id: user, p_delta: delta, p_type: type, p_key: key }),
  );
  del('user:' + user);
  return balance;
}
export async function checkout(
  o: {
    user_id: number;
    product_id: number;
    qty: number;
    unit_price: number;
    total: number;
    discount?: number;
    promo_id?: number | null;
  },
  key: string,
  kind: 'wallet' | 'referral' | 'direct' | 'api' = 'wallet',
  allowPreorder = true,
  apiKeyId: number | null = null,
): Promise<{ order: DBOrder; balance: number; replayed: boolean }> {
  if (freeShop()) {
    const { data, error } = await supabase
      .from('products')
      .select('wwc_source_id,note')
      .eq('id', o.product_id)
      .maybeSingle();
    if (error) throw error;
    if (!allowedProduct(data))
      throw Object.assign(new Error('SUBSCRIPTION_REQUIRED'), { code: 'SUBSCRIPTION_REQUIRED' });
  }
  const result = await rpc<any>('create_checkout_order', {
    p_user_id: o.user_id,
    p_product_id: o.product_id,
    p_qty: o.qty,
    p_unit_price: o.unit_price,
    p_total: o.total,
    p_discount: o.discount ?? 0,
    p_promo_id: o.promo_id ?? null,
    p_key: key,
    p_kind: kind,
    p_allow_preorder: allowPreorder,
    p_api_key_id: apiKeyId,
  });
  del('runtime-revisions');
  del('user:' + o.user_id);
  return { ...result, balance: Number(result.balance) };
}
export async function approveDeposit(
  deposit: DBDeposit,
  amount: number,
  txHash: string | null = null,
): Promise<{ balance: number; order: DBOrder | null; refunded: boolean; replayed: boolean }> {
  const result = await rpc<any>('approve_deposit_atomic', {
    p_id: deposit.id,
    p_amount: amount,
    p_tx_hash: txHash,
  });
  del('runtime-revisions');
  del('user:' + deposit.user_id);
  return { ...result, balance: Number(result.balance) };
}
export async function reserveQuote(
  user: number,
  provider: string,
  address: string,
  base: number,
  asset = 'USDT',
  rate = 1,
) {
  return rpc<{ id: number; exact_amount: number; expires_at: string }>('reserve_payment_quote', {
    p_user_id: user,
    p_provider: provider,
    p_address: address,
    p_base: base,
    p_asset: asset,
    p_rate: rate,
  });
}
export async function beginDelivery(order: DBOrder) {
  if (!order.checkout_key) return true;
  return rpc<boolean>('begin_order_delivery', { p_order_id: order.id });
}
export async function finishDelivery(
  order: DBOrder,
  state: 'delivered' | 'preorder' | 'manual_review',
) {
  if (!order.checkout_key) return;
  const { error } = await supabase
    .from('orders')
    .update({ fulfillment_state: state, delivery_lease_until: null })
    .eq('id', order.id);
  if (error) throw error;
  if (state === 'delivered' && process.env.WWC_MANAGED === '1')
    process.send?.({ type: 'platform_purchase', orderId: order.id });
}
export function stableRequestId(orderId: number) {
  return createHash('sha256')
    .update(getStoreIdentity() + '\0' + orderId)
    .digest('hex')
    .slice(0, 32);
}
export async function supplierAttempt<T>(
  orderId: number,
  work: () => Promise<T>,
  recover?: () => Promise<T | null>,
): Promise<T | null> {
  const { data: existing, error: readError } = await supabase
    .from('supplier_order_attempts')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) {
    if (existing.state === 'success') return existing.result as T;
    if (recover) {
      const result = await recover();
      if (result) {
        const { error } = await supabase
          .from('supplier_order_attempts')
          .update({ state: 'success', result })
          .eq('order_id', orderId);
        if (error) throw error;
        return result;
      }
    }
    return null;
  }
  const { error } = await supabase.from('supplier_order_attempts').insert({ order_id: orderId });
  if (error) {
    if (error.code === '23505') return null;
    throw error;
  }
  try {
    const result = await work();
    const { error: e } = await supabase
      .from('supplier_order_attempts')
      .update({ state: result ? 'success' : 'manual_review', result })
      .eq('order_id', orderId);
    if (e) throw e;
    return result;
  } catch (err) {
    await supabase
      .from('supplier_order_attempts')
      .update({ state: 'manual_review' })
      .eq('order_id', orderId);
    throw err;
  }
}

export async function manualApprovalAmount(deposit: DBDeposit) {
  if (!deposit.quote_id) return Number(deposit.amount);
  const { data, error } = await supabase
    .from('payment_quotes')
    .select('asset,exact_amount')
    .eq('id', deposit.quote_id)
    .single();
  if (error) throw error;
  return data.asset === 'USDT' ? Number(data.exact_amount) : Number(deposit.amount);
}
