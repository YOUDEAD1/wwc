/**
 * Database Context
 * يخزن الـ Supabase client المناسب لكل بوت
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';

// Cache للـ tenant clients
const clientCache = new Map<string, SupabaseClient>();

let _defaultClient: SupabaseClient | null = null;

export function getDefaultClient(): SupabaseClient {
  if (!_defaultClient) {
    _defaultClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _defaultClient;
}

export function getTenantClient(url: string, key: string): SupabaseClient {
  const cacheKey = `${url}::${key.slice(0, 20)}`;
  if (clientCache.has(cacheKey)) return clientCache.get(cacheKey)!;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  clientCache.set(cacheKey, client);
  return client;
}

// للتوافق مع الكود القديم — يرجع دائماً الـ default client
// الـ tenant client يُمرر عبر ctx.db
export function getDb(): SupabaseClient {
  return getDefaultClient();
}

// stub للتوافق
export function runWithTenantContext<T>(
  _url: string,
  _key: string,
  _adminId: number,
  fn: () => Promise<T>,
): Promise<T> {
  return fn();
}