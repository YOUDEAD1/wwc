/**
 * Binance Pay personal-account verifier client.
 *
 * Wraps the read-only `GET /sapi/v1/pay/transactions` endpoint that
 * exposes the API-key-owner's Binance Pay transaction history. The
 * deposit verifier uses this to look up a user-pasted Order ID and
 * confirm:
 *
 *   - the order was paid into the configured merchant Pay ID,
 *   - in the expected currency (USDT),
 *   - within the deposit's accepted time window.
 *
 * The endpoint requires HMAC-SHA256 signed requests authenticated
 * with `BINANCE_PAY_API_KEY` / `BINANCE_PAY_API_SECRET`. When either
 * env var is unset, every public function returns
 * `{ ok: false, reason: 'binance api credentials missing' }` so the
 * caller can defer to the manual admin-approval flow.
 *
 * Region note: `api.binance.com` returns HTTP 451 from many cloud
 * regions (Azure / Railway). This client expects outbound traffic
 * from the bot host to be routed through a VPN to a Binance-friendly
 * exit IP. The verifier surfaces the 451 verbatim so admins can spot
 * a misconfigured VPN sidecar quickly.
 */
import crypto from 'node:crypto';
import { ProxyAgent, fetch, type Response } from 'undici';
import { env } from '../env.js';
import { logger } from '../logger.js';

const BASE_URL = 'https://api.binance.com';
const ENDPOINT = '/sapi/v1/pay/transactions';
const RECV_WINDOW_MS = 5000;
const PROXY_URL = env.BINANCE_PROXY_URL?.trim();
let proxyDispatcher: ProxyAgent | undefined;
let proxyInitError: string | undefined;

if (PROXY_URL) {
  try {
    proxyDispatcher = new ProxyAgent(PROXY_URL);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    proxyInitError = message;
    logger.warn({ err }, 'binance: invalid BINANCE_PROXY_URL');
  }
}

/** Single Pay transaction returned by the API. */
export type BinancePayTransaction = {
  /** UID of the API-key owner. */
  uid: number;
  /** UID of the other party (sender for incoming, receiver for outgoing). */
  counterpartyId: number;
  /** Public order id — the value the user pastes in the bot. */
  orderId: string;
  /** Optional payer-supplied note, often empty. */
  note: string;
  /**
   * Type of Pay flow:
   *   - `C2C`           — peer-to-peer transfer (this is what the
   *                       Binance Pay top-up screen produces).
   *   - `PAY`           — merchant pay request.
   *   - `PAY_REFUND`    — refund of a `PAY` order.
   *   - `CRYPTO_BOX`    — red-packet send/claim.
   *   - `FIAT_PAYMENT`  — fiat checkout.
   *   - `FIAT_REFUND`   — fiat refund.
   *   - `XOXO_TRANSFER` — gift transfer.
   */
  orderType: string;
  /** Internal Binance transaction id, used for repo-wide dedupe. */
  transactionId: string;
  /** Transaction completion time in epoch milliseconds. */
  transactionTime: number;
  /** Crypto amount as a decimal string. */
  amount: string;
  /** Asset symbol (e.g. `USDT`). */
  currency: string;
  walletType: number;
  walletTypes: string[];
  fundsDetail: {
    currency: string;
    amount: string;
    walletAssetCost?: unknown;
  };
  /** Sender info — present on incoming C2C transfers. */
  payerInfo?: {
    name?: string;
    type?: string;
    binanceId: number;
    unmaskData?: boolean;
  };
  /** Recipient info — present on outgoing transfers. */
  receiverInfo?: {
    name?: string;
    type?: string;
    binanceId: number;
    unmaskData?: boolean;
  };
  totalPaymentFee: string;
};

type BinanceApiOk<T> = { ok: true; data: T };
type BinanceApiErr = { ok: false; reason: string };
type BinanceApiResult<T> = BinanceApiOk<T> | BinanceApiErr;

function readCreds(): { apiKey: string; apiSecret: string } | null {
  const apiKey = env.BINANCE_PAY_API_KEY;
  const apiSecret = env.BINANCE_PAY_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

function signQuery(query: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(query).digest('hex');
}

/**
 * Fetch the API-key owner's recent Binance Pay transactions in the
 * given time window. The endpoint caps results at 100 per call and
 * accepts an optional `[startTime, endTime]` range (epoch ms,
 * max 30-day span). When called without bounds the most recent 100
 * transactions are returned.
 */
export async function listPayTransactions(opts: {
  startTime?: number;
  endTime?: number;
  limit?: number;
} = {}): Promise<BinanceApiResult<BinancePayTransaction[]>> {
  const creds = readCreds();
  if (!creds) {
    return { ok: false, reason: 'binance api credentials missing' };
  }
  if (proxyInitError) {
    return { ok: false, reason: `binance proxy misconfigured: ${proxyInitError}` };
  }
  const params = new URLSearchParams();
  if (opts.startTime !== undefined) params.set('startTime', String(opts.startTime));
  if (opts.endTime !== undefined) params.set('endTime', String(opts.endTime));
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  params.set('timestamp', String(Date.now()));
  params.set('recvWindow', String(RECV_WINDOW_MS));
  const query = params.toString();
  const sig = signQuery(query, creds.apiSecret);
  const url = `${BASE_URL}${ENDPOINT}?${query}&signature=${sig}`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { 'X-MBX-APIKEY': creds.apiKey },
      ...(proxyDispatcher ? { dispatcher: proxyDispatcher } : {}),
    });
  } catch (err) {
    logger.warn({ err }, 'binance: fetch threw — treating as transient network failure');
    return {
      ok: false,
      reason: `binance fetch failed: ${(err as Error)?.message ?? String(err)}`,
    };
  }

  if (resp.status === 451) {
    return {
      ok: false,
      reason: 'binance returned 451 — VPN sidecar exit IP is region-blocked',
    };
  }
  const bodyText = await resp.text();
  if (resp.status !== 200) {
    logger.warn(
      { status: resp.status, body: bodyText.slice(0, 400) },
      'binance: non-200 from /sapi/v1/pay/transactions',
    );
    return { ok: false, reason: `binance http ${resp.status}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { ok: false, reason: 'binance returned non-JSON body' };
  }
  const obj = parsed as {
    code?: string;
    success?: boolean;
    data?: BinancePayTransaction[];
    msg?: string;
  };
  if (obj.code !== '000000' || obj.success !== true || !Array.isArray(obj.data)) {
    logger.warn(
      { code: obj.code, msg: obj.msg },
      'binance: API returned non-success envelope',
    );
    return {
      ok: false,
      reason: `binance api error ${obj.code ?? '?'}${obj.msg ? `: ${obj.msg}` : ''}`,
    };
  }
  return { ok: true, data: obj.data };
}

/**
 * Look up a single Pay transaction by its public Order ID inside the
 * given time window. Returns `null` (with `ok: true`) when the API
 * succeeded but no matching order was found, so callers can
 * distinguish "user pasted a bad ID" from "binance is down".
 */
export async function findPayTransactionByOrderId(
  orderId: string,
  opts: { startTime?: number; endTime?: number } = {},
): Promise<BinanceApiResult<BinancePayTransaction | null>> {
  const result = await listPayTransactions({ ...opts, limit: 100 });
  if (!result.ok) return result;
  const trimmed = orderId.trim();
  const found = result.data.find((t) => String(t.orderId) === trimmed) ?? null;
  return { ok: true, data: found };
}

/** Whether the Binance Pay verifier is enabled (both env vars set). */
export function isBinancePayEnabled(): boolean {
  return readCreds() !== null;
}
