/**
 * On-chain payment verification helpers.
 *
 * Supported networks:
 *   * USDT TRC20  – TronGrid public REST API
 *   * USDT BEP20  – publicly hosted BSC JSON-RPC endpoints (failover)
 *   * USDT TON    – TonCenter REST API (jetton transfer detection)
 *   * LTC         – BlockCypher REST API (native litecoin outputs)
 *
 * Each verifier takes a user-submitted transaction hash, looks it up
 * on a public blockchain endpoint, and returns either:
 *
 *   - { ok: true, amount, sender }  – confirmed, contract + recipient
 *                                     matched, amount decoded.
 *   - { ok: false, reason }         – something didn't match.
 *
 * The verifiers are intentionally network-only: no heavy SDKs,
 * optional API keys (set them for higher rate-limits on production).
 */
import crypto from 'node:crypto';
import { env } from '../env.js';
import { logger } from '../logger.js';

// -- USDT contracts -------------------------------------------------------

export const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const USDT_BEP20_CONTRACT =
  '0x55d398326f99059fF775485246999027B3197955';
export const USDT_TON_MASTER =
  'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const TRONGRID_BASES = [
  'https://api.trongrid.io',
  'https://api.tronstack.io',
];
const BSC_RPC_BASES = [
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-dataseed1.ninicoin.io',
  'https://rpc.ankr.com/bsc',
];

/** Common shape returned by all verifiers. */
export type ChainVerifyResult =
  | {
      ok: true;
      /** Amount in native unit (USDT for stablecoins, LTC for Litecoin). */
      amount: number;
      sender: string;
      confirmations: number | null;
      /**
       * Block timestamp in *milliseconds since epoch* — the moment the
       * transaction was mined / settled on-chain. Used by
       * `services/depositVerify.ts` to enforce the 30-minute
       * acceptance window against the flow-open timestamp so a user
       * can't replay an old vendor TXID. `null` only when the
       * upstream provider didn't return a parseable timestamp; the
       * verifier treats `null` as "fail freshness check" so we never
       * approve a tx whose age we couldn't prove.
       */
      paidAtMs: number | null;
    }
  | { ok: false; reason: string };

// -- Shared helpers -------------------------------------------------------

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = 10_000,
): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}
function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return JSON.stringify(err);
}

// =========================================================================
//  TRC20 (TRON)
// =========================================================================

function tronHexToBase58(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const padded = clean.length === 64 ? clean.slice(24) : clean;
  const withPrefix = padded.length === 40 ? '41' + padded : padded;
  const bytes = Buffer.from(withPrefix, 'hex');
  const hash = (b: Buffer): Buffer =>
    crypto.createHash('sha256').update(b).digest();
  const checksum = hash(hash(bytes)).subarray(0, 4);
  const full = Buffer.concat([bytes, checksum]);
  const alphabet =
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + full.toString('hex'));
  let out = '';
  while (n > 0n) {
    const r = Number(n % 58n);
    n = n / 58n;
    out = alphabet[r] + out;
  }
  for (const b of full) {
    if (b === 0) out = '1' + out;
    else break;
  }
  return out;
}

function base58ToHex(addr: string): string {
  const alphabet =
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const ch of addr) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error(`bad base58 char: ${ch}`);
    n = n * 58n + BigInt(idx);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  hex = hex.slice(0, -8); // strip checksum
  return '0x' + hex;
}

export async function verifyTrc20Tx(args: {
  txHash: string;
  expectedAddress: string;
  minAmount: number;
}): Promise<ChainVerifyResult> {
  const txid = args.txHash.replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    return { ok: false, reason: 'tx hash must be 64 hex chars' };
  }
  let lastErr: unknown = null;
  for (const base of TRONGRID_BASES) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (env.TRONGRID_API_KEY) headers['TRON-PRO-API-KEY'] = env.TRONGRID_API_KEY;

      const info = await fetchJson<{
        id?: string;
        blockNumber?: number;
        // TronGrid surfaces the block time as `blockTimeStamp` in
        // *milliseconds*. We forward it to the freshness gate so a
        // stale vendor TXID can't slip past the 30-min window.
        blockTimeStamp?: number;
        receipt?: { result?: string };
        log?: Array<{
          address?: string;
          topics?: string[];
          data?: string;
        }>;
      }>(`${base}/wallet/gettransactioninfobyid`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ value: txid }),
      });
      if (!info || !info.id) {
        return { ok: false, reason: 'tx not found on TRON network' };
      }
      if (info.receipt?.result && info.receipt.result !== 'SUCCESS') {
        return { ok: false, reason: `tx status: ${info.receipt.result}` };
      }
      const logs = info.log ?? [];
      const usdtHexAddress = '41' + base58ToHex(USDT_TRC20_CONTRACT).slice(2);
      let match: { from: string; to: string; value: bigint } | null = null;
      for (const ev of logs) {
        if (!ev.address || !ev.topics || ev.topics.length < 3) continue;
        const addr = ev.address.toLowerCase();
        const expected = usdtHexAddress.slice(2).toLowerCase();
        if (addr !== expected) continue;
        const topic0 = (ev.topics[0] || '').toLowerCase();
        if (topic0 !== ERC20_TRANSFER_TOPIC.slice(2).toLowerCase()) continue;
        match = {
          from: tronHexToBase58((ev.topics[1] || '').toLowerCase()),
          to: tronHexToBase58((ev.topics[2] || '').toLowerCase()),
          value: BigInt('0x' + ((ev.data || '0').toLowerCase() || '0')),
        };
        break;
      }
      if (!match) return { ok: false, reason: 'no USDT Transfer event in tx' };
      if (match.to.toLowerCase() !== args.expectedAddress.toLowerCase()) {
        return { ok: false, reason: `recipient mismatch (paid to ${match.to})` };
      }
      const amount = Number(match.value) / 1_000_000;
      if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, reason: 'could not decode amount' };
      }
      if (amount + 1e-9 < args.minAmount) {
        return { ok: false, reason: `amount ${amount.toFixed(2)} < min ${args.minAmount}` };
      }
      const paidAtMs =
        typeof info.blockTimeStamp === 'number' && Number.isFinite(info.blockTimeStamp)
          ? info.blockTimeStamp
          : null;
      return {
        ok: true,
        amount: round2(amount),
        sender: match.from,
        confirmations: info.blockNumber ?? null,
        paidAtMs,
      };
    } catch (err) {
      lastErr = err;
      logger.warn({ err, base }, 'TRC20 verify: base failed, trying next');
    }
  }
  return { ok: false, reason: `TRC20 lookup failed: ${stringifyErr(lastErr)}` };
}

// =========================================================================
//  BEP20 (Binance Smart Chain)
// =========================================================================

type BscReceipt = {
  status: string;
  blockNumber: string;
  from: string;
  to: string;
  logs: Array<{ address: string; topics: string[]; data: string }>;
};

async function bscRpc<T>(method: string, params: unknown[]): Promise<T> {
  let lastErr: unknown = null;
  for (const base of BSC_RPC_BASES) {
    try {
      const json = await fetchJson<{ result?: T; error?: { message: string } }>(
        base,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
        },
      );
      if (json.error) throw new Error(json.error.message);
      if (json.result === undefined || json.result === null) {
        throw new Error('empty rpc result');
      }
      return json.result;
    } catch (err) {
      lastErr = err;
      logger.warn({ err, base, method }, 'BSC RPC: endpoint failed, trying next');
    }
  }
  throw lastErr ?? new Error('all BSC RPC endpoints failed');
}

export async function verifyBep20Tx(args: {
  txHash: string;
  expectedAddress: string;
  minAmount: number;
}): Promise<ChainVerifyResult> {
  const hash = args.txHash.startsWith('0x')
    ? args.txHash.toLowerCase()
    : '0x' + args.txHash.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash)) {
    return { ok: false, reason: 'tx hash must be 0x + 64 hex chars' };
  }
  let receipt: BscReceipt | null;
  try {
    receipt = await bscRpc<BscReceipt | null>('eth_getTransactionReceipt', [hash]);
  } catch (err) {
    return { ok: false, reason: `BSC lookup failed: ${stringifyErr(err)}` };
  }
  if (!receipt) return { ok: false, reason: 'tx not found on BSC' };
  if (receipt.status !== '0x1') return { ok: false, reason: 'tx reverted (status 0x0)' };

  const usdt = USDT_BEP20_CONTRACT.toLowerCase();
  const want = args.expectedAddress.toLowerCase();
  let totalRaw = 0n;
  let sender = receipt.from?.toLowerCase() ?? '';
  for (const ev of receipt.logs ?? []) {
    if ((ev.address ?? '').toLowerCase() !== usdt) continue;
    if ((ev.topics?.[0] ?? '').toLowerCase() !== ERC20_TRANSFER_TOPIC) continue;
    const toHex = '0x' + (ev.topics[2] ?? '').slice(-40).toLowerCase();
    if (toHex !== want) continue;
    const fromHex = '0x' + (ev.topics[1] ?? '').slice(-40).toLowerCase();
    if (!sender) sender = fromHex;
    totalRaw += BigInt(ev.data || '0x0');
  }
  if (totalRaw === 0n) {
    return { ok: false, reason: 'no USDT Transfer to wallet in tx' };
  }
  const amount = Number(totalRaw) / 1e18;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: 'could not decode amount' };
  }
  if (amount + 1e-9 < args.minAmount) {
    return { ok: false, reason: `amount ${amount.toFixed(2)} < min ${args.minAmount}` };
  }

  // Block timestamp lookup. The receipt only carries a block number,
  // so we follow up with `eth_getBlockByNumber` to read the seconds-
  // since-epoch `timestamp` field. The freshness gate in
  // `services/depositVerify.ts` rejects on `null`, so a transient RPC
  // blip during this lookup will defer the deposit to admin review
  // rather than silently accepting a stale TXID.
  let paidAtMs: number | null = null;
  try {
    const block = await bscRpc<{ timestamp?: string } | null>(
      'eth_getBlockByNumber',
      [receipt.blockNumber, false],
    );
    const tsHex = block?.timestamp;
    if (typeof tsHex === 'string' && tsHex.length > 0) {
      const tsSec = parseInt(tsHex, 16);
      if (Number.isFinite(tsSec)) paidAtMs = tsSec * 1000;
    }
  } catch (err) {
    logger.warn({ err, hash }, 'BEP20 verify: block timestamp lookup failed');
  }

  return {
    ok: true,
    amount: round2(amount),
    sender,
    confirmations: parseInt(receipt.blockNumber, 16) || null,
    paidAtMs,
  };
}

// =========================================================================
//  USDT on TON (Jetton transfer)
// =========================================================================

const TONCENTER_BASE = 'https://toncenter.com/api/v2';

/**
 * Verify a USDT jetton transfer on TON.
 *
 * Strategy: fetch the transaction by its base64 hash via TonCenter,
 * then inspect the in-message for the jetton `transfer` opcode
 * (0x0f8a7ea5). The jetton wallet address for the recipient is
 * pre-derivable, but since the user's deposit address IS the jetton
 * master, we use TonCenter's `/getTransactions` on the recipient's
 * TON address and look for the `internal_transfer` (0x178d4519)
 * incoming message instead. Alternatively, we can use `/jetton/transfers`
 * if available, but TonCenter v2 doesn't expose that endpoint directly.
 *
 * Simpler approach: use the Ton API v2 `blockchain/transactions/{hash}`,
 * which returns structured jetton info. We prefer this when available.
 */
export async function verifyTonUsdtTx(args: {
  txHash: string;
  expectedAddress: string;
  minAmount: number;
}): Promise<ChainVerifyResult> {
  const hash = args.txHash.trim();
  // TON tx hashes are 64 hex chars or 44 base64 chars.
  const isHex = /^[0-9a-fA-F]{64}$/.test(hash);
  const isBase64 = /^[A-Za-z0-9+/=]{43,44}$/.test(hash);
  if (!isHex && !isBase64) {
    return { ok: false, reason: 'TON tx hash must be 64 hex chars or base64' };
  }

  // Try Ton API v2 (tonapi.io) first — it returns structured jetton data.
  try {
    const result = await verifyTonViaTonApi(hash, args);
    if (result) return result;
  } catch (err) {
    logger.warn({ err }, 'TON verify via tonapi failed, trying TonCenter');
  }

  // Fallback: TonCenter getTransactions on the recipient address
  try {
    return await verifyTonViaTonCenter(hash, args);
  } catch (err) {
    return { ok: false, reason: `TON lookup failed: ${stringifyErr(err)}` };
  }
}

async function verifyTonViaTonApi(
  hash: string,
  args: { expectedAddress: string; minAmount: number },
): Promise<ChainVerifyResult | null> {
  type TonApiTx = {
    hash: string;
    success: boolean;
    in_msg?: {
      decoded_op_name?: string;
      decoded_body?: {
        amount?: string;
        sender?: string;
        destination?: string;
      };
      source?: { address?: string };
      destination?: { address?: string };
      value?: number;
    };
    out_msgs?: Array<{
      decoded_op_name?: string;
      decoded_body?: { amount?: string; destination?: string };
      destination?: { address?: string };
      value?: number;
    }>;
  };
  type JettonAction = {
    type: string;
    status: string;
    JettonTransfer?: {
      amount: string;
      sender: { address: string };
      recipient: { address: string };
      jetton: { address: string };
    };
  };
  type TonApiEventResp = {
    // `timestamp` is the event time in *seconds* since epoch — we
    // surface it to the freshness gate so a stale jetton transfer
    // can't be replayed against the 30-min window.
    timestamp?: number;
    actions?: JettonAction[];
  };

  // Try fetching the event (which has parsed jetton actions)
  const eventUrl = `https://tonapi.io/v2/events/${encodeURIComponent(hash)}`;
  const eventResp = await fetchJson<TonApiEventResp>(eventUrl, undefined, 12_000);
  const actions = eventResp.actions ?? [];
  for (const act of actions) {
    if (act.type !== 'JettonTransfer' || act.status !== 'ok') continue;
    const jt = act.JettonTransfer;
    if (!jt) continue;
    // Addresses on TON come in various forms — normalize by stripping
    // the workchain prefix and lower-casing for comparison.
    const normalizeAddr = (a: string) =>
      a.replace(/^0:|^-1:/, '').toLowerCase();
    if (normalizeAddr(jt.jetton.address) !== normalizeAddr(USDT_TON_MASTER)) {
      // Not USDT, check next action
      continue;
    }
    // Check recipient
    if (normalizeAddr(jt.recipient.address) !== normalizeAddr(args.expectedAddress)) {
      return { ok: false, reason: `recipient mismatch (paid to ${jt.recipient.address})` };
    }
    // USDT on TON has 6 decimals
    const amount = Number(jt.amount) / 1_000_000;
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, reason: 'could not decode amount' };
    }
    if (amount + 1e-9 < args.minAmount) {
      return { ok: false, reason: `amount ${amount.toFixed(2)} < min ${args.minAmount}` };
    }
    const paidAtMs =
      typeof eventResp.timestamp === 'number' && Number.isFinite(eventResp.timestamp)
        ? eventResp.timestamp * 1000
        : null;
    return {
      ok: true,
      amount: round2(amount),
      sender: jt.sender.address,
      confirmations: null,
      paidAtMs,
    };
  }

  // If we got a response but no matching actions, check the raw tx
  const txUrl = `https://tonapi.io/v2/blockchain/transactions/${encodeURIComponent(hash)}`;
  const tx = await fetchJson<TonApiTx>(txUrl, undefined, 12_000);
  if (!tx.success) return { ok: false, reason: 'TON tx failed (not successful)' };

  // Could not parse jetton info from raw tx — return null so caller
  // tries TonCenter as fallback.
  return null;
}

async function verifyTonViaTonCenter(
  hash: string,
  args: { expectedAddress: string; minAmount: number },
): Promise<ChainVerifyResult> {
  // TonCenter doesn't have a direct "get tx by hash" that returns jetton
  // data, so we fetch recent transactions on the expected address and look
  // for a matching tx hash.
  const headers: Record<string, string> = {};
  if (env.TONCENTER_API_KEY) headers['X-API-Key'] = env.TONCENTER_API_KEY;

  type TcTx = {
    transaction_id?: { hash?: string };
    in_msg?: {
      source?: string;
      destination?: string;
      value?: string;
      message?: string;
      msg_data?: { body?: string };
    };
  };
  const url = `${TONCENTER_BASE}/getTransactions?address=${encodeURIComponent(args.expectedAddress)}&limit=50`;
  const resp = await fetchJson<{ ok: boolean; result?: TcTx[] }>(
    url,
    { headers },
    15_000,
  );
  if (!resp.ok || !resp.result) {
    return { ok: false, reason: 'TonCenter returned no transactions' };
  }

  // Try to match by hash (TonCenter returns base64, user may supply hex)
  const normalizeHash = (h: string) => {
    if (/^[0-9a-fA-F]{64}$/.test(h)) return h.toLowerCase();
    try {
      return Buffer.from(h, 'base64').toString('hex').toLowerCase();
    } catch {
      return h.toLowerCase();
    }
  };
  const targetHex = normalizeHash(hash);

  for (const tx of resp.result) {
    const txHashHex = normalizeHash(tx.transaction_id?.hash ?? '');
    if (txHashHex !== targetHex) continue;
    // Found the matching tx. For jetton transfers the in_msg carries
    // the jetton notification. The amount in nano-jettons is in the
    // message body (opcode 0x7362d09c = transfer_notification).
    // Unfortunately TonCenter doesn't parse jetton opcodes, so we
    // can only confirm the tx exists. Amount verification relies on
    // the Ton API path above succeeding.
    return { ok: false, reason: 'tx found on TonCenter but jetton amount could not be parsed — admin should verify manually' };
  }

  return { ok: false, reason: 'tx not found on TON network' };
}

// =========================================================================
//  LTC (Litecoin native)
// =========================================================================

const BLOCKCYPHER_BASE = 'https://api.blockcypher.com/v1/ltc/main';

export async function verifyLtcTx(args: {
  txHash: string;
  expectedAddress: string;
  /** Expected LTC amount (from the quote). Tolerance ±2%. */
  expectedLtcAmount: number;
}): Promise<ChainVerifyResult> {
  const hash = args.txHash.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return { ok: false, reason: 'LTC tx hash must be 64 hex chars' };
  }

  let tokenParam = '';
  if (env.BLOCKCYPHER_TOKEN) tokenParam = `?token=${env.BLOCKCYPHER_TOKEN}`;

  type BcTx = {
    hash: string;
    confirmed?: string;
    confirmations: number;
    outputs: Array<{
      addresses?: string[];
      value: number; // satoshis
    }>;
    inputs: Array<{
      addresses?: string[];
    }>;
  };

  let tx: BcTx;
  try {
    tx = await fetchJson<BcTx>(
      `${BLOCKCYPHER_BASE}/txs/${hash}${tokenParam}`,
      undefined,
      15_000,
    );
  } catch (err) {
    return { ok: false, reason: `LTC lookup failed: ${stringifyErr(err)}` };
  }

  if (!tx || !tx.hash) return { ok: false, reason: 'tx not found on Litecoin network' };

  // Sum all outputs going to the expected address.
  const wantAddr = args.expectedAddress.toLowerCase();
  let totalSats = 0;
  for (const out of tx.outputs ?? []) {
    const addrs = (out.addresses ?? []).map((a) => a.toLowerCase());
    if (addrs.includes(wantAddr)) {
      totalSats += out.value;
    }
  }
  if (totalSats === 0) {
    return { ok: false, reason: 'no output to wallet address in tx' };
  }
  const ltcAmount = totalSats / 1e8;

  // Tolerance: ±2% of expected amount (accounts for network fee dust).
  const tolerance = args.expectedLtcAmount * 0.02;
  if (ltcAmount < args.expectedLtcAmount - tolerance) {
    return {
      ok: false,
      reason: `received ${round8(ltcAmount)} LTC but expected ${round8(args.expectedLtcAmount)} LTC (±2%)`,
    };
  }

  const sender =
    tx.inputs?.[0]?.addresses?.[0] ?? 'unknown';

  // BlockCypher returns `confirmed` as an ISO timestamp once the tx
  // is mined. While the tx is still unconfirmed in the mempool the
  // field is absent — we surface `null` and let the freshness gate
  // reject (mempool txs can be replaced and shouldn't auto-credit).
  let paidAtMs: number | null = null;
  if (typeof tx.confirmed === 'string' && tx.confirmed.length > 0) {
    const ms = Date.parse(tx.confirmed);
    if (Number.isFinite(ms)) paidAtMs = ms;
  }

  return {
    ok: true,
    amount: round8(ltcAmount),
    sender,
    confirmations: tx.confirmations ?? null,
    paidAtMs,
  };
}

// =========================================================================
//  LTC rate quote (CoinGecko)
// =========================================================================

let cachedLtcRate: { rate: number; fetchedAt: number } | null = null;
const LTC_RATE_TTL_MS = 60_000; // 1 min cache

/**
 * Fetch the current LTC → USD price from CoinGecko.
 * Returns e.g. 85.32 meaning 1 LTC = $85.32.
 */
export async function fetchLtcUsdRate(): Promise<number> {
  if (cachedLtcRate && Date.now() - cachedLtcRate.fetchedAt < LTC_RATE_TTL_MS) {
    return cachedLtcRate.rate;
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (env.COINGECKO_API_KEY) {
    headers['x-cg-demo-api-key'] = env.COINGECKO_API_KEY;
  }
  const json = await fetchJson<{ litecoin?: { usd?: number } }>(
    'https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd',
    { headers },
    10_000,
  );
  const rate = json.litecoin?.usd;
  if (!rate || !Number.isFinite(rate) || rate <= 0) {
    throw new Error('CoinGecko returned invalid LTC rate');
  }
  cachedLtcRate = { rate, fetchedAt: Date.now() };
  return rate;
}

/**
 * Given a USD amount, return the LTC amount the user must send and a
 * 10-minute expiry timestamp.
 */
export function quoteLtc(usdAmount: number, ltcUsdRate: number): {
  ltcAmount: number;
  expiresAt: Date;
} {
  const ltcAmount = round8(usdAmount / ltcUsdRate);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  return { ltcAmount, expiresAt };
}

// =========================================================================
//  Address validators (admin wizard)
// =========================================================================

export function isValidTronAddress(addr: string): boolean {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr);
}
export function isValidBscAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}
export function isValidTonAddress(addr: string): boolean {
  // EQ… / UQ… raw or user-friendly. Also 0:hex and -1:hex forms.
  return /^(EQ|UQ)[A-Za-z0-9_-]{46}$/.test(addr) || /^-?[01]:[0-9a-fA-F]{64}$/.test(addr);
}
export function isValidLtcAddress(addr: string): boolean {
  // P2PKH (L/M prefix), P2SH (3 prefix), or bech32 (ltc1…)
  return /^[LM3][1-9A-HJ-NP-Za-km-z]{26,34}$/.test(addr) || /^ltc1[a-z0-9]{25,60}$/.test(addr);
}
