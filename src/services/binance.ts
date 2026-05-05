/**
 * Binance Pay merchant API client.
 *
 * Used for the Pay-ID top-up flow: the user sends USDT to the merchant
 * Pay ID and submits the resulting Order ID. We call `queryOrder` with
 * that Order ID and auto-credit when the response says `status: PAID`.
 *
 * Auth scheme:
 *   payload    = `${timestamp}\n${nonce}\n${rawBody}\n`
 *   signature  = HMAC-SHA512(payload, apiSecret) → uppercase hex
 *
 * Headers Binance expects on outbound requests:
 *   BinancePay-Timestamp        – ms since epoch
 *   BinancePay-Nonce            – 32 char alphanumeric
 *   BinancePay-Certificate-SN   – the merchant API key
 *   BinancePay-Signature        – computed signature
 *   Content-Type                – application/json
 */
import crypto from 'node:crypto';
import { env } from '../env.js';
import { logger } from '../logger.js';

const BINANCE_PAY_BASE = 'https://bpay.binanceapi.com';

export function binanceEnabled(): boolean {
  return Boolean(env.BINANCE_PAY_API_KEY && env.BINANCE_PAY_API_SECRET);
}

function makeNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

function sign(timestamp: string, nonce: string, rawBody: string): string {
  const payload = `${timestamp}\n${nonce}\n${rawBody}\n`;
  return crypto
    .createHmac('sha512', env.BINANCE_PAY_API_SECRET || '')
    .update(payload)
    .digest('hex')
    .toUpperCase();
}

export type BinanceQueryOrderResponse = {
  status: 'SUCCESS' | 'FAIL';
  code: string;
  data?: {
    merchantId?: string;
    prepayId?: string;
    transactionId?: string;
    merchantTradeNo?: string;
    /**
     * Order lifecycle: INITIAL | PENDING | PAID | CANCELED | ERROR |
     *                  REFUNDING | REFUNDED | EXPIRED.
     */
    status?: string;
    currency?: string;
    orderAmount?: string;
    /** ISO ms timestamp when the order was created. */
    createTime?: number;
    /** ISO ms timestamp when the order was paid (only when status=PAID). */
    transactTime?: number;
  };
  errorMessage?: string;
};

/**
 * Query a Binance Pay order by `merchantTradeNo`. Returns the response
 * data on a successful HTTP+API call (the caller should still inspect
 * `data.status === 'PAID'`). Throws only on transport failure or when
 * the API returns a non-FOUND error code we cannot interpret.
 *
 * Returns `null` when Binance reports the trade number doesn't exist.
 */
export async function queryOrder(args: {
  merchantTradeNo: string;
}): Promise<BinanceQueryOrderResponse['data'] | null> {
  if (!binanceEnabled()) throw new Error('Binance Pay not configured');

  const body = { merchantTradeNo: args.merchantTradeNo };
  const rawBody = JSON.stringify(body);
  const timestamp = String(Date.now());
  const nonce = makeNonce();
  const signature = sign(timestamp, nonce, rawBody);

  const res = await fetch(`${BINANCE_PAY_BASE}/binancepay/openapi/v2/order/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'BinancePay-Timestamp': timestamp,
      'BinancePay-Nonce': nonce,
      'BinancePay-Certificate-SN': env.BINANCE_PAY_API_KEY || '',
      'BinancePay-Signature': signature,
    },
    body: rawBody,
  });
  const json = (await res.json()) as BinanceQueryOrderResponse;
  // 400000 = order not found (or merchant has no permission to view).
  // Treat that as a soft "not found" instead of a hard error so the
  // caller can fall back to manual verification.
  if (json.status === 'FAIL' && json.code && /400000|400001/.test(json.code)) {
    return null;
  }
  if (!res.ok || json.status !== 'SUCCESS' || !json.data) {
    logger.warn(
      { json, http: res.status, merchantTradeNo: args.merchantTradeNo },
      'Binance Pay queryOrder failed',
    );
    throw new Error(
      json.errorMessage || `Binance Pay queryOrder error: ${json.code || res.status}`,
    );
  }
  return json.data;
}
