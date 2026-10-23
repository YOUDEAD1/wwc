import type { Api } from 'grammy';
import { listSupplierApiSources, listSupplierProductLinks } from '../db/queries.js';
import { supabase } from '../db/supabase.js';
import { logger } from '../logger.js';
import type { DBProduct } from '../types.js';
import { getConnection } from './apiConnect.js';
import { syncProducts as syncApiShopProducts } from './apiShop.js';
import { fulfillPendingPreordersForProduct } from './preorder.js';
import { ensureLoaded, getSettingValue } from './settings.js';
import {
  fetchSupplierProducts,
  importSupplierProduct,
  isSupplierMigrationError,
  syncSupplierProductLink,
} from './supplierApi.js';

const DEFAULT_SUPPLIER_SYNC_INTERVAL_MS = 10 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

function intervalMs(): number {
  const configured = Number(getSettingValue('supplier.sync_minutes'));
  const raw = Number(
    configured > 0
      ? configured * 60000
      : (process.env.SUPPLIER_SYNC_INTERVAL_MS ?? DEFAULT_SUPPLIER_SYNC_INTERVAL_MS),
  );
  if(process.env.WWC_MANAGED==='1')return Math.max(600000,Number.isFinite(raw)?raw:DEFAULT_SUPPLIER_SYNC_INTERVAL_MS);
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
    const { recoverPendingDeliveries } = await import('./deliveryRecovery.js');
    await recoverPendingDeliveries(api);
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

      const snapshot = await fetchSupplierProducts(source);
      const localRows = new Map<number, DBProduct>();
      const ids = links.map((link) => link.local_product_id);
      for (let offset = 0; offset < ids.length; offset += 100) {
        const { data, error } = await supabase
          .from('products')
          .select('id,name,price,stock,unlimited_stock,active,catalog_hidden,api_auto_hidden')
          .in('id', ids.slice(offset, offset + 100));
        if (error) throw error;
        for (const row of data ?? []) localRows.set(row.id, row as DBProduct);
      }
      for (const link of links) {
        if (!link.auto_sync_stock) continue;
        checked += 1;
        try {
          const result = await syncSupplierProductLink(
            link,
            api,
            snapshot,
            source,
            localRows.get(link.local_product_id),
          );
          if (result.updatedLocal) updated += 1;

          const product = result.matched
            ? {
                ...localRows.get(link.local_product_id),
                id: link.local_product_id,
                unlimited_stock: result.matched.stock === null,
                stock: result.matched.stock ?? 0,
              }
            : null;
          if (product && !product.unlimited_stock && product.stock > 0) {
            const preorders = await fulfillPendingPreordersForProduct(api, product.id);
            fulfilled += preorders.fulfilled;
          }
        } catch (err) {
          failed += 1;
          logger.warn(
            { err, supplierId: source.id, linkId: link.id },
            'supplier auto stock sync failed',
          );
        }
      }

      if (source.auto_import_new_products) {
        try {
          const seen = new Set(
            (await listSupplierProductLinks(source.id)).map((link) => link.supplier_product_id),
          );
          const products = snapshot;
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
        logger.info(
          { tenantId: process.env.TENANT_ID ?? 'main' },
          'background API Shop sync started',
        );
        const res = await syncApiShopProductsOnce(api);
        if (res.ok) {
          logger.info(
            { tenantId: process.env.TENANT_ID ?? 'main' },
            'background API Shop sync finished successfully',
          );
        }
      }
    } catch (apiShopErr) {
      logger.warn(
        { err: apiShopErr, tenantId: process.env.TENANT_ID ?? 'main' },
        'background API Shop sync failed',
      );
    }

    if (checked > 0 || imported > 0 || fulfilled > 0 || failed > 0) {
      logger.info({ checked, updated, imported, fulfilled, failed }, 'supplier auto sync finished');
    }
    return { checked, updated, imported, fulfilled, failed };
  } finally {
    running = false;
    logger.info(
      { tenantId: process.env.TENANT_ID ?? 'main' },
      'background auto sync loop completed',
    );
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
  let last = process.env.WWC_MANAGED==='1'?Date.now():0;
  const tick = async () => {
    await ensureLoaded();
    if (Date.now() - last < intervalMs()) return;
    last = Date.now();
    await syncSupplierStocksOnce(api);
  };
  timer = setInterval(
    () => void tick().catch((err) => logger.warn({ err }, 'supplier sync deferred')),
    30000,
  );
  timer.unref?.();
  logger.info({ intervalMs: intervalMs() }, 'supplier auto sync loop started');
}
