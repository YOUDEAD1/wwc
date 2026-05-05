/**
 * On-chain USDT verification helpers for TRC20 (TRON) and BEP20 (BSC).
 *
 * Both verifiers take a user-submitted transaction hash, look it up
 * on a public blockchain endpoint, and return either:
 *
 *   - { ok: true, amount, sender }   – tx confirmed, USDT contract
 *                                      matched, recipient matched
 *                                      the configured wallet, and we
 *                                      decoded the amount.
 *   - { ok: false, reason }          – something didn't match (we
 *                                      surface the reason verbatim
 *                                      to the admin log so it's
 *                                      easy to diagnose).
 *
 * The verifiers are intentionally network-only: no API keys, no SDKs.
 * That keeps Railway / Fly deploys zero-config.
 *
 *   * TRC20 → TronGrid public REST API.
 *   * BEP20 → publicly hosted BSC JSON-RPC endpoints (with failover).
 */
import crypto from 'node:crypto';
import { logger } from '../logger.js';

// USDT contract on TRON (TRC20).
export const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

// USDT contract on BSC (BEP20). 18 decimals (unlike Ethereum's 6).
export const USDT_BEP20_CONTRACT =
  '0x55d398326f99059fF775485246999027B3197955';

// keccak256("Transfer(address,address,uint256)") — the canonical ERC20
// Transfer event signature, identical on BSC and Ethereum.
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

/** Common shape returned by both chain verifiers. */
export type ChainVerifyResult =
  | {
      ok: true;
      /** USDT amount, in human units (e.g. 5.12). */
      amount: number;
      /** Sender wallet address (lowercase 0x… for BSC, base58 for TRON). */
      sender: string;
      /** Confirming block number / number of confirmations. */
      confirmations: number | null;
    }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------
//  TRC20 (TRON)
// ---------------------------------------------------------------------

/** Hex (uppercase, no 0x) → base58check TRON address (e.g. T…). */
function tronHexToBase58(hex: string): string {
  // Lazy hand-rolled base58check. We avoid pulling tronweb because it
  // ships with a giant dep tree just to format a 21-byte address.
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  // TRON addresses are 21 bytes (1 type byte + 20 byte hash). Some
  // contract logs encode them as a 32-byte left-padded EVM-style word —
  // tolerate both.
  const padded = clean.length === 64 ? clean.slice(24) : clean;
  const withPrefix = padded.length === 40 ? '41' + padded : padded;

  const bytes = Buffer.from(withPrefix, 'hex');
  // double-sha256 checksum
  const hash = (b: Buffer): Buffer =>
    crypto.createHash('sha256').update(b).digest();
  const checksum = hash(hash(bytes)).subarray(0, 4);
  const full = Buffer.concat([bytes, checksum]);

  // base58 alphabet (Bitcoin)
  const alphabet =
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + full.toString('hex'));
  let out = '';
  while (n > 0n) {
    const r = Number(n % 58n);
    n = n / 58n;
    out = alphabet[r] + out;
  }
  // Preserve leading-zero bytes as leading "1"s.
  for (const b of full) {
    if (b === 0) out = '1' + out;
    else break;
  }
  return out;
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = 10_000,
): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Look up a TRON transaction by id and verify it was a USDT TRC20
 * transfer to `expectedAddress` (base58). Tries each TronGrid base
 * URL until one returns a usable response.
 */
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
      const info = await fetchJson<{
        id?: string;
        blockNumber?: number;
        receipt?: { result?: string };
        log?: Array<{
          address?: string;
          topics?: string[];
          data?: string;
        }>;
      }>(`${base}/wallet/gettransactioninfobyid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: txid }),
      });

      if (!info || !info.id) {
        return { ok: false, reason: 'tx not found on TRON network' };
      }
      if (info.receipt?.result && info.receipt.result !== 'SUCCESS') {
        return { ok: false, reason: `tx status: ${info.receipt.result}` };
      }
      const logs = info.log ?? [];
      // Find the Transfer event from the USDT contract.
      const usdtHexAddress = '41' + base58ToHex(USDT_TRC20_CONTRACT).slice(2); // 41 prefix
      let match: { from: string; to: string; value: bigint } | null = null;
      for (const ev of logs) {
        if (!ev.address || !ev.topics || ev.topics.length < 3) continue;
        // TronGrid returns log addresses without the `41` prefix.
        const addr = ev.address.toLowerCase();
        const expected = usdtHexAddress.slice(2).toLowerCase();
        if (addr !== expected) continue;
        const topic0 = (ev.topics[0] || '').toLowerCase();
        if (
          topic0 !==
          ERC20_TRANSFER_TOPIC.slice(2).toLowerCase()
        ) {
          continue;
        }
        const fromHex = (ev.topics[1] || '').toLowerCase();
        const toHex = (ev.topics[2] || '').toLowerCase();
        const valueHex = (ev.data || '0').toLowerCase();
        match = {
          from: tronHexToBase58(fromHex),
          to: tronHexToBase58(toHex),
          value: BigInt('0x' + (valueHex || '0')),
        };
        break;
      }
      if (!match) {
        return { ok: false, reason: 'no USDT Transfer event in tx' };
      }
      if (match.to.toLowerCase() !== args.expectedAddress.toLowerCase()) {
        return {
          ok: false,
          reason: `recipient mismatch (paid to ${match.to})`,
        };
      }
      // USDT TRC20 has 6 decimals.
      const amount = Number(match.value) / 1_000_000;
      if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, reason: 'could not decode amount' };
      }
      if (amount + 1e-9 < args.minAmount) {
        return {
          ok: false,
          reason: `amount ${amount.toFixed(2)} < min ${args.minAmount}`,
        };
      }
      return {
        ok: true,
        amount: round2(amount),
        sender: match.from,
        confirmations: info.blockNumber ?? null,
      };
    } catch (err) {
      lastErr = err;
      logger.warn({ err, base }, 'TRC20 verify: base failed, trying next');
    }
  }
  return {
    ok: false,
    reason: `TRC20 lookup failed: ${stringifyErr(lastErr)}`,
  };
}

// base58check → hex (with 41 prefix). Used to compute the expected
// USDT contract log address.
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
  // Strip the 4-byte checksum at the tail.
  hex = hex.slice(0, -8);
  return '0x' + hex;
}

// ---------------------------------------------------------------------
//  BEP20 (Binance Smart Chain)
// ---------------------------------------------------------------------

type BscReceipt = {
  status: string; // "0x1" success, "0x0" failure
  blockNumber: string;
  from: string;
  to: string;
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
  }>;
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
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method,
            params,
          }),
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

/**
 * Look up a BSC transaction by hash and verify it was a USDT BEP20
 * transfer to `expectedAddress` (lowercase 0x).
 */
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
  if (!receipt) {
    return { ok: false, reason: 'tx not found on BSC' };
  }
  if (receipt.status !== '0x1') {
    return { ok: false, reason: 'tx reverted (status 0x0)' };
  }
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
  // BEP20 USDT has 18 decimals.
  const amount = Number(totalRaw) / 1e18;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: 'could not decode amount' };
  }
  if (amount + 1e-9 < args.minAmount) {
    return {
      ok: false,
      reason: `amount ${amount.toFixed(2)} < min ${args.minAmount}`,
    };
  }
  return {
    ok: true,
    amount: round2(amount),
    sender,
    confirmations: parseInt(receipt.blockNumber, 16) || null,
  };
}

// ---------------------------------------------------------------------
//  Address validators (lightweight, used by the admin wizard)
// ---------------------------------------------------------------------

export function isValidTronAddress(addr: string): boolean {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr);
}

export function isValidBscAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

// ---------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return JSON.stringify(err);
}
