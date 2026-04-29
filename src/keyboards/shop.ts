import { InlineKeyboard } from 'grammy';
import { COLOR_PREFIX, type Lang } from '../../config/index.js';
import { btn } from './helpers.js';
import { getStateColor } from '../services/settings.js';
import { t } from '../i18n/index.js';
import type { DBCategory, DBProduct } from '../types.js';

/** Categories list — one button per category, two per row. */
export function categoriesKeyboard(categories: DBCategory[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  categories.forEach((c, i) => {
    kb.text(`${c.emoji ?? '📁'} ${c.name}`, `cat:${c.id}:0`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

/**
 * Product listing for a category, with state-coloured buttons (blue
 * for in-stock, red for out-of-stock) and Next / Refresh footer.
 */
export function productsKeyboard(
  lang: Lang,
  categoryId: number,
  products: DBProduct[],
  page: number,
  totalPages: number,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const inStockColor = getStateColor('in_stock');
  const outColor = getStateColor('out_of_stock');

  products.forEach((p) => {
    const inStock = p.stock > 0;
    const prefix = COLOR_PREFIX[inStock ? inStockColor : outColor];
    const label = `${prefix} ${p.emoji ?? ''} ${p.name} — ${p.price}`.trim();
    kb.text(label, inStock ? `prod:${p.id}` : 'noop:oos').row();
  });

  // Footer: Prev | Refresh | Next
  if (page > 0) {
    kb.text(btn(lang, 'prev'), `cat:${categoryId}:${page - 1}`);
  }
  kb.text(btn(lang, 'refresh'), `cat:${categoryId}:${page}`);
  if (page + 1 < totalPages) {
    kb.text(btn(lang, 'next'), `cat:${categoryId}:${page + 1}`);
  }
  kb.row();
  kb.text(btn(lang, 'back'), 'shop:home');
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
    kb.text(btn(lang, 'out_of_stock'), 'noop:oos').row();
  } else {
    kb.text(btn(lang, 'qty_minus'), `qty:${product.id}:-`)
      .text(`${qty}`, 'noop:qty')
      .text(btn(lang, 'qty_plus'), `qty:${product.id}:+`)
      .row();
    kb.text(btn(lang, 'buy_now'), `buy:${product.id}`).row();
  }
  kb.text(btn(lang, 'topup_wallet'), 'topup:open')
    .text(btn(lang, 'view_note'), `note:${product.id}`)
    .row();
  kb.text(
    btn(lang, 'back'),
    product.category_id ? `cat:${product.category_id}:0` : 'shop:home',
  );
  return kb;
}

export function shopHomeBackKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard().text(btn(lang, 'back'), 'shop:home');
}

export const _ = t; // satisfy TS unused import in some builds
