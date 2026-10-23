import { PlatformError } from './security.js';
export async function telegram<T = any>(
  token: string,
  method: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  const b = (await r.json()) as { ok: boolean; result: T };
  if (!r.ok || !b.ok) throw new PlatformError(502, 'TELEGRAM_REQUEST_FAILED');
  return b.result;
}
