import { InlineKeyboard, type Api } from 'grammy';
import { readSetting, setSetting, addCategory, addProduct, getProduct, listUsersForAnnouncement, listUsersForStockAlert } from '../db/queries.js';
import { supabase } from '../db/supabase.js';
import { logger } from '../logger.js';
import { getProductEmoji } from '../../config/index.js';
import { publicFeedBotUrl } from './publicFeed.js';
import { stripCustomEmojiTags } from './premium.js';
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
  original_desc?: string;     // الوصف الأصلي من الـ API لمزامنة التغييرات
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

export async function syncProducts(
  api?: Api,
): Promise<
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
        enabled: true,
        sell_price: p.your_price,
        custom_name: p.name_en,
        custom_desc: '',
        emoji: p.emoji || getProductEmoji(p.name_en),
        emoji_id: p.emoji_id || undefined,
        sort_order: nextOrder++,
        original_name: p.name_en,
        original_desc: p.description || '',
        base_price: p.base_price,
        is_manual: p.is_manual,
      };
    } else {
      // Update API-side data
      const existing = config.products[p.id];
      if (existing) {
        if (existing.custom_name === existing.original_name) {
          existing.custom_name = p.name_en;
        }

        if (existing.original_desc === undefined) {
          existing.original_desc = existing.custom_desc;
        }

        if (existing.custom_desc === existing.original_desc) {
          existing.custom_desc = '';
        }

        existing.original_name = p.name_en;
        existing.original_desc = p.description || '';
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
        .select('id, emoji, emoji_id, price, stock, active')
        .eq('note', `[API_PRODUCT_ID:${p.id}]`);

      const existingProd = matchingProds && matchingProds.length > 0 ? matchingProds[0] : null;

      if (matchingProds && matchingProds.length > 1) {
        const idsToDelete = matchingProds.slice(1).map((x) => x.id);
        await supabase.from('products').delete().in('id', idsToDelete);
      }

      // Determine stock and unlimited status safely to prevent null PostgreSQL database violations
      const isUnlimited =
        p.stock === null ||
        p.stock === undefined ||
        p.stock === 'unlimited' ||
        (typeof p.stock === 'number' && p.stock < 0);
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
        const oldPrice = Number(existingProd.price);
        const oldStock = Number(existingProd.stock);
        const wasActive = Boolean(existingProd.active);

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

        if (api) {
          if ((oldStock <= 0 || !wasActive) && stockVal > 0 && s.enabled) {
            await handleProductSyncAlerts(api, 'restock', existingProd.id, s.custom_name || p.name_en, priceVal);
          } else if (wasActive && s.enabled && priceVal < oldPrice) {
            await handleProductSyncAlerts(api, 'discount', existingProd.id, s.custom_name || p.name_en, priceVal, oldPrice);
          }
        }
      } else {
        // Insert as a new standard local database product
        const noteTag = `[API_PRODUCT_ID:${p.id}]`;
        const newProd = await addProduct({
          category_id: categoryId,
          name: s.custom_name || p.name_en,
          price: priceVal,
          stock: stockVal,
          description: s.custom_desc || p.description || '',
          note: noteTag,
          emoji: s.emoji || p.emoji || getProductEmoji(p.name_en),
          emoji_id: s.emoji_id || p.emoji_id || null,
          unlimited_stock: isUnlimited,
          active: s.enabled,
        });

        if (api && s.enabled) {
          await handleProductSyncAlerts(api, 'new', newProd.id, s.custom_name || p.name_en, priceVal);
        }
      }
    }

    // Deactivate local products that are no longer returned by the API
    const activeApiProductIds = new Set(res.products.map((p) => String(p.id)));
    const { data: localApiProducts } = await supabase
      .from('products')
      .select('id, note, active')
      .eq('category_id', categoryId);

    if (localApiProducts) {
      for (const localP of localApiProducts) {
        if (!localP.note) continue;
        const match = localP.note.match(/\[API_PRODUCT_ID:([^\]]+)\]/);
        if (match) {
          const apiId = match[1];
          if (apiId && !activeApiProductIds.has(apiId)) {
            if (localP.active) {
              await supabase
                .from('products')
                .update({ active: false })
                .eq('id', localP.id);
              logger.info(
                { localProductId: localP.id, apiProductId: apiId },
                'Deactivated local API Shop product because it was hidden/removed upstream',
              );
            }
          }
        }
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
        .eq('note', `[API_PRODUCT_ID:${id}]`);
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

export async function tryApiShopAutoOrder(args: {
  localProductId: number;
  qty: number;
  localOrderId: number;
  buyerInfo: string;
  onFailure?: (failure: { error: string; lowBalance: boolean }) => void | Promise<void>;
}): Promise<{ items: string[]; status: string | null; supplierName: string } | null> {
  const product = await getProduct(args.localProductId).catch(() => null);
  if (!product || !product.note) return null;

  const match = product.note.match(/\[API_PRODUCT_ID:([^\]]+)\]/);
  if (!match) return null;

  const apiProductId = match[1];
  if (!apiProductId) return null;
  try {
    const res = await purchaseProduct(apiProductId, args.qty, args.buyerInfo);
    if (!res.ok) {
      const isLowBalance =
        res.error.toLowerCase().includes('balance') ||
        res.error.toLowerCase().includes('insufficient') ||
        res.balance !== undefined;
      await args.onFailure?.({
        error: res.error,
        lowBalance: isLowBalance,
      });
      return null;
    }
    return {
      items: res.codes,
      status: res.status,
      supplierName: 'API Shop',
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err, localProductId: args.localProductId, orderId: args.localOrderId }, 'tryApiShopAutoOrder failed');
    await args.onFailure?.({
      error,
      lowBalance: false,
    });
    return null;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function makeProductButton(productId: number, text: string): InlineKeyboard {
  const url = publicFeedBotUrl(`prod_${productId}`);
  return new InlineKeyboard().url(text, url);
}

async function sendBroadcast(
  api: Api,
  recipients: { telegram_id: number }[],
  html: string,
  replyMarkup?: InlineKeyboard,
) {
  let ok = 0;
  let fail = 0;
  for (const r of recipients) {
    try {
      await api.sendMessage(r.telegram_id, html, {
        parse_mode: 'HTML',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
      ok++;
    } catch (err) {
      try {
        await api.sendMessage(r.telegram_id, stripCustomEmojiTags(html), {
          parse_mode: 'HTML',
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        });
        ok++;
      } catch (retryErr) {
        fail++;
        logger.warn({ err: retryErr, user: r.telegram_id }, 'API Shop product broadcast failed');
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
  logger.info({ ok, fail }, 'API Shop product broadcast finished');
}

export async function handleProductSyncAlerts(
  api: Api,
  type: 'new' | 'restock' | 'discount',
  productId: number,
  productName: string,
  price: number,
  oldPrice?: number,
) {
  let html = '';
  let buttonText = '';

  if (type === 'new') {
    html = [
      '🎉 <b>منتج جديد متوفر الآن!</b>',
      '',
      '✨ تم إضافة منتج جديد إلى المتجر:',
      `📦 <b>المنتج:</b> <b>${escapeHtml(productName)}</b>`,
      `💵 <b>السعر:</b> <b>${price.toFixed(2)} USDT</b>`,
      '',
      '👇 اضغط على الزر أدناه لعرض المنتج والشراء مباشرة:',
    ].join('\n');
    buttonText = '🛒 شراء الآن | Buy Now';
  } else if (type === 'restock') {
    html = [
      '⚡️ <b>إعادة توفر المنتج!</b>',
      '',
      '🔥 تم إعادة تعبئة المخزون للمنتج:',
      `📦 <b>المنتج:</b> <b>${escapeHtml(productName)}</b>`,
      `💵 <b>السعر:</b> <b>${price.toFixed(2)} USDT</b>`,
      '',
      '👇 اضغط على الزر أدناه لعرض المنتج والشراء مباشرة:',
    ].join('\n');
    buttonText = '🛒 شراء الآن | Buy Now';
  } else if (type === 'discount') {
    html = [
      '📉 <b>تخفيض كبير في السعر!</b>',
      '',
      '💸 تم تخفيض سعر المنتج:',
      `📦 <b>المنتج:</b> <b>${escapeHtml(productName)}</b>`,
      `💰 <b>السعر الجديد:</b> <b>${price.toFixed(2)} USDT</b> (سابقاً: ${oldPrice?.toFixed(2)} USDT)`,
      '',
      '👇 اضغط على الزر أدناه لعرض المنتج والاستفادة من العرض:',
    ].join('\n');
    buttonText = '💸 عرض المنتج | View Offer';
  }

  const replyMarkup = makeProductButton(productId, buttonText);

  let recipients: { telegram_id: number }[] = [];
  if (type === 'discount') {
    recipients = await listUsersForAnnouncement().catch(() => []);
  } else {
    recipients = await listUsersForStockAlert().catch(() => []);
  }

  if (recipients.length > 0) {
    logger.info({ type, productId, recipientsCount: recipients.length }, 'Starting background product broadcast');
    void sendBroadcast(api, recipients, html, replyMarkup).catch((err) => {
      logger.error({ err }, 'sendBroadcast background execution failed');
    });
  }
}
