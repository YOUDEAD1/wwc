import type { Api } from 'grammy';
import {
  getProduct,
  listSupplierApiSources,
  listSupplierProductLinks,
} from '../db/queries.js';
import { logger } from '../logger.js';
import { fulfillPendingPreordersForProduct } from './preorder.js';
import {
  fetchSupplierProducts,
  importSupplierProduct,
  isSupplierMigrationError,
  syncSupplierProductLink,
} from './supplierApi.js';
import { syncProducts as syncApiShopProducts } from './apiShop.js';
import { getConnection } from './apiConnect.js';

const DEFAULT_SUPPLIER_SYNC_INTERVAL_MS = 10 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

function intervalMs(): number {
  const raw = Number(process.env.SUPPLIER_SYNC_INTERVAL_MS ?? DEFAULT_SUPPLIER_SYNC_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw < 60_000) return DEFAULT_SUPPLIER_SYNC_INTERVAL_MS;
  return Math.floor(raw);
}

export async function syncSupplierStocksOnce(api: Api): Promise<{
  checked: number;
  updated: number;
  imported: number;
  fulfilled: number;
  failed: number;
}> {
  if (running) return { checked: 0, updated: 0, imported: 0, fulfilled: 0, failed: 0 };
  running = true;
  logger.info({ tenantId: process.env.TENANT_ID ?? 'main' }, 'background auto sync loop started');
  let checked = 0;
  let updated = 0;
  let imported = 0;
  let fulfilled = 0;
  let failed = 0;

  try {
    const sources = await listSupplierApiSources(0, 100).catch((err) => {
      if (isSupplierMigrationError(err)) return { rows: [], total: 0 };
      throw err;
    });

    for (const source of sources.rows) {
      if (!source.enabled) continue;
      const links = await listSupplierProductLinks(source.id).catch((err) => {
        if (isSupplierMigrationError(err)) return [];
        throw err;
      });

      for (const link of links) {
        if (!link.auto_sync_stock) continue;
        checked += 1;
        try {
          const result = await syncSupplierProductLink(link);
          if (result.updatedLocal) updated += 1;

          const product = await getProduct(link.local_product_id).catch(() => null);
          if (product && !product.unlimited_stock && product.stock > 0) {
            const preorders = await fulfillPendingPreordersForProduct(api, product.id);
            fulfilled += preorders.fulfilled;
          }
        } catch (err) {
          failed += 1;
          logger.warn({ err, supplierId: source.id, linkId: link.id }, 'supplier auto stock sync failed');
        }
      }

      if (source.auto_import_new_products) {
        try {
          const seen = new Set(
            (await listSupplierProductLinks(source.id)).map((link) => link.supplier_product_id),
          );
          const products = await fetchSupplierProducts(source);
          for (const product of products) {
            if (seen.has(product.id)) continue;
            try {
              const result = await importSupplierProduct({
                source,
                product,
                active: source.auto_import_active,
                categoryName: source.import_category_name || `Supplier - ${source.name}`,
              });
              if (result.created) imported += 1;
              seen.add(product.id);
            } catch (err) {
              failed += 1;
              logger.warn(
                { err, supplierId: source.id, supplierProductId: product.id },
                'supplier auto import failed',
              );
            }
          }
        } catch (err) {
          failed += 1;
          logger.warn({ err, supplierId: source.id }, 'supplier auto import scan failed');
        }
      }
    }

    // --- API Shop background sync ---
    try {
      const conn = await getConnection();
      if (conn) {
        logger.info({ tenantId: process.env.TENANT_ID ?? 'main' }, 'background API Shop sync started');
        const res = await syncApiShopProductsOnce(api);
        if (res.ok) {
          logger.info({ tenantId: process.env.TENANT_ID ?? 'main' }, 'background API Shop sync finished successfully');
        }
      }
    } catch (apiShopErr) {
      logger.warn({ err: apiShopErr, tenantId: process.env.TENANT_ID ?? 'main' }, 'background API Shop sync failed');
    }

    if (checked > 0 || imported > 0 || fulfilled > 0 || failed > 0) {
      logger.info(
        { checked, updated, imported, fulfilled, failed },
        'supplier auto sync finished',
      );
    }
    return { checked, updated, imported, fulfilled, failed };
  } finally {
    running = false;
    logger.info({ tenantId: process.env.TENANT_ID ?? 'main' }, 'background auto sync loop completed');
  }
}

export async function syncApiShopProductsOnce(api?: Api): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await syncApiShopProducts(api);
    if (!res.ok) {
      logger.warn({ error: res.error }, 'api shop background sync failed');
      return { ok: false, error: res.error };
    }
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, 'api shop background sync crashed');
    return { ok: false, error };
  }
}

export function startSupplierStockSyncLoop(api: Api): void {
  if (timer) return;
  const ms = intervalMs();
  timer = setInterval(() => {
    void syncSupplierStocksOnce(api);
  }, ms);
  timer.unref?.();

  const firstRun = setTimeout(() => {
    void syncSupplierStocksOnce(api);
  }, 30_000);
  firstRun.unref?.();

  logger.info({ intervalMs: ms }, 'supplier auto sync loop started');
}
