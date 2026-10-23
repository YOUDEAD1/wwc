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
  const { data, error } = await getMasterDb()
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

async function settingsSet(key: string, value: unknown): Promise<void> {
  const { error } = await getMasterDb()
    .from('settings')
    .upsert({ key, value }, { onConflict: 'key' });
  if (error) throw error;
}

async function settingsDel(key: string): Promise<void> {
  const { error } = await getMasterDb().from('settings').delete().eq('key', key);
  if (error) throw error;
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
  if (!ids.length) return [];
  const rows: Tenant[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await getMasterDb()
      .from('settings')
      .select('value')
      .in(
        'key',
        ids.slice(i, i + 100).map((id) => 'tenant:' + id),
      );
    if (error) throw error;
    rows.push(...(data ?? []).map((r) => r.value as Tenant));
  }
  return rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function listActiveTenants(): Promise<Tenant[]> {
  const all = await listTenants();
  const now = new Date();
  return all.filter((t) => t.status === 'active' && new Date(t.subscription_end) > now);
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

  await mutateTenant('add', id, tenant);
  return tenant;
}

export async function extendTenant(id: string, days: number): Promise<Tenant> {
  if (!Number.isInteger(days) || days < 1) throw Error('Invalid subscription days');
  const result = await mutateTenant('extend', id, { days });
  const { launchTenantBot } = await import('./manager.js');
  await launchTenantBot(result);
  return result;
}

export async function setTenantStatus(id: string, status: TenantStatus): Promise<void> {
  await mutateTenant('status', id, { status });
}

export async function deleteTenant(id: string): Promise<void> {
  await mutateTenant('delete', id, {});
}

export async function getTenantStats(tenant: Tenant): Promise<{
  users: number;
  orders: number;
  revenue: number;
}> {
  const db=createClient(tenant.supabase_url,tenant.supabase_service_key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.rpc('shop_statistics');if(error)throw error;
  return {users:Number(data.users),orders:Number(data.orders),revenue:Number(data.revenue)};
}

export const TENANTS_MIGRATION_SQL =
  '-- No migration needed. Tenant data stored in settings table.';
async function mutateTenant(action: string, id: string, payload: unknown): Promise<Tenant> {
  const { data, error } = await getMasterDb().rpc('tenant_registry_mutation', {
    p_action: action,
    p_id: id,
    p_payload: payload,
  });
  if (error) throw error;
  const { invalidateTenantGateways } = await import('../services/resellerApiHttp.js');
  invalidateTenantGateways();
  return data as Tenant;
}
