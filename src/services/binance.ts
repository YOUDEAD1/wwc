/**
 * Binance Pay merchant API client + webhook signature verification.
 *
 * Auth scheme (same for outgoing requests and incoming webhooks):
 *   payload    = `${timestamp}\n${nonce}\n${rawBody}\n`
 *   signature  = HMAC-SHA512(payload, apiSecret) → uppercase hex
 *
 * Headers Binance expects on outbound requests:
 *   BinancePay-Timestamp   – ms since epoch
 *   BinancePay-Nonce       – 32 char alphanumeric
 *   BinancePay-Certificate-SN – the merchant API key
 *   BinancePay-Signature   – computed signature
 *   Content-Type           – application/json
 */
import crypto from 'node:crypto';
import { env } from '../env.js';
import { logger } from '../logger.js';

const BINANCE_PAY_BASE = 'https://bpay.binanceapi.com';

/**
 * Public, hard-coded Binance Pay identity that users send USDT to.
 * The bot doesn't use the merchant `createOrder` flow anymore — Binance
 * was rejecting those requests (error 451) — so users instead send a
 * direct Pay ID transfer and submit their Order ID for verification.
 */
export const BINANCE_PAY_ID = '1225852869';
export const BINANCE_PAY_NAME = 'SafwanTiger';

/** How long a generated note code is valid for, in minutes. */
export const BINANCE_TOPUP_WINDOW_MINUTES = 30;

/**
 * Generate a fresh 6-digit numeric note code for a Pay-ID top-up.
 * The user types this code into Binance Pay's "Remark" field when
 * sending USDT so we (and the admin) can match the on-chain transfer
 * back to a specific top-up request and prevent order-ID stealing.
 */
export function generateNoteCode(): string {
  // 6-digit zero-padded number, range 100000–999999. Avoid leading
  // zeros so users don't trim them by accident when copying.
  return String(100000 + crypto.randomInt(0, 900000));
}

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

/** Verify the signature on an inbound Binance Pay webhook. */
export function verifyWebhookSignature(
  timestamp: string,
  nonce: string,
  rawBody: string,
  receivedSignature: string,
): boolean {
  if (!binanceEnabled()) return false;
  const expected = sign(timestamp, nonce, rawBody);
  // timing-safe compare
  if (expected.length !== receivedSignature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedSignature));
}

export type BinanceCreateOrderResponse = {
  status: 'SUCCESS' | 'FAIL';
  code: string;
  data?: {
    prepayId: string;
    terminalType: string;
    expireTime: number;
    qrcodeLink: string;
    qrContent: string;
    checkoutUrl: string;
    deeplink: string;
    universalUrl: string;
  };
  errorMessage?: string;
};

/**
 * Create a Binance Pay order. Returns the response data (including
 * the checkout URL) or throws on HTTP/auth failure.
 */
export async function createOrder(args: {
  merchantTradeNo: string;
  amount: number;
  currency?: string; // default USDT
  goodsName: string;
  returnUrl?: string;
  webhookUrl?: string;
}): Promise<BinanceCreateOrderResponse['data']> {
  if (!binanceEnabled()) throw new Error('Binance Pay not configured');

  const body = {
    env: { terminalType: 'WEB' },
    merchantTradeNo: args.merchantTradeNo,
    orderAmount: Number(args.amount.toFixed(2)),
    currency: args.currency ?? 'USDT',
    goods: {
      goodsType: '02', // virtual goods
      goodsCategory: 'Z000', // others
      referenceGoodsId: args.merchantTradeNo,
      goodsName: args.goodsName.slice(0, 256),
    },
    ...(args.returnUrl ? { returnUrl: args.returnUrl } : {}),
    ...(args.webhookUrl ? { webhookUrl: args.webhookUrl } : {}),
  };
  const rawBody = JSON.stringify(body);
  const timestamp = String(Date.now());
  const nonce = makeNonce();
  const signature = sign(timestamp, nonce, rawBody);

  const res = await fetch(`${BINANCE_PAY_BASE}/binancepay/openapi/v3/order`, {
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
  const json = (await res.json()) as BinanceCreateOrderResponse;
  if (!res.ok || json.status !== 'SUCCESS' || !json.data) {
    logger.error({ json, http: res.status }, 'Binance Pay createOrder failed');
    throw new Error(json.errorMessage || `Binance Pay error: ${json.code || res.status}`);
  }
  return json.data;
}

export function makeMerchantTradeNo(userId: number): string {
  // ASCII 1-32, only [A-Za-z0-9]. Use a userId + epoch + random suffix.
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `STG${userId}${Date.now().toString(36).toUpperCase()}${suffix}`.slice(0, 32);
}

// ---------------------------------------------------------------------
//  Order query — used by the auto-verify path in the Pay-ID top-up
//  flow. The user pastes their Binance Pay Order ID (= merchantTradeNo
//  for orders we created via createOrder, or a payer-side txn id for
//  pure Pay-ID transfers). We try `merchantTradeNo` first because
//  that's the merchant-side identifier the API actually understands.
//  Pay-ID-only transfers will return a "not found" response — those
//  remain a manual-verify case.
// ---------------------------------------------------------------------

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
