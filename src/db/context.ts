/**
 * Database Context
 * يخزن الـ Supabase client المناسب لكل بوت
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { env } from '../env.js';
import { getDb as contextualDb, runWithTenantContext as contextualRun } from './db_context.js';

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
  const cacheKey = createHash('sha256')
    .update(url + '\0' + key)
    .digest('hex');
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
  return contextualDb();
}

// stub للتوافق
export function runWithTenantContext<T>(
  _url: string,
  _key: string,
  _adminId: number,
  fn: () => Promise<T>,
): Promise<T> {
  return contextualRun(_url, _key, _adminId, fn);
}
