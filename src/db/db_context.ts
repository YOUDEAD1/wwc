/**
 * Database Context — AsyncLocalStorage
 * يجعل كل بوت (tenant) يستخدم Supabase connection خاصه
 * بدون تعديل أي كود آخر
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';

type DbContext = {
  supabase: SupabaseClient;
  adminUserId: number;
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
      }),
      adminUserId: env.ADMIN_USER_ID,
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
): Promise<T> {
  // cache الـ clients لتجنب إنشاء جديد في كل request
  const client = getTenantClient(supabaseUrl, supabaseKey);
  return storage.run({ supabase: client, adminUserId }, fn);
}

// Cache للـ tenant clients
const clientCache = new Map<string, SupabaseClient>();

function getTenantClient(url: string, key: string): SupabaseClient {
  const cacheKey = `${url}::${key.slice(0, 20)}`;
  if (clientCache.has(cacheKey)) return clientCache.get(cacheKey)!;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  clientCache.set(cacheKey, client);
  return client;
}