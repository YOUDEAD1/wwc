import { randomBytes } from 'node:crypto';
import { signature, PlatformError } from '../security.js';
import type { PlatformConfig } from '../config.js';
export type WalletCheckout = {
  token: string;
  shop_id: string;
  bot_username: string;
  state: string;
  amount: string;
  currency: string;
  days: number;
  balance: string;
  balance_after: string | null;
  reference: string | null;
  expires_at: string;
  expired: boolean;
};
export class NssBridge {
  constructor(private config: PlatformConfig) {}
  async call(action: string, actor: number, data: Record<string, unknown> = {}) {
    const path = '/wwc/manager/v1/' + action,
      body = Buffer.from(JSON.stringify({ ...data, actor_id: actor })),
      time = String(Math.floor(Date.now() / 1000)),
      nonce = randomBytes(24).toString('base64url');
    const res = await fetch(this.config.nssOrigin + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-wwc-time': time,
        'x-wwc-nonce': nonce,
        'x-wwc-signature': signature(this.config.sharedSecret, 'POST', path, time, nonce, body),
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(55000),
    });
    const bytes = await res.text();
    if (bytes.length > 32768) throw new PlatformError(502, 'NSS_RESPONSE_TOO_LARGE');
    let result: any;
    try {
      result = JSON.parse(bytes);
    } catch {
      throw new PlatformError(502, 'NSS_UNAVAILABLE');
    }
    if (!res.ok || !result.ok)
      throw new PlatformError(
        res.status,
        String(result.error ?? 'NSS_UNAVAILABLE').match(/^[A-Z_0-9]{1,100}$/)?.[0] ??
          'NSS_UNAVAILABLE',
      );
    return result;
  }
}
