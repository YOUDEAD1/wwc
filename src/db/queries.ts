/**
 * Thin wrappers around Supabase queries. Keep all SQL access here so
 * callers don't have to know about the underlying client.
 */
import { supabase } from './supabase.js';
import type {
  DBUser,
  DBCategory,
  DBProduct,
  DBOrder,
  DBDeposit,
  DBPaymentMethod,
} from '../types.js';
import type { Lang } from '../../config/index.js';
import { logger } from '../logger.js';

// ---------- Users ----------

function makeRefCode(id: number): string {
  return `R${id.toString(36).toUpperCase()}`;
}

export async function getOrCreateUser(args: {
  telegram_id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  language: Lang;
  referred_by?: number | null;
}): Promise<DBUser> {
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', args.telegram_id)
    .maybeSingle();

  if (existing) {
    // Touch last_seen_at and refresh username/first_name in case it changed.
    await supabase
      .from('users')
      .update({
        username: args.username ?? existing.username,
        first_name: args.first_name ?? existing.first_name,
        last_name: args.last_name ?? existing.last_name,
        last_seen_at: new Date().toISOString(),
      })
      .eq('telegram_id', args.telegram_id);
    return existing as DBUser;
  }

  const ref_code = makeRefCode(args.telegram_id);
  const insert = {
    telegram_id: args.telegram_id,
    username: args.username ?? null,
    first_name: args.first_name ?? null,
    last_name: args.last_name ?? null,
    language: args.language,
    ref_code,
    referred_by: args.referred_by ?? null,
  };
  const { data, error } = await supabase.from('users').insert(insert).select('*').single();
  if (error || !data) {
    logger.error({ err: error }, 'getOrCreateUser failed');
    throw error ?? new Error('Failed to create user');
  }
  if (args.referred_by && args.referred_by !== args.telegram_id) {
    await supabase
      .from('referrals')
      .insert({ referrer_id: args.referred_by, referee_id: args.telegram_id })
      .then(() => {});
  }
  return data as DBUser;
}

export async function setUserLanguage(telegram_id: number, language: Lang): Promise<void> {
  await supabase.from('users').update({ language }).eq('telegram_id', telegram_id);
}

/**
 * Set the user's region + IANA timezone in one call. Either field
 * may be cleared by passing `null`.
 */
export async function setUserRegion(
  telegram_id: number,
  region: string | null,
  timezone: string | null,
): Promise<void> {
  await supabase
    .from('users')
    .update({ region, timezone })
    .eq('telegram_id', telegram_id);
}

/** Set the user's contact email (`null` clears it). */
export async function setUserEmail(telegram_id: number, email: string | null): Promise<void> {
  await supabase.from('users').update({ email }).eq('telegram_id', telegram_id);
}

/** Set the user's status string (`null` clears it). */
export async function setUserStatus(telegram_id: number, status: string | null): Promise<void> {
  await supabase.from('users').update({ status }).eq('telegram_id', telegram_id);
}

export async function setUserBalance(telegram_id: number, balance: number): Promise<void> {
  await supabase.from('users').update({ balance }).eq('telegram_id', telegram_id);
}

export async function adjustBalance(telegram_id: number, delta: number): Promise<number> {
  const { data: u } = await supabase
    .from('users')
    .select('balance')
    .eq('telegram_id', telegram_id)
    .single();
  const next = Number(u?.balance ?? 0) + delta;
  await supabase.from('users').update({ balance: next }).eq('telegram_id', telegram_id);
  return next;
}

export async function toggleNotification(
  telegram_id: number,
  field: 'stock_alert' | 'announcements',
): Promise<boolean> {
  const { data: u } = await supabase
    .from('users')
    .select(field)
    .eq('telegram_id', telegram_id)
    .single();
  // u may be null on race; default to false
  const cur = Boolean((u as Record<string, unknown> | null)?.[field]);
  const next = !cur;
  await supabase
    .from('users')
    .update({ [field]: next })
    .eq('telegram_id', telegram_id);
  return next;
}

export async function countReferrals(telegram_id: number): Promise<number> {
  const { count } = await supabase
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_id', telegram_id);
  return count ?? 0;
}

// ---------- Admins ----------

export async function isAdmin(telegram_id: number): Promise<boolean> {
  const { data } = await supabase
    .from('admins')
    .select('telegram_id')
    .eq('telegram_id', telegram_id)
    .maybeSingle();
  return Boolean(data);
}

// ---------- Categories ----------

export async function listCategories(): Promise<DBCategory[]> {
  const { data } = await supabase
    .from('categories')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  return (data ?? []) as DBCategory[];
}

export async function getCategory(id: number): Promise<DBCategory | null> {
  const { data } = await supabase.from('categories').select('*').eq('id', id).maybeSingle();
  return (data as DBCategory) ?? null;
}

export async function addCategory(name: string, emoji?: string): Promise<DBCategory> {
  const { data, error } = await supabase
    .from('categories')
    .insert({ name, emoji: emoji ?? null })
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('addCategory failed');
  return data as DBCategory;
}

// ---------- Products ----------

export async function listProducts(
  categoryId: number,
  page: number,
  perPage: number,
): Promise<{ rows: DBProduct[]; total: number }> {
  const from = page * perPage;
  const to = from + perPage - 1;
  const { data, count } = await supabase
    .from('products')
    .select('*', { count: 'exact' })
    .eq('category_id', categoryId)
    .eq('active', true)
    .order('id', { ascending: true })
    .range(from, to);
  return { rows: (data ?? []) as DBProduct[], total: count ?? 0 };
}

export async function getProduct(id: number): Promise<DBProduct | null> {
  const { data } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
  return (data as DBProduct) ?? null;
}

export async function addProduct(p: {
  category_id: number;
  name: string;
  price: number;
  stock: number;
  warranty?: string;
  description?: string;
  note?: string;
}): Promise<DBProduct> {
  const { data, error } = await supabase.from('products').insert(p).select('*').single();
  if (error || !data) throw error ?? new Error('addProduct failed');
  return data as DBProduct;
}

export async function decrementProductStock(id: number, qty: number): Promise<void> {
  const { data: p } = await supabase.from('products').select('stock').eq('id', id).single();
  const cur = Number(p?.stock ?? 0);
  await supabase.from('products').update({ stock: Math.max(0, cur - qty) }).eq('id', id);
}

// ---------- Orders ----------

export async function createOrder(o: {
  user_id: number;
  product_id: number;
  product_name: string;
  qty: number;
  unit_price: number;
  total: number;
  delivery?: string;
}): Promise<DBOrder> {
  const { data, error } = await supabase
    .from('orders')
    .insert({ ...o, delivery: o.delivery ?? null })
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('createOrder failed');
  return data as DBOrder;
}

export async function listOrders(user_id: number, limit = 10): Promise<DBOrder[]> {
  const { data } = await supabase
    .from('orders')
    .select('*')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as DBOrder[];
}

// ---------- Deposits ----------

export async function listPaymentMethods(): Promise<DBPaymentMethod[]> {
  const { data } = await supabase
    .from('payment_methods')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  return (data ?? []) as DBPaymentMethod[];
}

export async function addPaymentMethod(p: {
  name: string;
  instructions: string;
  min_amount?: number;
  provider?: 'manual' | 'binance_pay';
}): Promise<DBPaymentMethod> {
  const { data, error } = await supabase
    .from('payment_methods')
    .insert({
      name: p.name,
      instructions: p.instructions,
      min_amount: p.min_amount ?? 1,
      provider: p.provider ?? 'manual',
    })
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('addPaymentMethod failed');
  return data as DBPaymentMethod;
}

/** Look up a deposit by its merchantTradeNo (stored in `reference`). */
export async function findDepositByReference(reference: string): Promise<DBDeposit | null> {
  const { data } = await supabase
    .from('deposits')
    .select('*')
    .eq('reference', reference)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as DBDeposit) ?? null;
}

export async function createDeposit(d: {
  user_id: number;
  method: string;
  amount: number;
  reference?: string;
  note?: string;
}): Promise<DBDeposit> {
  const { data, error } = await supabase
    .from('deposits')
    .insert({ ...d, reference: d.reference ?? null, note: d.note ?? null })
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('createDeposit failed');
  return data as DBDeposit;
}

export async function listDeposits(user_id: number, limit = 10): Promise<DBDeposit[]> {
  const { data } = await supabase
    .from('deposits')
    .select('*')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as DBDeposit[];
}

// ---------- Settings (admin-editable runtime config) ----------

export async function getAllSettings(): Promise<Map<string, unknown>> {
  const { data } = await supabase.from('settings').select('key,value');
  const map = new Map<string, unknown>();
  for (const row of data ?? []) {
    map.set((row as { key: string }).key, (row as { value: unknown }).value);
  }
  return map;
}

export async function setSetting(
  key: string,
  value: unknown,
  updated_by?: number,
): Promise<void> {
  await supabase.from('settings').upsert({
    key,
    value,
    updated_by: updated_by ?? null,
    updated_at: new Date().toISOString(),
  });
}

// ---------- Announcements ----------

export async function listUsersForAnnouncement(): Promise<{ telegram_id: number }[]> {
  const { data } = await supabase
    .from('users')
    .select('telegram_id')
    .eq('announcements', true);
  return (data ?? []) as { telegram_id: number }[];
}

// ---------- Admin: stats / management ----------

export type Stats = {
  users: number;
  orders: number;
  revenue: number;
  pending_deposits: number;
  active_products: number;
  active_categories: number;
};

export async function getStats(): Promise<Stats> {
  const [usersR, ordersR, depR, prodR, catR, totalsR] = await Promise.all([
    supabase.from('users').select('telegram_id', { count: 'exact', head: true }),
    supabase.from('orders').select('id', { count: 'exact', head: true }),
    supabase
      .from('deposits')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('active', true),
    supabase
      .from('categories')
      .select('id', { count: 'exact', head: true })
      .eq('active', true),
    supabase.from('orders').select('total'),
  ]);
  const revenue =
    (totalsR.data as { total: number }[] | null)?.reduce(
      (acc, r) => acc + Number(r.total ?? 0),
      0,
    ) ?? 0;
  return {
    users: usersR.count ?? 0,
    orders: ordersR.count ?? 0,
    revenue: Number(revenue.toFixed(2)),
    pending_deposits: depR.count ?? 0,
    active_products: prodR.count ?? 0,
    active_categories: catR.count ?? 0,
  };
}

export async function listAllProducts(
  page: number,
  perPage: number,
): Promise<{ rows: DBProduct[]; total: number }> {
  const from = page * perPage;
  const to = from + perPage - 1;
  const { data, count } = await supabase
    .from('products')
    .select('*', { count: 'exact' })
    .order('id', { ascending: false })
    .range(from, to);
  return { rows: (data ?? []) as DBProduct[], total: count ?? 0 };
}

export async function deleteProduct(id: number): Promise<void> {
  await supabase.from('products').delete().eq('id', id);
}

export async function setProductActive(id: number, active: boolean): Promise<void> {
  await supabase.from('products').update({ active }).eq('id', id);
}

export async function listAllCategories(): Promise<DBCategory[]> {
  const { data } = await supabase
    .from('categories')
    .select('*')
    .order('id', { ascending: true });
  return (data ?? []) as DBCategory[];
}

export async function deleteCategory(id: number): Promise<void> {
  await supabase.from('categories').delete().eq('id', id);
}

export async function deletePaymentMethod(id: number): Promise<void> {
  await supabase.from('payment_methods').delete().eq('id', id);
}

export async function listPendingDeposits(): Promise<DBDeposit[]> {
  const { data } = await supabase
    .from('deposits')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(20);
  return (data ?? []) as DBDeposit[];
}

export async function getDeposit(id: number): Promise<DBDeposit | null> {
  const { data } = await supabase.from('deposits').select('*').eq('id', id).maybeSingle();
  return (data as DBDeposit) ?? null;
}

export async function setDepositStatus(
  id: number,
  status: 'approved' | 'rejected',
): Promise<void> {
  await supabase.from('deposits').update({ status }).eq('id', id);
}

export async function setDepositAmount(id: number, amount: number): Promise<void> {
  await supabase.from('deposits').update({ amount }).eq('id', id);
}

// ---------- User management (admin) ----------

/** List most-recently-active users for the admin Users panel. */
export async function listRecentUsers(
  page: number,
  perPage: number,
): Promise<{ rows: DBUser[]; total: number }> {
  const from = page * perPage;
  const to = from + perPage - 1;
  const { data, count } = await supabase
    .from('users')
    .select('*', { count: 'exact' })
    .order('last_seen_at', { ascending: false })
    .range(from, to);
  return { rows: (data ?? []) as DBUser[], total: count ?? 0 };
}

/** Find a user by Telegram numeric id. */
export async function findUserById(telegram_id: number): Promise<DBUser | null> {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegram_id)
    .maybeSingle();
  return (data as DBUser) ?? null;
}

/** Find a user by case-insensitive @username (without the @). */
export async function findUserByUsername(username: string): Promise<DBUser | null> {
  const clean = username.replace(/^@/, '').trim();
  const { data } = await supabase
    .from('users')
    .select('*')
    .ilike('username', clean)
    .limit(1)
    .maybeSingle();
  return (data as DBUser) ?? null;
}

/** Add a Telegram user as bot admin. */
export async function promoteAdmin(telegram_id: number, username?: string | null): Promise<void> {
  await supabase
    .from('admins')
    .upsert({ telegram_id, username: username ?? null }, { onConflict: 'telegram_id' });
}

/** Remove a Telegram user from bot admins. */
export async function demoteAdmin(telegram_id: number): Promise<void> {
  await supabase.from('admins').delete().eq('telegram_id', telegram_id);
}

/**
 * Aggregate stats for one user — used by the Settings → Stats screen.
 * Returns counts/sums across all of their paid orders and approved
 * deposits, plus the timestamp of the most recent order.
 */
export async function getUserStats(telegram_id: number): Promise<{
  orders: number;
  items: number;
  spent: number;
  lastOrderAt: string | null;
  deposits: number;
}> {
  const [{ data: orderRows }, { data: depositRows }] = await Promise.all([
    supabase
      .from('orders')
      .select('qty,total,created_at')
      .eq('user_id', telegram_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('deposits')
      .select('amount,status')
      .eq('user_id', telegram_id)
      .eq('status', 'approved'),
  ]);

  const orders = orderRows ?? [];
  const deposits = depositRows ?? [];

  const totalOrders = orders.length;
  const items = orders.reduce(
    (s, r) => s + Number((r as { qty: number }).qty),
    0,
  );
  const spent = orders.reduce(
    (s, r) => s + Number((r as { total: number }).total),
    0,
  );
  const lastOrderAt =
    orders.length > 0
      ? ((orders[0] as { created_at: string }).created_at ?? null)
      : null;
  const totalDeposits = deposits.reduce(
    (s, r) => s + Number((r as { amount: number }).amount),
    0,
  );

  return {
    orders: totalOrders,
    items,
    spent,
    lastOrderAt,
    deposits: totalDeposits,
  };
}

/** Count orders + total spent by a single user (for the admin user view). */
export async function getUserOrderSummary(
  telegram_id: number,
): Promise<{ orders: number; spent: number }> {
  const { data } = await supabase
    .from('orders')
    .select('total')
    .eq('user_id', telegram_id);
  const orders = (data ?? []).length;
  const spent = (data ?? []).reduce((s, r) => s + Number((r as { total: number }).total), 0);
  return { orders, spent };
}
