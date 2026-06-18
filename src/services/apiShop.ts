/**
 * API Shop Config — manages external API products in the local shop.
 * Each product can be customized: emoji, name, description, price, sort order.
 *
 * Stored in Supabase `settings` table under key `api_shop_config`.
 */

import { readSetting, setSetting, addCategory, addProduct } from '../db/queries.js';
import { supabase } from '../db/supabase.js';
import { logger } from '../logger.js';
import { getProductEmoji } from '../../config/index.js';
import {
  getConnection,
  fetchProducts as apiFetchProducts,
  purchase as apiPurchase,
  fetchBalance as apiFetchBalance,
  type ApiProduct,
} from './apiConnect.js';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type ApiShopProduct = {
  enabled: boolean;
  sell_price: number;
  custom_name: string;        // اسم مخصص (يظهر للعميل)
  custom_desc: string;        // وصف مخصص
  emoji: string;              // إيموجي مخصص
  emoji_id?: string;          // إيموجي بريميوم مخصص
  sort_order: number;         // ترتيب العرض
  // بيانات من API (لا يعدّلها الأدمن)
  original_name: string;
  base_price: number;
  is_manual: boolean;
};

export type ApiShopConfig = {
  products: Record<string, ApiShopProduct>;
  button?: {
    label: string;       // مثل "🎮 Products" أو "🛒 Shop"
    position: number;    // الصف (0 = أول صف, 1 = ثاني, إلخ)
    enabled: boolean;
  };
};

const SETTINGS_KEY = 'api_shop_config';

// ─────────────────────────────────────────────────────────────────
// Read / Write
// ─────────────────────────────────────────────────────────────────

export async function getShopConfig(): Promise<ApiShopConfig> {
  const raw = await readSetting(SETTINGS_KEY);
  if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).products) {
    return raw as ApiShopConfig;
  }
  return { products: {} };
}

export async function saveShopConfig(config: ApiShopConfig): Promise<void> {
  await setSetting(SETTINGS_KEY, config);
}

// ─────────────────────────────────────────────────────────────────
// Sync — fetch from API + merge with saved config
// ─────────────────────────────────────────────────────────────────

export type MergedProduct = ApiProduct & {
  enabled: boolean;
  sell_price: number;
  custom_name: string;
  custom_desc: string;
  emoji: string;
  sort_order: number;
};

export async function syncProducts(): Promise<
  { ok: true; products: MergedProduct[] } | { ok: false; error: string }
> {
  const conn = await getConnection();
  if (!conn) return { ok: false, error: 'Not connected' };

  const res = await apiFetchProducts(conn);
  if (!res.ok) return { ok: false, error: res.error };

  const config = await getShopConfig();
  let nextOrder = Object.values(config.products).reduce(
    (max, p) => Math.max(max, p.sort_order ?? 0), 0,
  ) + 1;

  // Merge
  for (const p of res.products) {
    if (!config.products[p.id]) {
      config.products[p.id] = {
        enabled: false,
        sell_price: p.your_price,
        custom_name: p.name_en,
        custom_desc: p.description || '',
        emoji: p.emoji || getProductEmoji(p.name_en),
        emoji_id: p.emoji_id || undefined,
        sort_order: nextOrder++,
        original_name: p.name_en,
        base_price: p.base_price,
        is_manual: p.is_manual,
      };
    } else {
      // Update API-side data
      const existing = config.products[p.id];
      if (existing) {
        existing.original_name = p.name_en;
        existing.base_price = p.base_price;
        existing.is_manual = p.is_manual;
        existing.emoji = p.emoji || getProductEmoji(p.name_en);
        existing.emoji_id = p.emoji_id || undefined;
      }
    }
  }
  await saveShopConfig(config);

  // --- DYNAMIC DATABASE SYNC ---
  try {
    let categoryId: number;
    const { data: catRow } = await supabase
      .from('categories')
      .select('id')
      .eq('name', '🔌 API Shop')
      .maybeSingle();

    if (catRow) {
      categoryId = catRow.id;
    } else {
      const newCat = await addCategory('🔌 API Shop', '🔌');
      categoryId = newCat.id;
    }

    for (const p of res.products) {
      const s = config.products[p.id];
      if (!s) continue;

      const { data: matchingProds } = await supabase
        .from('products')
        .select('id, emoji, emoji_id')
        .eq('category_id', categoryId)
        .like('note', `%[API_PRODUCT_ID:${p.id}]%`);

      const existingProd = matchingProds && matchingProds.length > 0 ? matchingProds[0] : null;

      if (matchingProds && matchingProds.length > 1) {
        const idsToDelete = matchingProds.slice(1).map((x) => x.id);
        await supabase.from('products').delete().in('id', idsToDelete);
      }

      // Determine stock and unlimited status safely to prevent null PostgreSQL database violations
      const isUnlimited = p.stock === null || p.stock === undefined || p.stock < 0;
      let stockVal = isUnlimited ? 0 : Number(p.stock);
      if (isNaN(stockVal)) {
        stockVal = 0;
      }

      // Safely determine price to prevent null database constraint violations
      const rawPrice = s.sell_price ?? p.your_price ?? p.base_price ?? 0;
      let priceVal = Number(rawPrice);
      if (isNaN(priceVal) || !isFinite(priceVal) || priceVal < 0) {
        priceVal = 0;
      }

      if (existingProd) {
        // Sync API stock, price, enabled state, name and descriptions to standard products table
        await supabase
          .from('products')
          .update({
            name: s.custom_name || p.name_en,
            price: priceVal,
            stock: stockVal,
            active: s.enabled,
            description: s.custom_desc || p.description || '',
            emoji: s.emoji || p.emoji || existingProd.emoji || getProductEmoji(p.name_en),
            emoji_id: s.emoji_id || p.emoji_id || existingProd.emoji_id || null,
            unlimited_stock: isUnlimited,
          })
          .eq('id', existingProd.id);
      } else {
        // Insert as a new standard local database product
        const noteTag = `[API_PRODUCT_ID:${p.id}]`;
        await addProduct({
          category_id: categoryId,
          name: s.custom_name || p.name_en,
          price: priceVal,
          stock: stockVal,
          description: s.custom_desc || p.description || '',
          note: noteTag,
          emoji: s.emoji || p.emoji || getProductEmoji(p.name_en),
          emoji_id: s.emoji_id || p.emoji_id || null,
          unlimited_stock: isUnlimited,
        });
      }
    }
  } catch (syncErr) {
    logger.error({ err: syncErr }, 'syncProducts database sync failed');
  }

  const merged: MergedProduct[] = res.products.map((p) => {
    const s = config.products[p.id];
    return {
      ...p,
      enabled: s?.enabled ?? false,
      sell_price: s?.sell_price ?? p.your_price,
      custom_name: s?.custom_name ?? p.name_en,
      custom_desc: s?.custom_desc ?? '',
      emoji: s?.emoji ?? p.emoji ?? getProductEmoji(p.name_en),
      emoji_id: s?.emoji_id ?? p.emoji_id ?? undefined,
      sort_order: s?.sort_order ?? 0,
    };
  });

  merged.sort((a, b) => a.sort_order - b.sort_order);
  return { ok: true, products: merged };
}

// ─────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────

export async function toggleProduct(id: string, enabled: boolean): Promise<void> {
  const config = await getShopConfig();
  if (config.products[id]) {
    config.products[id].enabled = enabled;
    await saveShopConfig(config);
  }
}

export async function setProductField(
  id: string,
  field: 'sell_price' | 'custom_name' | 'custom_desc' | 'emoji',
  value: string | number,
): Promise<void> {
  const config = await getShopConfig();
  if (config.products[id]) {
    (config.products[id] as Record<string, unknown>)[field] = value;
    await saveShopConfig(config);

    // Sync to products table immediately
    try {
      const { data: matchingProds } = await supabase
        .from('products')
        .select('id')
        .like('note', `%[API_PRODUCT_ID:${id}]%`);
      const existingProd = matchingProds?.[0];
      if (existingProd) {
        const updatePayload: Record<string, any> = {};
        if (field === 'sell_price') updatePayload.price = Number(value);
        if (field === 'custom_name') updatePayload.name = String(value);
        if (field === 'custom_desc') updatePayload.description = String(value);
        if (field === 'emoji') updatePayload.emoji = String(value);
        await supabase.from('products').update(updatePayload).eq('id', existingProd.id);
      }
    } catch (err) {
      logger.error({ err, id, field }, 'Failed to sync setProductField to products table');
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Button config — إعداد الزر في القائمة الرئيسية
// ─────────────────────────────────────────────────────────────────

export async function getButtonConfig(): Promise<{
  label: string;
  position: number;
  enabled: boolean;
}> {
  const config = await getShopConfig();
  return config.button ?? { label: '🛒 Shop', position: 0, enabled: false };
}

export async function setButtonConfig(label: string, position: number, enabled: boolean): Promise<void> {
  const config = await getShopConfig();
  config.button = { label, position, enabled };
  await saveShopConfig(config);
}

/** Move product up or down in sort order. */
export async function moveProduct(id: string, direction: 'up' | 'down'): Promise<void> {
  const config = await getShopConfig();
  const entries = Object.entries(config.products).sort(
    ([, a], [, b]) => a.sort_order - b.sort_order,
  );
  const idx = entries.findIndex(([k]) => k === id);
  if (idx < 0) return;

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= entries.length) return;

  // Swap sort_order
  const currentEntry = entries[idx];
  const targetEntry = entries[swapIdx];
  if (currentEntry && targetEntry) {
    const [, current] = currentEntry;
    const [, target] = targetEntry;
    const tmp = current.sort_order;
    current.sort_order = target.sort_order;
    target.sort_order = tmp;
  }

  await saveShopConfig(config);
}

// ─────────────────────────────────────────────────────────────────
// Get enabled products for customers
// ─────────────────────────────────────────────────────────────────

export async function getEnabledProducts(): Promise<
  { ok: true; products: MergedProduct[] } | { ok: false; error: string }
> {
  const conn = await getConnection();
  if (!conn) return { ok: false, error: 'Not connected' };

  const res = await apiFetchProducts(conn);
  if (!res.ok) return { ok: false, error: res.error };

  const config = await getShopConfig();

  const enabled: MergedProduct[] = res.products
    .filter((p) => config.products[p.id]?.enabled)
    .map((p) => {
      const s = config.products[p.id];
      return {
        ...p,
        enabled: true,
        sell_price: s?.sell_price ?? p.your_price,
        custom_name: s?.custom_name || p.name_en,
        custom_desc: s?.custom_desc || '',
        emoji: s?.emoji || '📦',
        sort_order: s?.sort_order ?? 999,
      };
    });

  enabled.sort((a, b) => a.sort_order - b.sort_order);
  return { ok: true, products: enabled };
}

// ─────────────────────────────────────────────────────────────────
// Purchase + Balance
// ─────────────────────────────────────────────────────────────────

export async function purchaseProduct(
  productId: string,
  qty: number,
  buyerInfo: string,
): Promise<
  | { ok: true; codes: string[]; total_price: number; order_id: string; status: string }
  | { ok: false; error: string; balance?: number; required?: number; available?: number }
> {
  const conn = await getConnection();
  if (!conn) return { ok: false, error: 'Not connected to API' };

  const res = await apiPurchase(conn, productId, qty, buyerInfo);
  if (res.ok) {
    return {
      ok: true,
      codes: res.data.codes,
      total_price: res.data.total_price,
      order_id: res.data.order_id,
      status: res.data.status,
    };
  }
  return {
    ok: false,
    error: res.error,
    balance: (res.raw as Record<string, number> | undefined)?.balance,
    required: (res.raw as Record<string, number> | undefined)?.required,
    available: (res.raw as Record<string, number> | undefined)?.available,
  };
}

export async function checkBalance(): Promise<
  { ok: true; balance: number } | { ok: false; error: string }
> {
  const conn = await getConnection();
  if (!conn) return { ok: false, error: 'Not connected' };
  return apiFetchBalance(conn);
}
