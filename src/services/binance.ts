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

export type BinanceCreateOrderResponse = {
  status: 'SUCCESS' | 'FAIL';
  code: string;
  data?: {
    /** Used by the Binance app deep-link / web checkout. */
    prepayId: string;
    /** Terminal type echoed back. */
    terminalType?: string;
    /** ms-since-epoch order expiration. */
    expireTime?: number;
    /** Hosted-image URL for a QR code that opens the Binance app. */
    qrcodeLink?: string;
    /** Raw QR payload (a deep-link URL the wallet can open). */
    qrContent?: string;
    /** Hosted web checkout URL — works on desktop browsers. */
    checkoutUrl?: string;
    /** App deep-link `bnc://...` — opens the Binance app on phones. */
    deeplink?: string;
    /** Universal link variant — fallback for some wallets. */
    universalUrl?: string;
  };
  errorMessage?: string;
};

/**
 * Create a Binance Pay merchant order. Returns the checkout payload
 * (deep-link / QR / web URL) the user follows to pay.
 *
 * Throws on transport / HTTP errors and on Binance API errors. Code
 * 401 / 451 from Binance generally means the merchant account is in
 * a region the merchant API doesn't support — surface that error
 * verbatim so the caller can show a graceful "use another method"
 * fallback.
 */
export async function createOrder(args: {
  merchantTradeNo: string;
  amount: number;
  currency?: string;
  goodsName: string;
  goodsId: string | number;
  /** Optional URLs the user is redirected to after pay/cancel. */
  returnUrl?: string;
  cancelUrl?: string;
  /** Optional webhook URL for `PAY_SUCCESS` callbacks. */
  webhookUrl?: string;
}): Promise<NonNullable<BinanceCreateOrderResponse['data']>> {
  if (!binanceEnabled()) throw new Error('Binance Pay not configured');
  const body: Record<string, unknown> = {
    env: { terminalType: 'WEB' },
    merchantTradeNo: args.merchantTradeNo,
    orderAmount: args.amount.toFixed(2),
    currency: args.currency ?? 'USDT',
    goods: {
      goodsType: '02',
      goodsCategory: 'Z000',
      referenceGoodsId: String(args.goodsId).slice(0, 32),
      goodsName: args.goodsName.slice(0, 256),
    },
  };
  if (args.returnUrl) body.returnUrl = args.returnUrl;
  if (args.cancelUrl) body.cancelUrl = args.cancelUrl;
  if (args.webhookUrl) body.webhookUrl = args.webhookUrl;

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

  // Capture the raw body BEFORE attempting to parse JSON. When the
  // request is blocked at the CDN/WAF layer (CloudFront, Akamai)
  // the response body is HTML, not JSON, and `res.json()` would
  // throw without surfacing the actual block reason. We log the
  // raw text + a few diagnostic headers (cf-ray / x-amz-cf-id /
  // server) so we can tell whether the 451 came from Binance's
  // app server or from a fronting CDN.
  const rawText = await res.text();
  const diagHeaders: Record<string, string> = {};
  for (const k of [
    'server',
    'cf-ray',
    'cf-cache-status',
    'x-amz-cf-id',
    'x-amz-cf-pop',
    'x-cache',
    'x-served-by',
    'via',
    'content-type',
  ]) {
    const v = res.headers.get(k);
    if (v) diagHeaders[k] = v;
  }

  let json: BinanceCreateOrderResponse | null = null;
  try {
    json = JSON.parse(rawText) as BinanceCreateOrderResponse;
  } catch {
    /* HTML / non-JSON body — leave json=null so we log the raw text */
  }

  if (!res.ok || !json || json.status !== 'SUCCESS' || !json.data) {
    logger.warn(
      {
        http: res.status,
        merchantTradeNo: args.merchantTradeNo,
        rawBodyHead: rawText.slice(0, 800),
        rawBodyLen: rawText.length,
        headers: diagHeaders,
        json,
      },
      'Binance Pay createOrder failed',
    );
    const reason = json?.errorMessage
      ? json.errorMessage
      : json?.code
        ? `code=${json.code}`
        : `http=${res.status} body=${rawText.slice(0, 200)}`;
    throw new Error(`Binance Pay createOrder error: ${reason}`);
  }
  return json.data;
}
