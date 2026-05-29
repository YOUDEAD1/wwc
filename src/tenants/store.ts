/**
 * Tenant Store — يستخدم جدول settings الموجود بدل tenants
 * لتجنب مشكلة PostgREST schema cache
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';
import { logger } from '../logger.js';

export type TenantStatus = 'active' | 'suspended' | 'expired';

export type Tenant = {
  id: string;
  bot_token: string;
  owner_telegram_id: number;
  owner_username: string | null;
  bot_username: string | null;
  supabase_url: string;
  supabase_service_key: string;
  status: TenantStatus;
  subscription_start: string;
  subscription_end: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

let _masterDb: SupabaseClient | null = null;
function getMasterDb(): SupabaseClient {
  if (!_masterDb) {
    _masterDb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _masterDb;
}

// =========================================================
// نظام تخزين بسيط باستخدام جدول settings
// key: tenant:list → مصفوفة IDs
// key: tenant:{id} → بيانات المستأجر
// =========================================================

async function settingsGet(key: string): Promise<unknown> {
  const { data } = await getMasterDb()
    .from('settings')
    .select('value')
    .eq('key', key)
    .single();
  return data?.value ?? null;
}

async function settingsSet(key: string, value: unknown): Promise<void> {
  await getMasterDb()
    .from('settings')
    .upsert({ key, value }, { onConflict: 'key' });
}

async function settingsDel(key: string): Promise<void> {
  await getMasterDb()
    .from('settings')
    .delete()
    .eq('key', key);
}

function generateId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function getIdList(): Promise<string[]> {
  const val = await settingsGet('tenant:list');
  if (!Array.isArray(val)) return [];
  return val as string[];
}

async function setIdList(ids: string[]): Promise<void> {
  await settingsSet('tenant:list', ids);
}

// =========================================================
export async function ensureTenantsTable(): Promise<void> {
  try {
    await getIdList();
    logger.info('tenant storage ready (using settings table)');
  } catch (err) {
    logger.warn({ err }, 'tenant storage check failed');
  }
}

export async function listTenants(): Promise<Tenant[]> {
  const ids = await getIdList();
  const tenants: Tenant[] = [];
  for (const id of ids) {
    const t = await settingsGet(`tenant:${id}`);
    if (t) tenants.push(t as Tenant);
  }
  return tenants.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function listActiveTenants(): Promise<Tenant[]> {
  const all = await listTenants();
  const now = new Date();
  return all.filter(
    (t) => t.status === 'active' && new Date(t.subscription_end) > now,
  );
}

export async function getTenant(id: string): Promise<Tenant | null> {
  const val = await settingsGet(`tenant:${id}`);
  return val ? (val as Tenant) : null;
}

export async function getTenantByToken(token: string): Promise<Tenant | null> {
  const all = await listTenants();
  return all.find((t) => t.bot_token === token) ?? null;
}

export async function addTenant(input: {
  bot_token: string;
  owner_telegram_id: number;
  owner_username: string | null;
  bot_username: string | null;
  supabase_url: string;
  supabase_service_key: string;
  subscription_days: number;
  notes?: string;
}): Promise<Tenant> {
  const now = new Date();
  const end = new Date(now.getTime() + input.subscription_days * 24 * 60 * 60 * 1000);
  const id = generateId();

  const tenant: Tenant = {
    id,
    bot_token: input.bot_token,
    owner_telegram_id: input.owner_telegram_id,
    owner_username: input.owner_username,
    bot_username: input.bot_username,
    supabase_url: input.supabase_url,
    supabase_service_key: input.supabase_service_key,
    status: 'active',
    subscription_start: now.toISOString(),
    subscription_end: end.toISOString(),
    notes: input.notes ?? null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  await settingsSet(`tenant:${id}`, tenant);
  const ids = await getIdList();
  await setIdList([...ids, id]);
  return tenant;
}

export async function extendTenant(id: string, days: number): Promise<Tenant> {
  const tenant = await getTenant(id);
  if (!tenant) throw new Error('Tenant not found');
  const current = new Date(tenant.subscription_end);
  const base = current > new Date() ? current : new Date();
  const newEnd = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  const updated: Tenant = {
    ...tenant,
    subscription_end: newEnd.toISOString(),
    status: 'active',
    updated_at: new Date().toISOString(),
  };
  await settingsSet(`tenant:${id}`, updated);
  return updated;
}

export async function setTenantStatus(id: string, status: TenantStatus): Promise<void> {
  const tenant = await getTenant(id);
  if (!tenant) return;
  await settingsSet(`tenant:${id}`, {
    ...tenant,
    status,
    updated_at: new Date().toISOString(),
  });
}

export async function deleteTenant(id: string): Promise<void> {
  await settingsDel(`tenant:${id}`);
  const ids = await getIdList();
  await setIdList(ids.filter((i) => i !== id));
}

export async function getTenantStats(tenant: Tenant): Promise<{
  users: number;
  orders: number;
  revenue: number;
}> {
  try {
    const db = createClient(tenant.supabase_url, tenant.supabase_service_key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const [usersRes, ordersRes] = await Promise.all([
      db.from('users').select('telegram_id', { count: 'exact', head: true }),
      db.from('orders').select('total').eq('status', 'paid'),
    ]);
    return {
      users: usersRes.count ?? 0,
      orders: ordersRes.data?.length ?? 0,
      revenue: (ordersRes.data ?? []).reduce((s, o) => s + Number(o.total ?? 0), 0),
    };
  } catch {
    return { users: 0, orders: 0, revenue: 0 };
  }
}

export const TENANTS_MIGRATION_SQL = '-- No migration needed. Tenant data stored in settings table.';