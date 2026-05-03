import { InlineKeyboard } from 'grammy';
import { EMOJI, colorModeToStyle, type Lang } from '../../config/index.js';
import { inlineBtn } from './helpers.js';
import { getStateColor } from '../services/settings.js';
import type { DBCategory, DBProduct } from '../types.js';

/**
 * Resolve the premium `custom_emoji_id` for the given EMOJI key.
 * Returns `undefined` when the key is absent or its value is plain
 * unicode (icons in Bot API 9.4 require a real `custom_emoji_id`).
 */
function premiumIconId(key: string): string | undefined {
  const v = EMOJI[key];
  return typeof v === 'object' && v.custom_emoji_id ? v.custom_emoji_id : undefined;
}

/**
 * Categories list — paginated 9 per page (CATEGORIES_PER_PAGE), one
 * category per row to keep the names readable on mobile. Footer
 * mirrors the products list: optional Prev, Refresh, page indicator,
 * optional Next, then a Back row.
 */
export function categoriesKeyboard(
  lang: Lang,
  categories: DBCategory[],
  page: number,
  totalPages: number,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  // Premium icon used as the leading glyph on every category button.
  // Falls back to the `c.emoji` unicode set in admin if the bot
  // owner ever loses Telegram Premium (Telegram silently drops
  // `icon_custom_emoji_id` in that case).
  const catIcon = premiumIconId('orders_product');
  categories.forEach((c) => {
    const label = `${c.emoji ?? '📁'} ${c.name}`;
    kb.text(label, `cat:${c.id}:0`);
    if (catIcon) kb.icon(catIcon);
    kb.row();
  });

  // Footer: Prev | Refresh | page X/Y | Next
  if (page > 0) {
    inlineBtn(kb, lang, 'prev', `shop:p:${page - 1}`);
  }
  inlineBtn(kb, lang, 'refresh', `shop:p:${page}`);
  kb.text(`${page + 1}/${totalPages}`, 'noop:page');
  if (page + 1 < totalPages) {
    inlineBtn(kb, lang, 'next', `shop:p:${page + 1}`);
  }
  kb.row();
  inlineBtn(kb, lang, 'back', 'main:open');
  return kb;
}

/**
 * Product listing for a category, with state-coloured buttons (Bot
 * API 9.4 styles via `getStateColor` — in_stock = blue, out_of_stock
 * = red by default) plus a premium icon per row.
 */
export function productsKeyboard(
  lang: Lang,
  categoryId: number,
  products: DBProduct[],
  page: number,
  totalPages: number,
): InlineKeyboard {
  const kb = new InlineKeyboard();

  const inStockIcon = premiumIconId('orders_product');
  const oosIcon = premiumIconId('gift_invalid');

  products.forEach((p) => {
    const inStock = p.stock > 0;
    // Quantity is shown right next to the product name as
    // `(qty: N)` — for OOS items N is 0, which is reinforced by the
    // red button colour + red icon, so no extra English string is
    // baked into the label.
    const label = `${p.emoji ?? ''} ${p.name} — ${p.price} (qty: ${p.stock})`.trim();
    kb.text(label, inStock ? `prod:${p.id}` : 'noop:oos');
    const iconId = inStock ? inStockIcon : oosIcon;
    if (iconId) kb.icon(iconId);
    const style = colorModeToStyle(getStateColor(inStock ? 'in_stock' : 'out_of_stock'));
    if (style !== undefined) kb.style(style);
    kb.row();
  });

  // Footer: Prev | Refresh | Next
  if (page > 0) {
    inlineBtn(kb, lang, 'prev', `cat:${categoryId}:${page - 1}`);
  }
  inlineBtn(kb, lang, 'refresh', `cat:${categoryId}:${page}`);
  if (page + 1 < totalPages) {
    inlineBtn(kb, lang, 'next', `cat:${categoryId}:${page + 1}`);
  }
  kb.row();
  inlineBtn(kb, lang, 'back', 'shop:home');
  return kb;
}

/**
 * The product-detail page keyboard (qty +/-, buy, topup, note,
 * back). Tapping the qty digit opens the custom-qty entry flow
 * (`qty:<id>:custom`) so the user can type any number 1..QTY_MAX
 * directly instead of mashing +/-.
 */
export function productKeyboard(
  lang: Lang,
  product: DBProduct,
  qty: number,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (product.stock <= 0) {
    inlineBtn(kb, lang, 'out_of_stock', 'noop:oos');
    kb.row();
  } else {
    inlineBtn(kb, lang, 'qty_minus', `qty:${product.id}:-`);
    kb.text(`${qty}`, `qty:${product.id}:custom`);
    inlineBtn(kb, lang, 'qty_plus', `qty:${product.id}:+`);
    kb.row();
    inlineBtn(kb, lang, 'buy_now', `buy:${product.id}`);
    kb.row();
  }
  inlineBtn(kb, lang, 'topup_wallet', 'topup:open');
  inlineBtn(kb, lang, 'view_note', `note:${product.id}`);
  kb.row();
  inlineBtn(
    kb,
    lang,
    'back',
    product.category_id ? `cat:${product.category_id}:0` : 'shop:home',
  );
  return kb;
}

export function shopHomeBackKeyboard(lang: Lang): InlineKeyboard {
  return inlineBtn(new InlineKeyboard(), lang, 'back', 'shop:home');
}
