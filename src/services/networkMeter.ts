import { AsyncLocalStorage } from 'node:async_hooks';
import { compatibleFetch } from './telegramFetch.js';
const origin = new AsyncLocalStorage<string>();
const counters = new Map<
  string,
  { requests: number; received: number; sent: number; failed: number }
>();
const started = Date.now();
export function withNetworkOrigin<T>(name: string, fn: () => Promise<T>) {
  return origin.run(name, fn);
}
export const measuredFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const key = (origin.getStore() ?? 'background') + ' → ' + url.hostname;
  if (!counters.has(key) && counters.size >= 200) counters.delete(counters.keys().next().value!);
  const stats = counters.get(key) ?? { requests: 0, received: 0, sent: 0, failed: 0 };
  counters.set(key, stats);
  stats.requests++;
  if (typeof init?.body === 'string') stats.sent += Buffer.byteLength(init.body);
  try {
    const res = await compatibleFetch(input, init);
    stats.received += Number(res.headers.get('content-length') ?? 0);
    if (!res.ok && res.status !== 304) stats.failed++;
    return res;
  } catch (e) {
    stats.failed++;
    throw e;
  }
};
export function networkSnapshot() {
  return (
    'قياس الشبكة منذ تشغيل العملية (' +
    Math.floor((Date.now() - started) / 60000) +
    ' دقيقة)\n\n' +
    [...counters]
      .sort((a, b) => b[1].requests - a[1].requests)
      .slice(0, 15)
      .map(
        ([key, s]) =>
          key +
          '\nطلبات: ' +
          s.requests +
          ' | فاشلة: ' +
          s.failed +
          ' | بيانات مستلمة تقديريًا: ' +
          (s.received / 1048576).toFixed(2) +
          ' MB',
      )
      .join('\n\n') +
    '\n\nالأحجام تقديرية من ترويسات HTTP وليست قراءة لفاتورة الاستضافة.'
  );
}

export function recordTransfer(provider: string, url: string, received: number, failed: boolean) {
  const key =
    (origin.getStore() ?? 'background') + ' → ' + provider + ' / ' + new URL(url).hostname;
  const s = counters.get(key) ?? { requests: 0, received: 0, sent: 0, failed: 0 };
  s.requests++;
  s.received += received;
  if (failed) s.failed++;
  counters.set(key, s);
}
