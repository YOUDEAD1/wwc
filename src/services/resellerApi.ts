import crypto from 'node:crypto';
import type { Api } from 'grammy';
import { QTY_MAX, QTY_MIN } from '../../config/index.js';
import {
  claimProductItems,
  countAvailableProductItems,
  createOrder,
  decrementProductStock,
  findUserById,
  getProduct,
  listActiveProducts,
  setOrderDeliveredItems,
} from '../db/queries.js';
import { supabase } from '../db/supabase.js';
import { env } from '../env.js';
import { logger } from '../logger.js';
import type { DBProduct, DBUser } from '../types.js';
import { publicOrderId } from './orderId.js';
import { applyUserPriceToProduct, applyUserPriceToProducts } from './pricing.js';
import { priceBreakdown, resolvePromo } from './promo.js';
import { charge } from './wallet.js';
import * as adminLog from './adminLog.js';

const API_KEY_PREFIX = 'stapi_';
const API_KEY_BYTES = 32;
const DEFAULT_PRODUCT_LIMIT = 100;
const MAX_PRODUCT_LIMIT = 500;

type ApiKeyRow = {
  id: number;
  user_id: number;
  key_hash: string;
  key_prefix: string;
  active: boolean;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type ApiStatus = {
  active: boolean;
  keyPrefix: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  balance: number;
  orders: number;
  totalSpent: number;
  recentSpent: number;
};

export type ApiProduct = {
  id: number;
  name: string;
  price: number;
  stock: number | null;
  available: boolean;
  unlimited_stock: boolean;
  warranty: string | null;
  description: string | null;
};

export type ApiOrderResult = {
  order_id: string;
  order_db_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  balance_after: number;
  items: string[];
};

type ApiOrderRow = {
  id: number;
  user_id: number;
  api_key_id: number | null;
  order_id: number;
  product_id: number;
  qty: number;
  total: number | string;
  request_id: string | null;
  created_at: string;
};

export type AdminApiUser = {
  userId: number;
  username: string | null;
  firstName: string | null;
  balance: number;
  active: boolean;
  keyPrefix: string | null;
  keyCreatedAt: string | null;
  lastUsedAt: string | null;
  lastOrderAt: string | null;
  orders: number;
  totalSpent: number;
  spend24h: number;
  spend7d: number;
  spend30d: number;
};

export type AdminApiRecentOrder = {
  id: number;
  userId: number;
  username: string | null;
  firstName: string | null;
  orderDbId: number;
  orderPublicId: string | null;
  productId: number;
  productName: string;
  qty: number;
  total: number;
  requestId: string | null;
  createdAt: string;
};

export type AdminApiOverview = {
  endpoint: string;
  totalKeys: number;
  activeKeys: number;
  totalUsers: number;
  totalOrders: number;
  totalSpent: number;
  orders24h: number;
  spend24h: number;
  orders7d: number;
  spend7d: number;
  orders30d: number;
  spend30d: number;
  topUsers: AdminApiUser[];
  recentOrders: AdminApiRecentOrder[];
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function makeApiKey(): string {
  return `${API_KEY_PREFIX}${crypto.randomBytes(API_KEY_BYTES).toString('hex')}`;
}

function keyPrefix(key: string): string {
  return key.slice(0, 14);
}

function productToApi(p: DBProduct): ApiProduct {
  const unlimited = Boolean(p.unlimited_stock);
  const stock = unlimited ? null : Number(p.stock ?? 0);
  return {
    id: p.id,
    name: p.name,
    price: Number(p.price),
    stock,
    available: unlimited || Number(p.stock ?? 0) > 0,
    unlimited_stock: unlimited,
    warranty: p.warranty ?? null,
    description: p.description ?? null,
  };
}

export function apiBaseUrl(): string {
  const explicit = env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, '');
  if (explicit) return `${explicit}/api`;
  if (env.WEBHOOK_URL) {
    try {
      const u = new URL(env.WEBHOOK_URL);
      return `${u.origin}/api`;
    } catch {
      // Fall through to the setup hint below.
    }
  }
  return 'https://YOUR-RAILWAY-DOMAIN.up.railway.app/api';
}

function sumOrders(rows: ApiOrderRow[]): number {
  return Number(rows.reduce((sum, row) => sum + Number(row.total ?? 0), 0).toFixed(3));
}

function latestIso(values: Array<string | null | undefined>): string | null {
  const sorted = values.filter(Boolean).sort((a, b) => String(b).localeCompare(String(a)));
  return sorted[0] ?? null;
}

async function loadAdminApiData(): Promise<{
  keys: ApiKeyRow[];
  apiOrders: ApiOrderRow[];
  users: Map<number, DBUser>;
  orders: Map<number, import('../types.js').DBOrder>;
}> {
  const [{ data: keysRaw, error: keyErr }, { data: ordersRaw, error: orderErr }] =
    await Promise.all([
      supabase
        .from('reseller_api_keys')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5000),
      supabase
        .from('reseller_api_orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5000),
    ]);
  if (keyErr) throw keyErr;
  if (orderErr) throw orderErr;

  const keys = (keysRaw ?? []) as ApiKeyRow[];
  const apiOrders = (ordersRaw ?? []) as ApiOrderRow[];
  const userIds = Array.from(new Set([...keys.map((k) => k.user_id), ...apiOrders.map((o) => o.user_id)]));
  const orderIds = Array.from(new Set(apiOrders.map((o) => o.order_id)));

  const [{ data: usersRaw, error: usersErr }, { data: dbOrdersRaw, error: dbOrdersErr }] =
    await Promise.all([
      userIds.length
        ? supabase.from('users').select('*').in('telegram_id', userIds)
        : Promise.resolve({ data: [], error: null }),
      orderIds.length
        ? supabase.from('orders').select('*').in('id', orderIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
  if (usersErr) throw usersErr;
  if (dbOrdersErr) throw dbOrdersErr;

  const users = new Map<number, DBUser>();
  for (const u of (usersRaw ?? []) as DBUser[]) users.set(u.telegram_id, u);
  const orders = new Map<number, import('../types.js').DBOrder>();
  for (const o of (dbOrdersRaw ?? []) as import('../types.js').DBOrder[]) orders.set(o.id, o);
  return { keys, apiOrders, users, orders };
}

function buildAdminApiUsers(args: {
  keys: ApiKeyRow[];
  apiOrders: ApiOrderRow[];
  users: Map<number, DBUser>;
}): AdminApiUser[] {
  const now = Date.now();
  const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const userIds = Array.from(new Set([...args.keys.map((k) => k.user_id), ...args.apiOrders.map((o) => o.user_id)]));

  return userIds
    .map((userId) => {
      const userKeys = args.keys.filter((k) => k.user_id === userId);
      const activeKeys = userKeys.filter((k) => k.active);
      const orders = args.apiOrders.filter((o) => o.user_id === userId);
      const user = args.users.get(userId);
      return {
        userId,
        username: user?.username ?? null,
        firstName: user?.first_name ?? null,
        balance: Number(user?.balance ?? 0),
        active: activeKeys.length > 0,
        keyPrefix: activeKeys[0]?.key_prefix ?? userKeys[0]?.key_prefix ?? null,
        keyCreatedAt: activeKeys[0]?.created_at ?? userKeys[0]?.created_at ?? null,
        lastUsedAt: latestIso(userKeys.map((k) => k.last_used_at)),
        lastOrderAt: latestIso(orders.map((o) => o.created_at)),
        orders: orders.length,
        totalSpent: sumOrders(orders),
        spend24h: sumOrders(orders.filter((o) => o.created_at >= since24h)),
        spend7d: sumOrders(orders.filter((o) => o.created_at >= since7d)),
        spend30d: sumOrders(orders.filter((o) => o.created_at >= since30d)),
      };
    })
    .sort((a, b) => {
      if (b.totalSpent !== a.totalSpent) return b.totalSpent - a.totalSpent;
      if (b.orders !== a.orders) return b.orders - a.orders;
      return String(b.lastUsedAt ?? b.keyCreatedAt ?? '').localeCompare(String(a.lastUsedAt ?? a.keyCreatedAt ?? ''));
    });
}

function buildRecentApiOrders(args: {
  apiOrders: ApiOrderRow[];
  users: Map<number, DBUser>;
  orders: Map<number, import('../types.js').DBOrder>;
}): AdminApiRecentOrder[] {
  return args.apiOrders.map((row) => {
    const user = args.users.get(row.user_id);
    const order = args.orders.get(row.order_id);
    return {
      id: row.id,
      userId: row.user_id,
      username: user?.username ?? null,
      firstName: user?.first_name ?? null,
      orderDbId: row.order_id,
      orderPublicId: order ? publicOrderId(order) : null,
      productId: row.product_id,
      productName: order?.product_name ?? `Product #${row.product_id}`,
      qty: Number(order?.qty ?? row.qty),
      total: Number(row.total ?? order?.total ?? 0),
      requestId: row.request_id ?? null,
      createdAt: row.created_at,
    };
  });
}

export async function getAdminApiOverview(): Promise<AdminApiOverview> {
  const data = await loadAdminApiData();
  const now = Date.now();
  const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const users = buildAdminApiUsers(data);
  const recentOrders = buildRecentApiOrders(data).slice(0, 5);
  return {
    endpoint: apiBaseUrl(),
    totalKeys: data.keys.length,
    activeKeys: data.keys.filter((k) => k.active).length,
    totalUsers: users.length,
    totalOrders: data.apiOrders.length,
    totalSpent: sumOrders(data.apiOrders),
    orders24h: data.apiOrders.filter((o) => o.created_at >= since24h).length,
    spend24h: sumOrders(data.apiOrders.filter((o) => o.created_at >= since24h)),
    orders7d: data.apiOrders.filter((o) => o.created_at >= since7d).length,
    spend7d: sumOrders(data.apiOrders.filter((o) => o.created_at >= since7d)),
    orders30d: data.apiOrders.filter((o) => o.created_at >= since30d).length,
    spend30d: sumOrders(data.apiOrders.filter((o) => o.created_at >= since30d)),
    topUsers: users.slice(0, 6),
    recentOrders,
  };
}

export async function listAdminApiUsers(args: {
  page?: number;
  perPage?: number;
}): Promise<{ rows: AdminApiUser[]; total: number; page: number; pages: number }> {
  const perPage = Math.max(1, Math.min(args.perPage ?? 8, 20));
  const data = await loadAdminApiData();
  const all = buildAdminApiUsers(data);
  const pages = Math.max(1, Math.ceil(all.length / perPage));
  const page = Math.max(0, Math.min(args.page ?? 0, pages - 1));
  return {
    rows: all.slice(page * perPage, page * perPage + perPage),
    total: all.length,
    page,
    pages,
  };
}

export async function getAdminApiUser(userId: number): Promise<{
  user: AdminApiUser | null;
  recentOrders: AdminApiRecentOrder[];
}> {
  const data = await loadAdminApiData();
  const user = buildAdminApiUsers(data).find((u) => u.userId === userId) ?? null;
  const recentOrders = buildRecentApiOrders(data)
    .filter((o) => o.userId === userId)
    .slice(0, 8);
  return { user, recentOrders };
}

export async function listAdminApiOrders(args: {
  page?: number;
  perPage?: number;
}): Promise<{ rows: AdminApiRecentOrder[]; total: number; page: number; pages: number }> {
  const perPage = Math.max(1, Math.min(args.perPage ?? 8, 20));
  const data = await loadAdminApiData();
  const all = buildRecentApiOrders(data);
  const pages = Math.max(1, Math.ceil(all.length / perPage));
  const page = Math.max(0, Math.min(args.page ?? 0, pages - 1));
  return {
    rows: all.slice(page * perPage, page * perPage + perPage),
    total: all.length,
    page,
    pages,
  };
}

export async function getApiStatus(userId: number): Promise<ApiStatus> {
  const [{ data: key }, user, { count: orderCount }, { data: orderRows }, { data: recentRows }] =
    await Promise.all([
      supabase
        .from('reseller_api_keys')
        .select('*')
        .eq('user_id', userId)
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      findUserById(userId),
      supabase
        .from('reseller_api_orders')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabase
        .from('reseller_api_orders')
        .select('total')
        .eq('user_id', userId),
      supabase
        .from('reseller_api_orders')
        .select('total')
        .eq('user_id', userId)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    ]);
  const totalSpent = (orderRows ?? []).reduce(
    (sum, row: { total?: number | string }) => sum + Number(row.total ?? 0),
    0,
  );
  const recentSpent = (recentRows ?? []).reduce(
    (sum, row: { total?: number | string }) => sum + Number(row.total ?? 0),
    0,
  );
  const k = key as ApiKeyRow | null;
  return {
    active: Boolean(k?.active),
    keyPrefix: k?.key_prefix ?? null,
    createdAt: k?.created_at ?? null,
    lastUsedAt: k?.last_used_at ?? null,
    balance: Number(user?.balance ?? 0),
    orders: orderCount ?? 0,
    totalSpent: Number(totalSpent.toFixed(3)),
    recentSpent: Number(recentSpent.toFixed(3)),
  };
}

export async function generateApiKey(userId: number): Promise<{ key: string; status: ApiStatus }> {
  const key = makeApiKey();
  await supabase
    .from('reseller_api_keys')
    .update({ active: false, revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('active', true);
  const { error } = await supabase.from('reseller_api_keys').insert({
    user_id: userId,
    key_hash: hashApiKey(key),
    key_prefix: keyPrefix(key),
    active: true,
  });
  if (error) {
    logger.error({ err: error, userId }, 'generateApiKey failed');
    throw error;
  }
  return { key, status: await getApiStatus(userId) };
}

export async function disableApiKey(userId: number): Promise<void> {
  const { error } = await supabase
    .from('reseller_api_keys')
    .update({ active: false, revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('active', true);
  if (error) {
    logger.error({ err: error, userId }, 'disableApiKey failed');
    throw error;
  }
}

export async function authenticateApiKey(rawKey: string): Promise<{
  key: ApiKeyRow;
  user: DBUser;
}> {
  const cleaned = rawKey.trim();
  if (!cleaned.startsWith(API_KEY_PREFIX)) {
    throw new ApiError(401, 'invalid_api_key', 'Invalid API key.');
  }
  const { data, error } = await supabase
    .from('reseller_api_keys')
    .select('*')
    .eq('key_hash', hashApiKey(cleaned))
    .eq('active', true)
    .maybeSingle();
  if (error) {
    logger.error({ err: error }, 'authenticateApiKey lookup failed');
    throw new ApiError(500, 'auth_failed', 'API authentication failed.');
  }
  const key = data as ApiKeyRow | null;
  if (!key) throw new ApiError(401, 'invalid_api_key', 'Invalid API key.');
  const user = await findUserById(key.user_id);
  if (!user) throw new ApiError(401, 'user_not_found', 'API user was not found.');
  if (user.is_banned) throw new ApiError(403, 'user_banned', 'This account is banned.');
  await supabase
    .from('reseller_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id);
  return { key, user };
}

export async function listApiProducts(args: {
  userId: number;
  limit?: number;
  offset?: number;
}): Promise<{ products: ApiProduct[]; total: number }> {
  const limit = Math.min(Math.max(Number(args.limit ?? DEFAULT_PRODUCT_LIMIT), 1), MAX_PRODUCT_LIMIT);
  const offset = Math.max(Number(args.offset ?? 0), 0);
  const page = Math.floor(offset / limit);
  const { rows, total } = await listActiveProducts(page, limit);
  const priced = await applyUserPriceToProducts(args.userId, rows);
  return { products: priced.map(productToApi), total };
}

async function rollbackClaimedItems(orderId: number): Promise<void> {
  const { error } = await supabase
    .from('product_items')
    .update({ consumed_at: null, consumed_order_id: null })
    .eq('consumed_order_id', orderId);
  if (error) logger.error({ err: error, orderId }, 'API order rollbackClaimedItems failed');
}

async function deleteOrder(orderId: number): Promise<void> {
  const { error } = await supabase.from('orders').delete().eq('id', orderId);
  if (error) logger.error({ err: error, orderId }, 'API order delete failed');
}

export async function placeApiOrder(args: {
  api: Api;
  apiKeyId: number;
  user: DBUser;
  productId: number;
  qty: number;
  requestId?: string | null;
}): Promise<ApiOrderResult> {
  const qty = Number(args.qty);
  if (!Number.isInteger(qty) || qty < QTY_MIN || qty > QTY_MAX) {
    throw new ApiError(400, 'invalid_quantity', `Quantity must be ${QTY_MIN}-${QTY_MAX}.`);
  }
  if (!Number.isInteger(args.productId) || args.productId <= 0) {
    throw new ApiError(400, 'invalid_product_id', 'product_id must be a positive number.');
  }
  const requestId = args.requestId?.trim() || null;
  if (requestId) {
    const { data: existing } = await supabase
      .from('reseller_api_orders')
      .select('id')
      .eq('user_id', args.user.telegram_id)
      .eq('request_id', requestId)
      .maybeSingle();
    if (existing) {
      throw new ApiError(409, 'duplicate_request_id', 'request_id was already used.');
    }
  }

  const rawProduct = await getProduct(args.productId);
  if (!rawProduct || !rawProduct.active) {
    throw new ApiError(404, 'product_not_found', 'Product not found.');
  }
  const product = await applyUserPriceToProduct(args.user.telegram_id, rawProduct);
  if (!product.unlimited_stock && product.stock < qty) {
    throw new ApiError(409, 'out_of_stock', 'Product does not have enough stock.');
  }
  const availableItems = await countAvailableProductItems(product.id);
  if (availableItems < qty) {
    throw new ApiError(
      409,
      'delivery_not_ready',
      'Automatic API delivery is not ready for this product/quantity.',
    );
  }

  const promo = await resolvePromo(args.user.telegram_id, product.id, qty, product.price);
  const breakdown = priceBreakdown(product.price, qty, promo);
  const total = Number(breakdown.total.toFixed(3));
  const discount = Number(breakdown.discount.toFixed(3));
  const currentUser = await findUserById(args.user.telegram_id);
  const currentBalance = Number(currentUser?.balance ?? args.user.balance ?? 0);
  if (currentBalance < total) {
    throw new ApiError(402, 'insufficient_balance', 'Insufficient wallet/API balance.');
  }

  const order = await createOrder({
    user_id: args.user.telegram_id,
    product_id: product.id,
    product_name: product.name,
    qty,
    unit_price: product.price,
    total,
    discount,
    promo_id: promo?.promo.id ?? null,
    delivery: `API order #${product.id}-${qty}`,
  });

  const claimed = await claimProductItems(product.id, qty, order.id);
  if (claimed.length < qty) {
    await rollbackClaimedItems(order.id);
    await deleteOrder(order.id);
    throw new ApiError(409, 'delivery_race', 'Stock was just taken. Please retry.');
  }

  let balanceAfter = currentBalance;
  try {
    balanceAfter = await charge(args.user.telegram_id, total, currentBalance, `api_order:${order.id}`);
    await decrementProductStock(product.id, qty);
    await setOrderDeliveredItems(order.id, claimed.join('\n'));
    const { error: apiOrderErr } = await supabase.from('reseller_api_orders').insert({
      user_id: args.user.telegram_id,
      api_key_id: args.apiKeyId,
      order_id: order.id,
      product_id: product.id,
      qty,
      total,
      request_id: requestId,
    });
    if (apiOrderErr) {
      logger.warn({ err: apiOrderErr, orderId: order.id }, 'API order stats insert failed');
    }
  } catch (err) {
    await rollbackClaimedItems(order.id);
    await deleteOrder(order.id);
    logger.error({ err, orderId: order.id }, 'API order failed after create');
    throw err instanceof ApiError
      ? err
      : new ApiError(500, 'order_failed', 'Order could not be completed.');
  }

  void adminLog.logOrderCreated(args.api, {
    user: {
      telegram_id: args.user.telegram_id,
      username: args.user.username ?? null,
      first_name: args.user.first_name ?? null,
      email: args.user.email ?? null,
    },
    orderDbId: order.id,
    orderPublicId: publicOrderId(order),
    productId: product.id,
    productName: product.name,
    qty,
    unitPrice: product.price,
    total,
    paidVia: 'Reseller API wallet',
    balanceAfter: Number(balanceAfter.toFixed(3)),
    lifecycle: 'delivered',
  });

  return {
    order_id: publicOrderId(order),
    order_db_id: order.id,
    product_id: product.id,
    product_name: product.name,
    quantity: qty,
    unit_price: Number(product.price),
    discount,
    total,
    balance_after: Number(balanceAfter.toFixed(3)),
    items: claimed,
  };
}
