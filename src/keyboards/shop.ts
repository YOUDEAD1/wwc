import { InlineKeyboard } from 'grammy';
import { EMOJI, colorModeToStyle, type Lang } from '../../config/index.js';
import { applyButtonChrome, inlineBtn, inlineUrl, btn } from './helpers.js';
import { getStateColor } from '../services/settings.js';
import type { DBProduct } from '../types.js';

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
 * Top-level Shop home — paginated all-products list. The categories
 * step has been removed; tapping the Shop button drops the user
 * straight onto this screen.
 *
 * Each in-stock product gets a premium 📦 icon (state colour: blue);
 * out-of-stock items get a red ❌ icon (state colour: red). Footer is
 * an optional Prev, a Refresh that re-fetches the current page, an
 * optional Next, and a Back row that returns to the main menu.
 */
export function shopProductsKeyboard(
  lang: Lang,
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
    // `(qty: N)` — for OOS items N is 0, reinforced by the red
    // colour + red icon.
    const label = `${p.emoji ?? ''} ${p.name} — ${p.price} (qty: ${p.stock})`.trim();
    kb.text(label, inStock ? `prod:${p.id}` : 'noop:oos');
    const iconId = inStock ? inStockIcon : oosIcon;
    if (iconId) kb.icon(iconId);
    const style = colorModeToStyle(getStateColor(inStock ? 'in_stock' : 'out_of_stock'));
    if (style !== undefined) kb.style(style);
    kb.row();
  });

  // Footer: Prev | Refresh | Next | (page indicator)
  if (page > 0) {
    inlineBtn(kb, lang, 'prev', `shop:p:${page - 1}`);
  }
  inlineBtn(kb, lang, 'refresh', `shop:p:${page}`);
  if (page + 1 < totalPages) {
    inlineBtn(kb, lang, 'next', `shop:p:${page + 1}`);
  }
  kb.text(`${page + 1}/${totalPages}`, 'noop:page');
  kb.row();
  inlineBtn(kb, lang, 'back', 'main:open');
  return kb;
}

/**
 * The product-detail page keyboard (qty +/-, buy, topup, note,
 * back). Tapping the qty digit opens the custom-qty entry flow
 * (`qty:<id>:custom`) so the user can type any number 1..QTY_MAX
 * directly instead of mashing +/-.
 *
 * Back returns to the Shop home (page 0) since the categories step
 * has been removed.
 */
export function productKeyboard(
  lang: Lang,
  product: DBProduct,
  qty: number,
  shareUrl: string,
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
  // Topup Wallet removed; replaced with a 1-tap copy/share link to
  // this product. The URL deep-links straight back into the bot's
  // product page so anyone who opens it lands on the same screen.
  inlineUrl(kb, lang, 'share_product', shareUrl);
  inlineBtn(kb, lang, 'view_note', `note:${product.id}`);
  kb.row();
  inlineBtn(kb, lang, 'back', 'shop:home');
  return kb;
}

export function shopHomeBackKeyboard(lang: Lang): InlineKeyboard {
  return inlineBtn(new InlineKeyboard(), lang, 'back', 'shop:home');
}

/**
 * Futuristic inline counter for picking a custom quantity. Shown
 * when the user taps the qty digit on the product page.
 *
 * Layout (qty=23, stock=120):
 *   ┌────────┬────────┬────────┐
 *   │ ⏮ 100 │ ⏪ 10  │ ➖ 1   │
 *   ├────────┴────────┴────────┤
 *   │     📦 23 / 120          │
 *   ├────────┬────────┬────────┤
 *   │ ➕ 1   │ ⏩ 10  │ ⏭ 100 │
 *   ├────────┴────────┴────────┤
 *   │   🎯 Max     🔄 Reset    │
 *   ├──────────────┬───────────┤
 *   │ ✅ Confirm   │  Back     │
 *   └──────────────┴───────────┘
 *
 * Premium icons (`icon_custom_emoji_id`) + Bot API 9.4 button styles
 * are layered on automatically per `BUTTON_ICONS` / `DEFAULT_BUTTON_COLORS`
 * — green increments, neutral decrements, blue qty pill, green
 * Confirm.
 *
 * The numeric ±N buttons emit `qtye:<id>:<signed-number>` callbacks
 * (kept compact on purpose). The semantic actions emit
 * `qtye:<id>:max|reset|confirm`. The Contact Admin button has been
 * removed from this counter per the latest UX request.
 */
export function qtyEditorKeyboard(
  lang: Lang,
  product: DBProduct,
  qty: number,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const id = product.id;

  // Decrement row — coarsest step on the LEFT so it reads naturally
  // as "rewind to less" left-to-right.
  kb.text(btn(lang, 'qty_dec_100'), `qtye:${id}:-100`);
  applyButtonChrome(kb, 'qty_dec_100');
  kb.text(btn(lang, 'qty_dec_10'), `qtye:${id}:-10`);
  applyButtonChrome(kb, 'qty_dec_10');
  kb.text(btn(lang, 'qty_dec_1'), `qtye:${id}:-1`);
  applyButtonChrome(kb, 'qty_dec_1');
  kb.row();

  // Big qty readout — full-width pill so the current value is
  // unmistakably the focal point of the screen.
  const stock = Math.max(0, product.stock);
  const safeQty = Math.max(1, Math.min(qty, stock || qty));
  kb.text(
    btn(lang, 'qty_display')
      .replace('{qty}', String(safeQty))
      .replace('{stock}', String(stock)),
    `qtye:${id}:noop`,
  );
  applyButtonChrome(kb, 'qty_display');
  kb.row();

  // Increment row — finest step on the LEFT, matching the mirror of
  // the decrement row above.
  kb.text(btn(lang, 'qty_inc_1'), `qtye:${id}:+1`);
  applyButtonChrome(kb, 'qty_inc_1');
  kb.text(btn(lang, 'qty_inc_10'), `qtye:${id}:+10`);
  applyButtonChrome(kb, 'qty_inc_10');
  kb.text(btn(lang, 'qty_inc_100'), `qtye:${id}:+100`);
  applyButtonChrome(kb, 'qty_inc_100');
  kb.row();

  // Max + Reset.
  inlineBtn(kb, lang, 'qty_max', `qtye:${id}:max`);
  inlineBtn(kb, lang, 'qty_reset', `qtye:${id}:reset`);
  kb.row();

  // Confirm + Back (both jump back to the product page).
  inlineBtn(kb, lang, 'qty_confirm', `qtye:${id}:confirm`);
  inlineBtn(kb, lang, 'back', `prod:${id}`);
  return kb;
}
