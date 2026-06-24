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

import { readSetting, setSetting, deleteSetting } from '../db/queries.js';
import { logger } from '../logger.js';

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
  const raw = await readSetting(SETTINGS_KEY);
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!obj.api_key || !obj.api_url) return null;
  return {
    api_key: String(obj.api_key),
    api_url: String(obj.api_url),
    connected: Boolean(obj.connected),
    connected_at: String(obj.connected_at ?? ''),
  };
}

export async function saveConnection(api_key: string, api_url: string): Promise<void> {
  const conn: ApiConnection = {
    api_key,
    api_url,
    connected: true,
    connected_at: new Date().toISOString(),
  };
  await setSetting(SETTINGS_KEY, conn);
}

export async function deleteConnection(): Promise<void> {
  await deleteSetting(SETTINGS_KEY);
}

// ─────────────────────────────────────────────────────────────────
// HTTP helper
// ─────────────────────────────────────────────────────────────────

async function apiGet<T>(
  conn: ApiConnection,
  path: string,
): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
  const url = `${conn.api_url}${path}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${conn.api_key}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
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
): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number; raw?: Record<string, unknown> }> {
  const url = `${conn.api_url}${path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.api_key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json().catch(() => ({})) as Record<string, unknown>;
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
): Promise<{ ok: true; products: ApiProduct[] } | { ok: false; error: string }> {
  const res = await apiGet<{ success: boolean; products: any[] }>(conn, '/products');
  if (!res.ok) return { ok: false, error: res.error };
  
  const mapped: ApiProduct[] = (res.data.products ?? []).map((p: any) => {
    const yourPrice = p.your_price !== null && p.your_price !== undefined ? Number(p.your_price) : Number(p.store_price);
    const basePrice = Number(p.store_price);
    let stock = -1;
    if (p.stock !== 'unlimited' && p.stock !== null && p.stock !== undefined) {
      const parsedStock = Number(p.stock);
      if (Number.isFinite(parsedStock)) {
        stock = parsedStock;
      }
    }
    return {
      id: String(p.id),
      name_en: p.name_en || '',
      name_ar: p.name_ar || undefined,
      base_price: basePrice,
      your_price: yourPrice,
      stock,
      is_manual: Boolean(p.is_manual),
      emoji: p.emoji || undefined,
      emoji_id: p.custom_emoji_id || undefined,
      description: p.desc_en || p.description || undefined,
    };
  });
  return { ok: true, products: mapped };
}

/** Fetch a single product by ID. */
export async function fetchProduct(
  conn: ApiConnection,
  productId: string,
): Promise<{ ok: true; product: ApiProduct } | { ok: false; error: string }> {
  const res = await apiGet<{ success: boolean; product: any }>(conn, `/product/${productId}`);
  if (!res.ok) return { ok: false, error: res.error };
  const p = res.data.product;
  const yourPrice = p.your_price !== null && p.your_price !== undefined ? Number(p.your_price) : Number(p.store_price);
  const basePrice = Number(p.store_price);
  let stock = -1;
  if (p.stock !== 'unlimited' && p.stock !== null && p.stock !== undefined) {
    const parsedStock = Number(p.stock);
    if (Number.isFinite(parsedStock)) {
      stock = parsedStock;
    }
  }
  const mapped: ApiProduct = {
    id: String(p.id),
    name_en: p.name_en || '',
    name_ar: p.name_ar || undefined,
    base_price: basePrice,
    your_price: yourPrice,
    stock,
    is_manual: Boolean(p.is_manual),
    emoji: p.emoji || undefined,
    emoji_id: p.custom_emoji_id || undefined,
    description: p.desc_en || p.description || undefined,
  };
  return { ok: true, product: mapped };
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
): Promise<
  | { ok: true; data: ApiPurchaseResult }
  | { ok: false; error: string; status?: number; raw?: Record<string, unknown> }
> {
  const res = await apiPost<ApiPurchaseResult>(conn, '/purchase', {
    product_id: productId,
    qty,
    buyer_info: buyerInfo,
  });
  return res;
}

/** Fetch recent API orders. */
export async function fetchOrders(
  conn: ApiConnection,
  limit = 10,
): Promise<{ ok: true; orders: ApiOrder[] } | { ok: false; error: string }> {
  const res = await apiGet<{ success: boolean; orders: ApiOrder[] }>(conn, `/orders?limit=${limit}`);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, orders: res.data.orders ?? [] };
}

/** Fetch custom prices for this API key. */
export async function fetchMyPrices(
  conn: ApiConnection,
): Promise<{ ok: true; prices: ApiPriceEntry[] } | { ok: false; error: string }> {
  const res = await apiGet<{ success: boolean; prices: ApiPriceEntry[] }>(conn, '/my_prices');
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, prices: res.data.prices ?? [] };
}
