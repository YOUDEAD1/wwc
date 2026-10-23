import 'dotenv/config';
import { encryptionKey, safeSupabaseUrl } from './security.js';
import { walletPrice } from './pricing.js';
export function platformConfig() {
  const required = (key: string) => {
    const value = process.env[key]?.trim();
    if (!value) throw Error(`${key} is required`);
    return value;
  };
  const number = (key: string, fallback: number, min: number, max: number) => {
    const v = Number(process.env[key] ?? fallback);
    if (!Number.isInteger(v) || v < min || v > max) throw Error(`Invalid ${key}`);
    return v;
  };
  const sharedSecret = required('WWC_PLATFORM_SECRET');
  if (sharedSecret.length < 32) throw Error('Shared secret needs 32 characters');
  const publicUrl = new URL(required('PUBLIC_BASE_URL')),
    nssOrigin = new URL(required('NSS_API_ORIGIN'));
  for (const url of [publicUrl, nssOrigin])
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw Error('Platform and NSS URLs must be HTTPS origins');
  const owners = required('WWC_PLATFORM_OWNERS').split(',').map(Number);
  if (owners.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw Error('Invalid owner ID');
  const nssUsername = required('NSS_BOT_USERNAME').replace(/^@/, '');
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(nssUsername)) throw Error('Invalid NSS_BOT_USERNAME');
  const managerToken = process.env.WWC_MANAGER_TOKEN?.trim() || '';
  if (managerToken && !/^\d{6,15}:[A-Za-z0-9_-]{25,80}$/.test(managerToken))
    throw Error('Invalid WWC_MANAGER_TOKEN');
  const managerUsername = (process.env.WWC_MANAGER_USERNAME?.trim() || '').replace(/^@/, '');
  if (managerUsername && !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(managerUsername))
    throw Error('Invalid WWC_MANAGER_USERNAME');
  if (managerToken && !managerUsername)
    throw Error('WWC_MANAGER_USERNAME is required with WWC_MANAGER_TOKEN');
  if (managerUsername && managerUsername.toLowerCase() === nssUsername.toLowerCase())
    throw Error('Manager and NSS must be separate bots');
  return {
    managerToken,
    managerUsername,
    databaseUrl: safeSupabaseUrl(required('SUPABASE_URL')),
    databaseKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    sharedSecret,
    encryptionKey: encryptionKey(required('WWC_ENCRYPTION_KEY')),
    publicUrl: publicUrl.origin,
    nssOrigin: nssOrigin.origin,
    nssUsername,
    owners,
    maxWorkers: number('WWC_MAX_WARM_WORKERS', 1, 1, 20),
    maxShops: number('WWC_MAX_ACTIVE_SHOPS', 20, 1, 10000),
    maxOwnerShops: number('WWC_MAX_OWNER_SHOPS', 1, 1, 100),
    heapMb: number('WWC_WORKER_HEAP_MB', 128, 64, 2048),
    idleWorkerMs: number('WWC_WORKER_IDLE_SECONDS', 180, 30, 3600) * 1000,
    queueLimit: number('WWC_WORKER_QUEUE_LIMIT', 32, 1, 256),
    queueWaitMs: number('WWC_WORKER_QUEUE_WAIT_SECONDS', 15, 1, 30) * 1000,
    inactivityHours: number('WWC_INACTIVITY_HOURS', 72, 24, 720),
    stars: number('WWC_SUBSCRIPTION_STARS', 500, 1, 1000000),
    walletPriceUsd: walletPrice(process.env.WWC_SUBSCRIPTION_USD),
    days: number('WWC_SUBSCRIPTION_DAYS', 30, 1, 365),
    port: number('PORT', 3000, 1, 65535),
  };
}
export type PlatformConfig = ReturnType<typeof platformConfig>;
