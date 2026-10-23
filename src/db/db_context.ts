/**
 * Database Context — AsyncLocalStorage
 * يجعل كل بوت (tenant) يستخدم Supabase connection خاصه
 * بدون تعديل أي كود آخر
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { env } from '../env.js';
import { measuredFetch } from '../services/networkMeter.js';

type DbContext = {
  supabase: SupabaseClient;
  adminUserId: number;
  scope: string;
  botUsername?: string;
  databaseUrl: string;
};

// الـ storage الذي يحفظ الـ context لكل async chain
const storage = new AsyncLocalStorage<DbContext>();

// الـ connection الافتراضي (البوت الرئيسي)
let defaultContext: DbContext | null = null;

function getDefaultContext(): DbContext {
  if (!defaultContext) {
    defaultContext = {
      supabase: createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: measuredFetch },
      }),
      adminUserId: env.ADMIN_USER_ID,
      scope: scopeKey(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY),
      databaseUrl: env.SUPABASE_URL,
    };
  }
  return defaultContext;
}

/** يجيب الـ Supabase client الخاص بالـ context الحالي */
export function getDb(): SupabaseClient {
  return storage.getStore()?.supabase ?? getDefaultContext().supabase;
}

/** يجيب الـ adminUserId الخاص بالـ context الحالي */
export function getContextAdminId(): number {
  return storage.getStore()?.adminUserId ?? getDefaultContext().adminUserId;
}

/** ينفّذ دالة داخل context خاص بمستأجر */
export function runWithTenantContext<T>(
  supabaseUrl: string,
  supabaseKey: string,
  adminUserId: number,
  fn: () => Promise<T>,
  botUsername?: string,
): Promise<T> {
  // cache الـ clients لتجنب إنشاء جديد في كل request
  const client = getTenantClient(supabaseUrl, supabaseKey);
  return storage.run(
    {
      supabase: client,
      adminUserId,
      scope: scopeKey(supabaseUrl, supabaseKey),
      botUsername,
      databaseUrl: supabaseUrl,
    },
    fn,
  );
}

// Cache للـ tenant clients
const clientCache = new Map<string, SupabaseClient>();

function getTenantClient(url: string, key: string): SupabaseClient {
  const cacheKey = scopeKey(url, key);
  if (clientCache.has(cacheKey)) return clientCache.get(cacheKey)!;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: measuredFetch },
  });
  clientCache.set(cacheKey, client);
  return client;
}
function scopeKey(url: string, key: string): string {
  return createHash('sha256')
    .update(url + '\0' + key)
    .digest('hex');
}
export function getDbScope(): string {
  return (storage.getStore() ?? getDefaultContext()).scope;
}

export function isTenantContext() {
  return !!storage.getStore() || process.env.IS_TENANT === 'true';
}
export function getContextBotUsername() {
  return storage.getStore()?.botUsername ?? env.BOT_USERNAME;
}

export function getStoreIdentity() {
  return createHash('sha256')
    .update((storage.getStore() ?? getDefaultContext()).databaseUrl)
    .digest('hex');
}
