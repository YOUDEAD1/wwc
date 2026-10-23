/**
 * External API connection service.
 *
 * Decodes `conn_<base64>` connection codes, stores credentials in
 * the Supabase `settings` table, and provides typed wrappers for
 * every external API endpoint (products, balance, purchase, orders,
 * my_prices).
 *
 * The connection code encodes:
 *   { "k": "<api_key>", "u": "<full_api_url>" }
 *
 * All outbound HTTP requests use Node 20's built-in `fetch` with a
 * 10-second timeout and structured error handling.
 */

import { createHash, randomUUID } from 'node:crypto';
import { deleteSetting, readSetting, setSetting } from '../db/queries.js';
import { logger } from '../logger.js';
import { del, remember } from './cache.js';
import { measuredFetch } from './networkMeter.js';
import { freeShop, managedShop, requirePaidCapability } from '../platform/policy.js';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type ApiConnection = {
  api_key: string;
  api_url: string;
  connected: boolean;
  connected_at: string;
};

export type ApiProduct = {
  id: string;
  name_en: string;
  name_ar?: string;
  base_price: number;
  your_price: number;
  stock: number | 'unlimited';
  is_manual: boolean;
  emoji?: string;
  emoji_id?: string;
  description?: string;
};

export type ApiPurchaseResult = {
  success: true;
  codes: string[];
  total_price: number;
  new_balance: number;
  order_id: string;
  status: string;
};

export type ApiOrder = {
  order_id: string;
  product_id: string;
  product_name?: string;
  qty: number;
  total_price: number;
  status: string;
  buyer_info?: string;
  created_at?: string;
  codes?: string[];
};

export type ApiPriceEntry = {
  product_id: string;
  product_name?: string;
  base_price: number;
  your_price: number;
};

// ─────────────────────────────────────────────────────────────────
// Settings key
// ─────────────────────────────────────────────────────────────────

const SETTINGS_KEY = 'api_connection';

// ─────────────────────────────────────────────────────────────────
// Connection code decode / encode
// ─────────────────────────────────────────────────────────────────

/**
 * Decode a `conn_<base64>` connection code into api_key + api_url.
 * Throws a human-readable error when the code is malformed.
 */
export function decodeConnectionCode(code: string): { api_key: string; api_url: string } {
  const trimmed = code.trim();
  if (!trimmed.startsWith('conn_')) {
    throw new Error('Invalid code format — must start with conn_');
  }
  const b64 = trimmed.slice(5); // strip "conn_"
  let json: string;
  try {
    json = Buffer.from(b64, 'base64').toString('utf-8');
  } catch {
    throw new Error('Invalid base64 in connection code');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON inside connection code');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.k !== 'string' || !obj.k) {
    throw new Error('Missing API key (k) in connection code');
  }
  if (typeof obj.u !== 'string' || !obj.u) {
    throw new Error('Missing API URL (u) in connection code');
  }
  return { api_key: obj.k, api_url: obj.u };
}

// ─────────────────────────────────────────────────────────────────
// Storage (Supabase settings table)
// ─────────────────────────────────────────────────────────────────

export async function getConnection(): Promise<ApiConnection | null> {
  const pinned =
    managedShop() && process.env.TENANT_SOURCE_KEY && process.env.TENANT_SOURCE_URL
      ? {
          api_key: process.env.TENANT_SOURCE_KEY,
          api_url: process.env.TENANT_SOURCE_URL,
          connected: true,
          connected_at: '',
        }
      : null;
  if (freeShop() && pinned) return pinned;
  return remember('api-connection', 60000, async () => {
    const raw = await readSetting(SETTINGS_KEY);
    if (!raw || typeof raw !== 'object') return pinned;
    const obj = raw as Record<string, unknown>;
    if (!obj.api_key || !obj.api_url) return null;
    return {
      api_key: String(obj.api_key),
      api_url: String(obj.api_url),
      connected: Boolean(obj.connected),
      connected_at: String(obj.connected_at ?? ''),
    };
  });
}

export async function saveConnection(api_key: string, api_url: string): Promise<void> {
  requirePaidCapability();
  const conn: ApiConnection = {
    api_key,
    api_url,
    connected: true,
    connected_at: new Date().toISOString(),
  };
  await setSetting(SETTINGS_KEY, conn);
  del('api-connection');
}

export async function deleteConnection(): Promise<void> {
  requirePaidCapability();
  await deleteSetting(SETTINGS_KEY);
  del('api-connection');
}

// ─────────────────────────────────────────────────────────────────
// HTTP helper
// ─────────────────────────────────────────────────────────────────

async function apiGet<T>(
  conn: ApiConnection,
  path: string,
): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
  const url = `${conn.api_url}${path}`;
  const ck =
    'http-get:' +
    createHash('sha256')
      .update(url + '\0' + conn.api_key)
      .digest('hex');
  const saved = httpRepresentations.get(ck);
  try {
    const res = await measuredFetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${conn.api_key}`,
        Accept: 'application/json',
        ...(saved?.etag ? { 'If-None-Match': saved.etag } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 304 && saved) return { ok: true, data: structuredClone(saved.body) as T };
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && res.headers.get('etag')) {
      if (httpRepresentations.size >= 128)
        httpRepresentations.delete(httpRepresentations.keys().next().value!);
      httpRepresentations.set(ck, { etag: res.headers.get('etag')!, body });
    }
    if (!res.ok) {
      return {
        ok: false,
        error: String(body.error ?? body.message ?? `HTTP ${res.status}`),
        status: res.status,
      };
    }
    return { ok: true, data: body as T };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, url }, 'apiConnect GET failed');
    return { ok: false, error: msg };
  }
}

async function apiPost<T>(
  conn: ApiConnection,
  path: string,
  body: Record<string, unknown>,
): Promise<
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number; raw?: Record<string, unknown> }
> {
  const url = `${conn.api_url}${path}`;
  try {
    const res = await measuredFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.api_key}`,
        'Content-Type': 'application/json',
        ...(typeof body.idempotency_key === 'string'
          ? { 'Idempotency-Key': body.idempotency_key }
          : {}),
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || json.error) {
      return {
        ok: false,
        error: String(json.error ?? json.message ?? `HTTP ${res.status}`),
        status: res.status,
        raw: json,
      };
    }
    return { ok: true, data: json as T };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, url }, 'apiConnect POST failed');
    return { ok: false, error: msg };
  }
}

// ─────────────────────────────────────────────────────────────────
// Public API wrappers
// ─────────────────────────────────────────────────────────────────

/** Test the connection by fetching products. Returns product count on success. */
export async function testConnection(
  api_key: string,
  api_url: string,
): Promise<{ ok: true; productCount: number } | { ok: false; error: string }> {
  const conn: ApiConnection = { api_key, api_url, connected: true, connected_at: '' };
  const res = await apiGet<{ success: boolean; products: unknown[] }>(conn, '/products');
  if (!res.ok) return { ok: false, error: res.error };
  const products = (res.data as Record<string, unknown>).products;
  const count = Array.isArray(products) ? products.length : 0;
  return { ok: true, productCount: count };
}

/** Fetch all visible products. */
export async function fetchProducts(
  conn: ApiConnection,
): Promise<{ ok: true; products: ApiProduct[]; complete: boolean } | { ok: false; error: string }> {
  const identity = createHash('sha256')
    .update(conn.api_url + '\0' + conn.api_key)
    .digest('hex');
  return remember('upstream-catalog:' + identity, 45000, async () => {
    const products: ApiProduct[] = [];
    const ids = new Set<string>();
    let offset = 0;
    for (let page = 0; page < 2000; page++) {
      const res = await apiGet<any>(conn, '/products?limit=500&offset=' + offset + '&compact=1');
      if (!res.ok) throw new Error(res.error);
      if (!Array.isArray(res.data.products)) throw new Error('Invalid catalog response');
      const rows = res.data.products;
      if (!rows.length) return { ok: true as const, products, complete: true };
      let added = 0;
      for (const raw of rows) {
        const p = normalizeApiProduct(raw);
        if (ids.has(p.id)) continue;
        ids.add(p.id);
        products.push(p);
        added++;
      }
      if (!added) return { ok: true as const, products, complete: false };
      offset += rows.length;
      // A total equal to a full page is ambiguous in old servers; probe the next page.
      const total = Number(res.data.total);
      if (Number.isFinite(total) && total > rows.length && offset >= total)
        return { ok: true as const, products, complete: true };
    }
    return { ok: true as const, products, complete: false };
  }).catch((err) => ({
    ok: false as const,
    error: err instanceof Error ? err.message : String(err),
  }));
}

/** Fetch a single product by ID. */
export async function fetchProduct(
  conn: ApiConnection,
  productId: string,
): Promise<{ ok: true; product: ApiProduct } | { ok: false; error: string }> {
  const res = await apiGet<any>(conn, '/product/' + encodeURIComponent(productId));
  if (!res.ok) return res;
  if (!res.data.product) return { ok: false, error: 'Invalid product response' };
  return { ok: true, product: normalizeApiProduct(res.data.product) };
}

/** Fetch current API key balance. */
export async function fetchBalance(
  conn: ApiConnection,
): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  const res = await apiGet<{ success: boolean; balance: number }>(conn, '/balance');
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, balance: Number(res.data.balance ?? 0) };
}

/** Purchase a product via the external API. */
export async function purchase(
  conn: ApiConnection,
  productId: string,
  qty: number,
  buyerInfo: string,
  requestId: string = randomUUID(),
): Promise<
  | { ok: true; data: ApiPurchaseResult }
  | { ok: false; error: string; status?: number; raw?: Record<string, unknown> }
> {
  const res = await apiPost<ApiPurchaseResult>(conn, '/purchase', {
    product_id: productId,
    qty,
    buyer_info: buyerInfo,
    request_id: requestId,
    idempotency_key: requestId,
  });
  if (!res.ok) return res;
  const data = res.data as any;
  return {
    ok: true,
    data: {
      ...data,
      success: true,
      codes: data.codes ?? data.items ?? [],
      total_price: Number(data.total_price ?? data.total ?? 0),
      new_balance: Number(data.new_balance ?? data.balance_after ?? data.balance ?? 0),
      order_id: String(data.order_id ?? ''),
      status: data.status ?? 'paid',
    },
  };
}

/** Fetch recent API orders. */
export async function fetchOrders(
  conn: ApiConnection,
  limit = 10,
): Promise<{ ok: true; orders: ApiOrder[] } | { ok: false; error: string }> {
  const res = await apiGet<{ success: boolean; orders: ApiOrder[] }>(
    conn,
    `/orders?limit=${limit}`,
  );
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, orders: res.data.orders ?? [] };
}

/** Fetch custom prices for this API key. */
export async function fetchMyPrices(
  conn: ApiConnection,
): Promise<{ ok: true; prices: ApiPriceEntry[] } | { ok: false; error: string }> {
  const res = await apiGet<{ success: boolean; prices: ApiPriceEntry[] }>(conn, '/my_prices');
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, prices: res.data.prices ?? (res.data as any).custom_products ?? [] };
}

function normalizeApiProduct(p: any): ApiProduct {
  const base = Number(p.store_price ?? p.base_price ?? p.price ?? 0),
    your = Number(p.your_price ?? base);
  if (
    p.id === undefined ||
    !Number.isFinite(base) ||
    !Number.isFinite(your) ||
    base < 0 ||
    your < 0
  )
    throw new Error('Invalid product data');
  return {
    id: String(p.id),
    name_en: String(p.name_en ?? p.name ?? ''),
    name_ar: p.name_ar,
    base_price: base,
    your_price: your,
    stock:
      p.stock === 'unlimited' || p.stock === null || Number(p.stock) < 0
        ? 'unlimited'
        : Math.max(0, Number(p.stock ?? 0)),
    is_manual: Boolean(p.is_manual),
    emoji: p.emoji,
    emoji_id: p.custom_emoji_id ?? p.emoji_id,
    description: p.desc_en ?? p.description,
  };
}

const httpRepresentations = new Map<string, { etag: string; body: unknown }>();

export async function recoverPurchase(
  conn: ApiConnection,
  requestId: string,
): Promise<ApiPurchaseResult | null> {
  return remember(
    'nss-recovery:' +
      createHash('sha256')
        .update(conn.api_url + '\0' + conn.api_key + '\0' + requestId)
        .digest('hex'),
    60000,
    async () => {
      const res = await apiGet<{ status: string; code: number; data?: ApiPurchaseResult }>(
        conn,
        '/platform_request/' + encodeURIComponent(requestId),
      );
      return res.ok &&
        res.data.status === 'done' &&
        res.data.code === 200 &&
        Array.isArray(res.data.data?.codes)
        ? res.data.data!
        : null;
    },
  );
}
