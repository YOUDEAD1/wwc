import {
  getProduct,
  getSupplierApiSource,
  getSupplierProductLinkByProduct,
  recordSupplierOrderLog,
  updateProduct,
  updateSupplierApiSource,
  updateSupplierProductLink,
} from '../db/queries.js';
import { logger } from '../logger.js';
import type {
  DBSupplierApiSource,
  DBSupplierProductLink,
  SupplierAuthMode,
  SupplierOrderMethod,
} from '../types.js';

const DEFAULT_TIMEOUT_MS = 20_000;

export type SupplierCatalogProduct = {
  id: string;
  name: string;
  price: number | null;
  stock: number | null;
  raw: Record<string, unknown>;
};

export type SupplierConnectionTest = {
  ok: boolean;
  balance: number | null;
  productsSeen: number;
  sampleProducts: SupplierCatalogProduct[];
  error: string | null;
};

export type SupplierOrderResult = {
  ok: boolean;
  items: string[];
  status: string | null;
  raw: Record<string, unknown>;
};

export type SupplierSourceConfig = {
  name: string;
  base_url: string;
  api_key?: string;
  auth_mode?: SupplierAuthMode;
  key_header?: string;
  key_query_param?: string;
  products_path?: string;
  balance_path?: string;
  order_path?: string;
  order_method?: SupplierOrderMethod;
  balance_json_path?: string;
  products_json_path?: string;
  product_id_json_path?: string;
  product_name_json_path?: string;
  product_price_json_path?: string;
  product_stock_json_path?: string;
  order_items_json_path?: string;
  order_status_json_path?: string;
  order_request_template?: Record<string, unknown>;
  markup_percent?: number;
  fixed_markup?: number;
  low_balance_threshold?: number;
  notes?: string | null;
};

export type SupplierLinkConfig = {
  local_product_id: number;
  supplier_id: number;
  supplier_product_id: string;
  supplier_product_name?: string | null;
  supplier_cost?: number | null;
  supplier_stock?: number | null;
  auto_order?: boolean;
  auto_sync_stock?: boolean;
  fallback_manual?: boolean;
};

export class SupplierApiError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,\s]/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asBoolean(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    if (/^(true|yes|on|1)$/i.test(v.trim())) return true;
    if (/^(false|no|off|0)$/i.test(v.trim())) return false;
  }
  return fallback;
}

function cleanPath(path: string | null | undefined, fallback: string): string {
  const s = (path ?? '').trim();
  return s.length > 0 ? s : fallback;
}

function joinUrl(base: string, path: string): URL {
  const cleanBase = base.trim().replace(/\/+$/, '');
  const cleanSuffix = path.trim().replace(/^\/+/, '');
  return new URL(cleanSuffix ? `${cleanBase}/${cleanSuffix}` : cleanBase);
}

function deepGet(obj: unknown, path: string | null | undefined): unknown {
  const clean = (path ?? '').trim();
  if (!clean || clean === '$' || clean === '.') return obj;
  const parts = clean
    .replace(/^\$\.?/, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean);
  let cur: unknown = obj;
  for (const part of parts) {
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined;
      cur = cur[idx];
      continue;
    }
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function firstValue(obj: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const value = deepGet(obj, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function replaceTemplate(value: unknown, vars: Record<string, string | number>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) =>
      String(vars[key] ?? ''),
    );
  }
  if (Array.isArray(value)) return value.map((item) => replaceTemplate(item, vars));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = replaceTemplate(val, vars);
    }
    return out;
  }
  return value;
}

function authHeaders(source: DBSupplierApiSource): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  const key = source.api_key.trim();
  if (!key) return headers;
  if (source.auth_mode === 'bearer') headers.authorization = `Bearer ${key}`;
  if (source.auth_mode === 'x-api-key') headers[source.key_header || 'x-api-key'] = key;
  return headers;
}

async function supplierFetch(
  source: DBSupplierApiSource,
  path: string,
  method: SupplierOrderMethod = 'GET',
  payload?: Record<string, unknown>,
): Promise<unknown> {
  const url = joinUrl(source.base_url, path);
  if (source.auth_mode === 'query' && source.api_key.trim()) {
    url.searchParams.set(source.key_query_param || 'api_key', source.api_key.trim());
  }
  if (method === 'GET' && payload) {
    for (const [key, val] of Object.entries(payload)) {
      if (val !== undefined && val !== null) url.searchParams.set(key, String(val));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: authHeaders(source),
      body: method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
      signal: controller.signal,
    });
    const bodyText = await res.text();
    let json: unknown = {};
    try {
      json = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      json = { raw: bodyText.slice(0, 1000) };
    }
    if (!res.ok) {
      const sample = bodyText.replace(/\s+/g, ' ').slice(0, 300);
      throw new SupplierApiError(`HTTP ${res.status} from ${url.hostname}: ${sample || res.statusText}`);
    }
    return json;
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      throw new SupplierApiError(`Timeout after ${Math.round(DEFAULT_TIMEOUT_MS / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeCatalogProduct(
  source: DBSupplierApiSource,
  raw: unknown,
): SupplierCatalogProduct | null {
  const row = asRecord(raw);
  const id = asString(
    firstValue(row, [
      source.product_id_json_path,
      'product_id',
      'id',
      'pid',
      'service_id',
      'sku',
    ]),
  );
  if (!id) return null;
  const name =
    asString(
      firstValue(row, [
        source.product_name_json_path,
        'product_name',
        'name',
        'title',
        'service',
      ]),
    ) ?? id;
  const price = asNumber(
    firstValue(row, [source.product_price_json_path, 'price', 'cost', 'rate', 'amount']),
  );
  const stock = asNumber(
    firstValue(row, [
      source.product_stock_json_path,
      'stock',
      'quantity',
      'qty',
      'available',
      'count',
    ]),
  );
  return {
    id,
    name,
    price,
    stock: stock === null ? null : Math.max(0, Math.floor(stock)),
    raw: row,
  };
}

export async function fetchSupplierBalance(
  source: DBSupplierApiSource,
): Promise<number | null> {
  const json = await supplierFetch(source, cleanPath(source.balance_path, '/balance'));
  return asNumber(
    firstValue(json, [
      source.balance_json_path,
      'balance',
      'api_balance',
      'wallet.balance',
      'data.balance',
      'data.api_balance',
    ]),
  );
}

export async function fetchSupplierProducts(
  source: DBSupplierApiSource,
): Promise<SupplierCatalogProduct[]> {
  const json = await supplierFetch(source, cleanPath(source.products_path, '/products'));
  const rawProducts =
    deepGet(json, source.products_json_path) ??
    deepGet(json, 'products') ??
    deepGet(json, 'data.products') ??
    deepGet(json, 'data') ??
    json;
  const arr = Array.isArray(rawProducts) ? rawProducts : [];
  return arr
    .map((p) => normalizeCatalogProduct(source, p))
    .filter((p): p is SupplierCatalogProduct => p !== null);
}

export async function testSupplierConnection(
  source: DBSupplierApiSource,
): Promise<SupplierConnectionTest> {
  const balanceResult = await fetchSupplierBalance(source).then(
    (balance) => ({ ok: true as const, balance }),
    (err: unknown) => ({ ok: false as const, error: err }),
  );
  const productsResult = await fetchSupplierProducts(source).then(
    (products) => ({ ok: true as const, products }),
    (err: unknown) => ({ ok: false as const, error: err }),
  );
  const errors: string[] = [];
  if (!balanceResult.ok) errors.push(`balance: ${errorMessage(balanceResult.error)}`);
  if (!productsResult.ok) errors.push(`products: ${errorMessage(productsResult.error)}`);
  const products = productsResult.ok ? productsResult.products : [];
  const balance = balanceResult.ok ? balanceResult.balance : null;
  const out: SupplierConnectionTest = {
    ok: errors.length === 0,
    balance,
    productsSeen: products.length,
    sampleProducts: products.slice(0, 5),
    error: errors.length > 0 ? errors.join(' | ') : null,
  };
  await updateSupplierApiSource(source.id, {
    last_balance: balance,
    last_sync_at: new Date().toISOString(),
    last_error: out.error,
  });
  return out;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizeItems(source: DBSupplierApiSource, json: Record<string, unknown>): string[] {
  const raw =
    deepGet(json, source.order_items_json_path) ??
    deepGet(json, 'items') ??
    deepGet(json, 'data.items') ??
    deepGet(json, 'delivery') ??
    deepGet(json, 'data.delivery') ??
    deepGet(json, 'code') ??
    deepGet(json, 'account');
  if (typeof raw === 'string') return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return arr
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      const row = asRecord(item);
      const direct = asString(
        firstValue(row, ['payload', 'item', 'code', 'link', 'account', 'email', 'login']),
      );
      if (direct) return direct;
      const pairs = Object.entries(row)
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([key, value]) => `${key}: ${String(value)}`);
      return pairs.join('\n');
    })
    .filter((s) => s.length > 0);
}

export async function placeSupplierOrder(args: {
  source: DBSupplierApiSource;
  link: DBSupplierProductLink;
  qty: number;
  localOrderId: number;
  requestId?: string;
}): Promise<SupplierOrderResult> {
  const requestId = args.requestId ?? `ord_${args.localOrderId}_${Date.now()}`;
  const vars = {
    supplier_product_id: args.link.supplier_product_id,
    local_product_id: args.link.local_product_id,
    qty: args.qty,
    quantity: args.qty,
    order_id: args.localOrderId,
    request_id: requestId,
  };
  const payload = asRecord(replaceTemplate(args.source.order_request_template, vars));
  try {
    const rawJson = await supplierFetch(
      args.source,
      cleanPath(args.source.order_path, '/order'),
      args.source.order_method,
      payload,
    );
    const json = asRecord(rawJson);
    const statusValue =
      firstValue(json, [
        args.source.order_status_json_path,
        'status',
        'data.status',
        'success',
        'ok',
      ]);
    const status =
      asString(
        statusValue,
      ) ?? null;
    const failed =
      statusValue === false ||
      statusValue === 0 ||
      (status ? /^(false|0)$|fail|error|reject|cancel/i.test(status) : false);
    const items = normalizeItems(args.source, json);
    await recordSupplierOrderLog({
      supplier_id: args.source.id,
      local_order_id: args.localOrderId,
      local_product_id: args.link.local_product_id,
      supplier_product_id: args.link.supplier_product_id,
      status: failed ? 'failed' : 'success',
      request_payload: payload,
      response_payload: Array.isArray(rawJson) ? { data: rawJson } : json,
      error: failed ? `Supplier status: ${status}` : null,
    });
    return { ok: !failed, items, status, raw: Array.isArray(rawJson) ? { data: rawJson } : json };
  } catch (err) {
    const msg = errorMessage(err);
    await recordSupplierOrderLog({
      supplier_id: args.source.id,
      local_order_id: args.localOrderId,
      local_product_id: args.link.local_product_id,
      supplier_product_id: args.link.supplier_product_id,
      status: 'failed',
      request_payload: payload,
      response_payload: {},
      error: msg,
    }).catch((logErr) => logger.warn({ err: logErr }, 'supplier order failure log failed'));
    throw err;
  }
}

export async function trySupplierAutoOrder(args: {
  localProductId: number;
  qty: number;
  localOrderId: number;
}): Promise<{ items: string[]; status: string | null; supplierName: string } | null> {
  const link = await getSupplierProductLinkByProduct(args.localProductId).catch((err) => {
    if (isSupplierMigrationError(err)) {
      logger.debug('supplier tables not migrated; normal checkout fallback remains active');
      return null;
    }
    logger.warn({ err, localProductId: args.localProductId }, 'supplier link lookup failed');
    return null;
  });
  if (!link || !link.auto_order) return null;
  const source = await getSupplierApiSource(link.supplier_id);
  if (!source || !source.enabled) return null;
  try {
    const result = await placeSupplierOrder({
      source,
      link,
      qty: args.qty,
      localOrderId: args.localOrderId,
    });
    if (!result.ok) return null;
    return { items: result.items, status: result.status, supplierName: source.name };
  } catch (err) {
    logger.warn(
      { err, localProductId: args.localProductId, orderId: args.localOrderId, supplierId: source.id },
      'supplier auto-order failed; falling back to local/manual delivery',
    );
    await updateSupplierProductLink(link.id, {
      last_error: errorMessage(err),
    }).catch((updateErr) => logger.warn({ err: updateErr }, 'supplier link error update failed'));
    return null;
  }
}

export async function syncSupplierProductLink(link: DBSupplierProductLink): Promise<{
  matched: SupplierCatalogProduct | null;
  updatedLocal: boolean;
}> {
  const source = await getSupplierApiSource(link.supplier_id);
  if (!source) throw new SupplierApiError('Supplier not found.');
  const products = await fetchSupplierProducts(source);
  const matched = products.find((p) => p.id === link.supplier_product_id) ?? null;
  if (!matched) {
    await updateSupplierProductLink(link.id, {
      last_error: 'Supplier product id not found in catalog.',
    });
    return { matched: null, updatedLocal: false };
  }
  await updateSupplierProductLink(link.id, {
    supplier_product_name: matched.name,
    supplier_cost: matched.price,
    supplier_stock: matched.stock,
    last_sync_at: new Date().toISOString(),
    last_error: null,
  });
  let updatedLocal = false;
  const local = await getProduct(link.local_product_id);
  if (local && link.auto_sync_stock && matched.stock !== null) {
    const patch: { stock?: number; price?: number } = { stock: matched.stock };
    if (matched.price !== null) {
      patch.price = Number(
        (matched.price * (1 + Number(source.markup_percent) / 100) + Number(source.fixed_markup)).toFixed(3),
      );
    }
    await updateProduct(link.local_product_id, patch);
    updatedLocal = true;
  }
  return { matched, updatedLocal };
}

export function isSupplierMigrationError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  const body = [e?.code, e?.message, e?.details, e?.hint].map(String).join(' ');
  return (
    body.includes('42P01') ||
    body.includes('42703') ||
    /supplier_(api_sources|product_links|order_logs)/i.test(body) ||
    /relation .* does not exist/i.test(body) ||
    /schema cache/i.test(body)
  );
}

export function parseSupplierSourceConfig(text: string): SupplierSourceConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SupplierApiError('Send valid JSON. Use double quotes around keys and strings.');
  }
  const cfg = asRecord(raw);
  const name = asString(cfg.name);
  const baseUrl = asString(cfg.base_url ?? cfg.baseUrl ?? cfg.endpoint);
  if (!name) throw new SupplierApiError('Missing `name`.');
  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    throw new SupplierApiError('Missing `base_url` starting with http:// or https://.');
  }
  const authMode = asString(cfg.auth_mode ?? cfg.authMode) ?? 'x-api-key';
  if (!['none', 'bearer', 'x-api-key', 'query'].includes(authMode)) {
    throw new SupplierApiError('`auth_mode` must be one of: none, bearer, x-api-key, query.');
  }
  const orderMethod = (asString(cfg.order_method ?? cfg.orderMethod) ?? 'POST').toUpperCase();
  if (orderMethod !== 'GET' && orderMethod !== 'POST') {
    throw new SupplierApiError('`order_method` must be GET or POST.');
  }
  return {
    name,
    base_url: baseUrl,
    api_key: asString(cfg.api_key ?? cfg.apiKey ?? cfg.key) ?? '',
    auth_mode: authMode as SupplierAuthMode,
    key_header: asString(cfg.key_header ?? cfg.keyHeader) ?? 'x-api-key',
    key_query_param: asString(cfg.key_query_param ?? cfg.keyQueryParam) ?? 'api_key',
    products_path: asString(cfg.products_path ?? cfg.productsPath) ?? '/products',
    balance_path: asString(cfg.balance_path ?? cfg.balancePath) ?? '/balance',
    order_path: asString(cfg.order_path ?? cfg.orderPath) ?? '/order',
    order_method: orderMethod as SupplierOrderMethod,
    balance_json_path: asString(cfg.balance_json_path ?? cfg.balanceJsonPath) ?? 'balance',
    products_json_path: asString(cfg.products_json_path ?? cfg.productsJsonPath) ?? 'products',
    product_id_json_path: asString(cfg.product_id_json_path ?? cfg.productIdJsonPath) ?? 'id',
    product_name_json_path: asString(cfg.product_name_json_path ?? cfg.productNameJsonPath) ?? 'name',
    product_price_json_path: asString(cfg.product_price_json_path ?? cfg.productPriceJsonPath) ?? 'price',
    product_stock_json_path: asString(cfg.product_stock_json_path ?? cfg.productStockJsonPath) ?? 'stock',
    order_items_json_path: asString(cfg.order_items_json_path ?? cfg.orderItemsJsonPath) ?? 'items',
    order_status_json_path: asString(cfg.order_status_json_path ?? cfg.orderStatusJsonPath) ?? 'status',
    order_request_template: asRecord(
      cfg.order_request_template ??
        cfg.orderRequestTemplate ?? {
          product_id: '{{supplier_product_id}}',
          quantity: '{{qty}}',
          request_id: '{{request_id}}',
        },
    ),
    markup_percent: asNumber(cfg.markup_percent ?? cfg.markupPercent) ?? 25,
    fixed_markup: asNumber(cfg.fixed_markup ?? cfg.fixedMarkup) ?? 0,
    low_balance_threshold: asNumber(cfg.low_balance_threshold ?? cfg.lowBalanceThreshold) ?? 5,
    notes: asString(cfg.notes),
  };
}

export function parseSupplierLinkConfig(
  text: string,
  fallbackSupplierId?: number,
): SupplierLinkConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SupplierApiError('Send valid JSON. Use double quotes around keys and strings.');
  }
  const cfg = asRecord(raw);
  const localProductId = asNumber(cfg.local_product_id ?? cfg.localProductId ?? cfg.product_id);
  const supplierId = asNumber(cfg.supplier_id ?? cfg.supplierId) ?? fallbackSupplierId ?? null;
  const supplierProductId = asString(cfg.supplier_product_id ?? cfg.supplierProductId ?? cfg.id);
  if (!localProductId || !Number.isInteger(localProductId) || localProductId <= 0) {
    throw new SupplierApiError('Missing valid `local_product_id`.');
  }
  if (!supplierId || !Number.isInteger(supplierId) || supplierId <= 0) {
    throw new SupplierApiError('Missing valid `supplier_id`.');
  }
  if (!supplierProductId) throw new SupplierApiError('Missing `supplier_product_id`.');
  return {
    local_product_id: localProductId,
    supplier_id: supplierId,
    supplier_product_id: supplierProductId,
    supplier_product_name: asString(cfg.supplier_product_name ?? cfg.supplierProductName),
    supplier_cost: asNumber(cfg.supplier_cost ?? cfg.supplierCost),
    supplier_stock: asNumber(cfg.supplier_stock ?? cfg.supplierStock),
    auto_order: asBoolean(cfg.auto_order, true),
    auto_sync_stock: asBoolean(cfg.auto_sync_stock, true),
    fallback_manual: asBoolean(cfg.fallback_manual, true),
  };
}
