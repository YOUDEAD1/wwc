import { getDbScope } from '../db/db_context.js';
type Entry = { value: unknown; expires: number; size: number };
const store = new Map<string, Entry>();
const pending = new Map<string, Promise<unknown>>();
let bytes = 0;
const scoped = (key: string) => getDbScope() + ':' + key;
export function get<T>(key: string): T | undefined {
  const k = scoped(key),
    e = store.get(k);
  if (!e) return;
  if (e.expires <= Date.now()) {
    store.delete(k);
    bytes -= e.size;
    return;
  }
  return structuredClone(e.value) as T;
}
export function set<T>(key: string, value: T, ttlMs = 60000): void {
  const k = scoped(key),
    size = Buffer.byteLength(JSON.stringify(value) ?? 'null');
  const prev = store.get(k);
  if (prev) bytes -= prev.size;
  store.delete(k);
  if (size > 8 * 1024 * 1024) return;
  while (store.size >= 4096 || bytes + size > 48 * 1024 * 1024) {
    const first = store.keys().next().value;
    if (!first) break;
    bytes -= store.get(first)!.size;
    store.delete(first);
  }
  store.set(k, { value: structuredClone(value), expires: Date.now() + ttlMs, size });
  bytes += size;
}
export function del(key: string): void {
  const k = scoped(key),
    e = store.get(k);
  if (e) bytes -= e.size;
  store.delete(k);
  pending.delete(k);
}
export function clearAll(): void {
  store.clear();
  pending.clear();
  bytes = 0;
}
export async function remember<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const value = get<T>(key);
  if (value !== undefined) return value;
  const k = scoped(key);
  if (pending.has(k)) return structuredClone(await pending.get(k)) as T;
  const promise = load();
  pending.set(k, promise);
  try {
    const result = await promise;
    if (pending.get(k) === promise) set(key, result, ttl);
    return structuredClone(result);
  } finally {
    if (pending.get(k) === promise) pending.delete(k);
  }
}
