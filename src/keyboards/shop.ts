import { InlineKeyboard } from 'grammy';
import { colorModeToStyle, type Lang } from '../../config/index.js';
import { inlineBtn } from './helpers.js';
import { getStateColor } from '../services/settings.js';
import type { DBCategory, DBProduct } from '../types.js';

/** Categories list — one button per category, two per row. */
export function categoriesKeyboard(lang: Lang, categories: DBCategory[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  categories.forEach((c, i) => {
    kb.text(`${c.emoji ?? '📁'} ${c.name}`, `cat:${c.id}:0`);
    if (i % 2 === 1) kb.row();
  });
  if (categories.length % 2 === 1) kb.row();
  inlineBtn(kb, lang, 'back', 'main:open');
  return kb;
}

/**
 * Product listing for a category, with state-coloured buttons (Bot
 * API 9.4 styles: success for in-stock, danger for out-of-stock)
 * and Next / Refresh footer.
 */
export function productsKeyboard(
  lang: Lang,
  categoryId: number,
  products: DBProduct[],
  page: number,
  totalPages: number,
): InlineKeyboard {
  const kb = new InlineKeyboard();

  products.forEach((p) => {
    const inStock = p.stock > 0;
    // Clean dot indicator instead of coloured square prefix
    const dot = inStock ? '🟢' : '🔴';
    const label = `${dot} ${p.emoji ?? ''} ${p.name} — ${p.price}`.trim();
    kb.text(label, inStock ? `prod:${p.id}` : 'noop:oos');
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

/** The product-detail page keyboard (qty +/-, buy, topup, note, back). */
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
    kb.text(`${qty}`, 'noop:qty');
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
