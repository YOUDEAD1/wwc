/**
 * Bybit internal-transfer verifier.
 *
 * The buyer sends USDT inside Bybit to the owner's Bybit UID / account,
 * then pastes the Bybit internal transfer TXID. We query the API-key
 * owner's internal deposit records and approve only successful USDT
 * deposits that match that TXID.
 */
import crypto from 'node:crypto';
import { fetch } from 'undici';
import { env } from '../env.js';
import { logger } from '../logger.js';
import type { DBDeposit } from '../types.js';

const DEFAULT_BASE_URLS = ['https://api.bybit.com', 'https://api.bytick.com'] as const;
const ENDPOINT = '/v5/asset/deposit/query-internal-record';
const RECV_WINDOW_MS = 5000;

export type BybitInternalDepositRecord = {
  id?: string;
  coin?: string;
  amount?: string;
  status?: number | string;
  address?: string;
  createdTime?: string;
  fromMemberId?: string;
  txID?: string;
};

type BybitEnvelope<T> = {
  retCode?: number;
  retMsg?: string;
  result?: T;
};

type BybitDepositList = {
  rows?: BybitInternalDepositRecord[];
};

export type BybitVerifyResult =
  | {
      ok: true;
      txId: string;
      amount: number;
      paidAtMs: number | null;
      sender: string | null;
    }
  | { ok: false; reason: string };

function readCreds(): { apiKey: string; apiSecret: string } | null {
  const apiKey = env.BYBIT_API_KEY;
  const apiSecret = env.BYBIT_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

function splitEnvList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

function readBaseUrls(): string[] {
  const configured = uniq([
    ...splitEnvList(env.BYBIT_API_BASE_URLS),
    ...splitEnvList(env.BYBIT_API_BASE_URL),
  ]);
  const raw = configured.length > 0 ? configured : [...DEFAULT_BASE_URLS];
  const valid = raw
    .map((value) => value.replace(/\/+$/, ''))
    .filter((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:';
      } catch {
        logger.warn({ value }, 'bybit: ignoring invalid base URL');
        return false;
      }
    });
  return valid.length > 0 ? valid : [...DEFAULT_BASE_URLS];
}

function sign(queryString: string, timestamp: string, apiKey: string, secret: string): string {
  const payload = `${timestamp}${apiKey}${RECV_WINDOW_MS}${queryString}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function parseBybitTimeMs(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1_000_000_000_000 ? n * 1000 : n;
}

async function bybitGet<T>(
  path: string,
  params: URLSearchParams,
): Promise<BybitEnvelope<T>> {
  const creds = readCreds();
  if (!creds) throw new Error('bybit api credentials missing');

  const query = params.toString();
  const timestamp = String(Date.now());
  const signature = sign(query, timestamp, creds.apiKey, creds.apiSecret);
  const headers = {
    'X-BAPI-API-KEY': creds.apiKey,
    'X-BAPI-TIMESTAMP': timestamp,
    'X-BAPI-RECV-WINDOW': String(RECV_WINDOW_MS),
    'X-BAPI-SIGN': signature,
    'X-BAPI-SIGN-TYPE': '2',
    'content-type': 'application/json',
  };

  const failures: string[] = [];
  for (const baseUrl of readBaseUrls()) {
    const url = `${baseUrl}${path}${query ? `?${query}` : ''}`;
    try {
      const res = await fetch(url, { headers });
      const text = await res.text();
      let json: unknown = null;
      if (text.trim().length > 0) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text };
        }
      }
      if (!res.ok) {
        failures.push(`${baseUrl}: http ${res.status}${text ? ` ${text.slice(0, 160)}` : ''}`);
        continue;
      }
      const envelope = (json ?? {}) as BybitEnvelope<T>;
      if (envelope.retCode !== 0) {
        failures.push(
          `${baseUrl}: api ${envelope.retCode ?? '?'}${envelope.retMsg ? ` ${envelope.retMsg}` : ''}`,
        );
        continue;
      }
      return envelope;
    } catch (err) {
      failures.push(`${baseUrl}: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  logger.warn({ failures }, 'bybit: all API routes failed');
  throw new Error(`bybit unavailable: ${failures.slice(0, 3).join('; ')}`);
}

export function isBybitPayEnabled(): boolean {
  return readCreds() !== null;
}

export async function listBybitInternalDeposits(opts: {
  txID?: string;
  startTime?: number;
  endTime?: number;
  coin?: string;
  limit?: number;
} = {}): Promise<BybitInternalDepositRecord[]> {
  const params = new URLSearchParams();
  if (opts.txID) params.set('txID', opts.txID);
  if (opts.startTime !== undefined) params.set('startTime', String(Math.floor(opts.startTime)));
  if (opts.endTime !== undefined) params.set('endTime', String(Math.floor(opts.endTime)));
  if (opts.coin) params.set('coin', opts.coin.toUpperCase());
  params.set('limit', String(opts.limit ?? 50));

  const envelope = await bybitGet<BybitDepositList>(ENDPOINT, params);
  return Array.isArray(envelope.result?.rows) ? envelope.result.rows : [];
}

export async function verifyBybitInternalDeposit(args: {
  txID: string;
  deposit: DBDeposit;
}): Promise<BybitVerifyResult> {
  if (!isBybitPayEnabled()) {
    return { ok: false, reason: 'bybit api credentials missing' };
  }

  const createdAtMs = new Date(args.deposit.created_at).getTime();
  const startTime = Number.isFinite(createdAtMs)
    ? createdAtMs - 35 * 60 * 1000
    : Date.now() - 24 * 60 * 60 * 1000;
  const endTime = Date.now() + 5 * 60 * 1000;
  const records = await listBybitInternalDeposits({
    txID: args.txID,
    coin: 'USDT',
    startTime,
    endTime,
    limit: 50,
  });
  const txId = args.txID.trim();
  const record =
    records.find((r) => String(r.txID ?? '').trim() === txId) ??
    records.find((r) => String(r.id ?? '').trim() === txId);
  if (!record) {
    return {
      ok: false,
      reason: 'bybit internal transfer not found in your Bybit deposit records',
    };
  }

  const status = Number(record.status);
  if (status !== 2) {
    return {
      ok: false,
      reason: `bybit internal transfer is not successful yet (status: ${record.status ?? 'unknown'})`,
    };
  }

  const coin = String(record.coin ?? '').toUpperCase();
  if (coin !== 'USDT') {
    return {
      ok: false,
      reason: `bybit coin mismatch: expected USDT, got ${coin || 'unknown'}`,
    };
  }

  const amount = Number(record.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ok: false,
      reason: `bybit returned non-positive amount: ${record.amount ?? 'unknown'}`,
    };
  }

  return {
    ok: true,
    txId: String(record.txID ?? record.id ?? txId),
    amount,
    paidAtMs: parseBybitTimeMs(record.createdTime),
    sender: record.fromMemberId
      ? `UID ${record.fromMemberId}`
      : record.address
        ? String(record.address)
        : null,
  };
}
