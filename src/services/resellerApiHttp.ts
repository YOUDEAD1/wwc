import type http from 'node:http';
import { Api } from 'grammy';
import { createClient } from '@supabase/supabase-js';
import { runWithTenantContext } from '../db/db_context.js';
import { listActiveTenants, type Tenant } from '../tenants/store.js';
import { logger } from '../logger.js';
import {
  ApiError,
  apiBaseUrl,
  authenticateApiKey,
  getApiStatus,
  listApiProducts,
  placeApiOrder,
  getApiSecretPath,
  getApiProduct,
  getApiPrices,
  getApiStats,
  setApiPrice,
  setApiProduct,
  getApiOrder,
  listApiOrders,
} from './resellerApi.js';

const BODY_LIMIT_BYTES = 64 * 1024;

type JsonRecord = Record<string, unknown>;

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: JsonRecord,
): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-api-key',
  });
  res.end(JSON.stringify(body, null, 2));
}

function sendText(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

function readApiKey(req: http.IncomingMessage, url: URL): string {
  const auth = req.headers.authorization ?? '';
  const bearer = Array.isArray(auth) ? auth[0] : auth;
  if (bearer.toLowerCase().startsWith('bearer ')) return bearer.slice(7).trim();
  const header = req.headers['x-api-key'];
  if (Array.isArray(header)) return header[0]?.trim() ?? '';
  if (typeof header === 'string') return header.trim();
  return url.searchParams.get('api_key')?.trim() ?? '';
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > BODY_LIMIT_BYTES) {
      throw new ApiError(413, 'body_too_large', 'Request body is too large.');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonBody(req: http.IncomingMessage): Promise<JsonRecord> {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : {};
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body must be JSON.');
  }
}

function docsBody(gateway: string): JsonRecord {
  const base = `${apiBaseUrl().replace(/\/api$/, '')}/${gateway}`;
  return {
    success: true,
    name: 'SafwanTiger Shop Reseller API',
    auth: 'Send your key as Authorization: Bearer YOUR_KEY or x-api-key: YOUR_KEY.',
    endpoints: {
      products: `GET ${base}/products`,
      product_detail: `GET ${base}/product/{id}`,
      balance: `GET ${base}/balance`,
      orders: `GET ${base}/orders`,
      order_detail: `GET ${base}/order/{order_id}`,
      my_prices: `GET ${base}/my_prices`,
      stats: `GET ${base}/stats`,
      purchase: `POST ${base}/purchase`,
      set_price: `POST ${base}/set_price`,
      set_product: `POST ${base}/set_product`,
    },
  };
}

// Memory cache for gateway paths
type CachedTenant = {
  isMain: boolean;
  tenant: Tenant | null;
  secretPath: string;
};

// Map from secretPath to CachedTenant
const gatewayCache = new Map<string, CachedTenant>();

// Last time we scanned the active tenants to find new ones
let lastTenantScanTime = 0;
const TENANT_SCAN_COOLDOWN_MS = 10000; // 10 seconds

async function resolveTenantForGateway(requestGateway: string): Promise<CachedTenant | null> {
  // 1. Check cache first
  const cached = gatewayCache.get(requestGateway);
  if (cached) return cached;

  // 2. Check main bot's secret path or backward-compatible 'api' gateway
  const mainSecret = await getApiSecretPath();
  if (requestGateway === 'api' || mainSecret === requestGateway) {
    const info = { isMain: true, tenant: null, secretPath: requestGateway };
    gatewayCache.set(requestGateway, info);
    return info;
  }

  // 3. Check if we should scan active tenants (enforce cooldown to prevent DoS)
  const now = Date.now();
  if (now - lastTenantScanTime > TENANT_SCAN_COOLDOWN_MS) {
    lastTenantScanTime = now;
    
    // Fetch all active tenants from main database
    const activeTenants = await listActiveTenants();
    
    // For each active tenant, get their secret path and cache it
    await Promise.all(
      activeTenants.map(async (tenant) => {
        try {
          // Create a supabase client for this tenant to read their settings
          const tenantDb = createClient(tenant.supabase_url, tenant.supabase_service_key, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          
          // Read 'api_secret_path' setting
          const { data } = await tenantDb
            .from('settings')
            .select('value')
            .eq('key', 'api_secret_path')
            .maybeSingle();
            
          const secret = data?.value;
          if (typeof secret === 'string' && secret.trim()) {
            const secretTrimmed = secret.trim();
            gatewayCache.set(secretTrimmed, {
              isMain: false,
              tenant,
              secretPath: secretTrimmed,
            });
          }
        } catch (err) {
          logger.warn({ tenantId: tenant.id, err }, 'Failed to read api_secret_path for tenant');
        }
      })
    );
    
    // Re-check cache after scanning
    const cachedAfterScan = gatewayCache.get(requestGateway);
    if (cachedAfterScan) return cachedAfterScan;
  }

  return null;
}

export async function handleResellerApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  api: Api,
): Promise<boolean> {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  
  // Normalise pathname by removing trailing slashes
  const cleanPath = url.pathname.replace(/\/+$/, '');
  
  // Extract the first path segment (the gateway/secret path)
  const parts = cleanPath.split('/').filter(Boolean);
  if (parts.length === 0) return false;
  const requestGateway = parts[0]!;

  // Resolve the tenant configuration corresponding to this gateway
  const resolved = await resolveTenantForGateway(requestGateway);
  if (!resolved) return false;

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return true;
  }

  // Define the target API client and context runner
  const targetApi = resolved.isMain || !resolved.tenant
    ? api
    : new Api(resolved.tenant.bot_token);

  const runHandler = async () => {
    try {
      // Extract the action (everything after /{gateway}/)
      const prefix = `/${resolved.secretPath}`;
      let action = '';
      if (cleanPath.startsWith(prefix + '/')) {
        action = cleanPath.slice(prefix.length + 1);
      }

      if (cleanPath === prefix && !action) {
        sendJson(res, 200, docsBody(resolved.secretPath));
        return true;
      }

      const keyValue = readApiKey(req, url);
      if (!keyValue) throw new ApiError(401, 'missing_api_key', 'API key is required.');
      const auth = await authenticateApiKey(keyValue);

      // 1. GET /products
      if (req.method === 'GET' && action === 'products') {
        const limit = Number(url.searchParams.get('limit') ?? undefined);
        const offset = Number(url.searchParams.get('offset') ?? undefined);
        const data = await listApiProducts({
          userId: auth.user.telegram_id,
          apiKeyId: auth.key.id,
          limit: Number.isFinite(limit) ? limit : undefined,
          offset: Number.isFinite(offset) ? offset : undefined,
        });
        sendJson(res, 200, { success: true, ...data });
        return true;
      }

      // 2. GET /product/{id}
      if (req.method === 'GET' && action.startsWith('product/')) {
        const productId = Number(action.slice('product/'.length));
        if (isNaN(productId) || productId <= 0) {
          throw new ApiError(400, 'invalid_product_id', 'Product ID must be a positive number.');
        }
        const product = await getApiProduct({
          productId,
          userId: auth.user.telegram_id,
          apiKeyId: auth.key.id,
        });
        sendJson(res, 200, { success: true, product });
        return true;
      }

      // 3. GET /balance
      if (req.method === 'GET' && action === 'balance') {
        const status = await getApiStatus(auth.user.telegram_id);
        sendJson(res, 200, {
          success: true,
          balance: status.balance,
          user_id: auth.user.telegram_id,
        });
        return true;
      }

      // 4. GET /orders
      if (req.method === 'GET' && action === 'orders') {
        const limit = Number(url.searchParams.get('limit') ?? undefined);
        const offset = Number(url.searchParams.get('offset') ?? undefined);
        const orders = await listApiOrders({
          userId: auth.user.telegram_id,
          limit: Number.isFinite(limit) ? limit : undefined,
          offset: Number.isFinite(offset) ? offset : undefined,
        });
        sendJson(res, 200, { success: true, orders });
        return true;
      }

      // 5. GET /order/{order_id}
      if (req.method === 'GET' && action.startsWith('order/')) {
        const orderIdStr = action.slice('order/'.length);
        const order = await getApiOrder(orderIdStr, auth.user.telegram_id);
        sendJson(res, 200, { success: true, order });
        return true;
      }

      // 6. GET /my_prices
      if (req.method === 'GET' && action === 'my_prices') {
        const prices = await getApiPrices(auth.key.id);
        sendJson(res, 200, { success: true, custom_products: prices });
        return true;
      }

      // 7. GET /stats
      if (req.method === 'GET' && action === 'stats') {
        const stats = await getApiStats(auth.user.telegram_id);
        sendJson(res, 200, { success: true, ...stats });
        return true;
      }

      // 8. POST /purchase or POST /order (for backward compatibility)
      if (req.method === 'POST' && (action === 'purchase' || action === 'order')) {
        const body = await readJsonBody(req);
        const productId = Number(body.product_id ?? body.productId ?? body.id);
        const qty = Number(body.quantity ?? body.qty ?? 1);
        const requestId = typeof body.request_id === 'string'
          ? body.request_id
          : typeof body.requestId === 'string'
            ? body.requestId
            : typeof body.external_order_id === 'string'
              ? body.external_order_id
              : typeof body.externalOrderId === 'string'
                ? body.externalOrderId
                : null;
        const order = await placeApiOrder({
          api: targetApi,
          apiKeyId: auth.key.id,
          user: auth.user,
          productId,
          qty,
          requestId,
        });
        sendJson(res, 200, { success: true, ...order });
        return true;
      }

      // 9. POST /set_price
      if (req.method === 'POST' && action === 'set_price') {
        const body = await readJsonBody(req);
        const productId = Number(body.product_id ?? body.id);
        const price = Number(body.price);
        if (isNaN(productId) || productId <= 0) {
          throw new ApiError(400, 'invalid_product_id', 'product_id is required.');
        }
        if (isNaN(price) || price < 0) {
          throw new ApiError(400, 'invalid_price', 'price is required and must be positive.');
        }
        const pricing = await setApiPrice({
          apiKeyId: auth.key.id,
          productId,
          price,
          userId: auth.user.telegram_id,
        });
        sendJson(res, 200, { success: true, ...pricing });
        return true;
      }

      // 10. POST /set_product
      if (req.method === 'POST' && action === 'set_product') {
        const body = await readJsonBody(req);
        const productId = Number(body.product_id ?? body.id);
        if (isNaN(productId) || productId <= 0) {
          throw new ApiError(400, 'invalid_product_id', 'product_id is required.');
        }
        const data: any = {
          apiKeyId: auth.key.id,
          productId,
          userId: auth.user.telegram_id,
        };
        if (body.name_ar !== undefined) data.name_ar = String(body.name_ar);
        if (body.name_en !== undefined) data.name_en = String(body.name_en);
        if (body.desc_ar !== undefined) data.desc_ar = String(body.desc_ar);
        if (body.desc_en !== undefined) data.desc_en = String(body.desc_en);
        if (body.price !== undefined) {
          const price = Number(body.price);
          if (isNaN(price) || price < 0) {
            throw new ApiError(400, 'invalid_price', 'price must be positive.');
          }
          data.price = price;
        }
        const result = await setApiProduct(data);
        sendJson(res, 200, { success: true, ...result });
        return true;
      }

      throw new ApiError(404, 'unknown_endpoint', 'Unknown API endpoint.');
    } catch (err) {
      if (err instanceof ApiError) {
        sendJson(res, err.status, { success: false, error: err.code, message: err.message });
        return true;
      }
      sendJson(res, 500, {
        success: false,
        error: 'internal_error',
        message: err instanceof Error ? err.message : 'Internal API error.',
      });
      return true;
    }
  };

  if (resolved.isMain || !resolved.tenant) {
    return runHandler();
  } else {
    return runWithTenantContext(
      resolved.tenant.supabase_url,
      resolved.tenant.supabase_service_key,
      resolved.tenant.owner_telegram_id,
      runHandler,
    );
  }
}

export function handleHealthRequest(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  if (url.pathname !== '/healthz' && url.pathname !== '/') return false;
  sendText(res, 200, 'work');
  return true;
}


