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
}): Promise<DBPaymentMethod> {
  const { data, error } = await supabase
    .from('payment_methods')
    .insert({ name: p.name, instructions: p.instructions, min_amount: p.min_amount ?? 1 })
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('addPaymentMethod failed');
  return data as DBPaymentMethod;
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
