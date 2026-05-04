import { InlineKeyboard } from 'grammy';
import { EMOJI, colorModeToStyle, type Lang } from '../../config/index.js';
import { inlineBtn, inlineCopyText } from './helpers.js';
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
 * The product-detail page keyboard. The 🔢 *Custom Quantity* button
 * opens a numeric keypad (digits accumulate — tapping `1` then `1`
 * sets qty to `11`); the inline `➖ N ➕` adder lets the user nudge
 * the qty one step at a time without leaving the product page; and
 * the 🔄 *Refresh* button re-renders the page so the user sees the
 * latest stock / wallet balance.
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
    inlineBtn(kb, lang, 'buy_now', `buy:${product.id}`);
    kb.row();
    // Inline qty stepper: ➖ on the left, the live qty in the
    // middle (tap is a no-op — it's a label), ➕ on the right.
    // Clamping to `[1, min(QTY_MAX, stock)]` happens in the
    // callback handler so the keyboard stays presentation-only.
    inlineBtn(kb, lang, 'qty_minus', `qty:${product.id}:dec`);
    kb.text(String(qty), 'noop:qty');
    inlineBtn(kb, lang, 'qty_plus', `qty:${product.id}:inc`);
    kb.row();
    // 1) Refresh re-fetches and re-renders the product page so any
    // out-of-band stock / wallet balance updates show up. 2) Custom
    // Quantity opens the numeric keypad.
    inlineBtn(kb, lang, 'refresh', `prod:${product.id}`);
    inlineBtn(kb, lang, 'custom_qty', `qty:${product.id}:custom`);
    kb.row();
  }
  // Topup Wallet removed; replaced with a 1-tap *copy* link to
  // this product. Tapping copies the deep-link URL to the user's
  // clipboard with a "Copied" toast — no share-to-chat dialog, no
  // auto-forward. The receiver lands on this product page when they
  // paste the link anywhere.
  inlineCopyText(kb, lang, 'share_product', shareUrl);
  inlineBtn(kb, lang, 'view_note', `note:${product.id}`);
  kb.row();
  inlineBtn(kb, lang, 'back', 'shop:home');
  return kb;
}

export function shopHomeBackKeyboard(lang: Lang): InlineKeyboard {
  return inlineBtn(new InlineKeyboard(), lang, 'back', 'shop:home');
}

/**
 * Numeric keypad for the *Custom Quantity* prompt. Tapping a digit
 * appends to a session buffer (string concat, not arithmetic — so
 * `1` then `1` becomes `11`); ⌫ pops the last digit; 🗑 Clear empties
 * the buffer; ✅ Confirm validates against `[1, min(QTY_MAX, stock)]`
 * and either applies the qty (and returns to the product page) or
 * surfaces the premium-emoji invalid-quantity warning.
 *
 * The user can also send a number directly via the chat input — the
 * text-message handler short-circuits for any active keypad session
 * and reuses the same validation path.
 *
 * Layout:
 *   ┌─────┬─────┬─────┐
 *   │  1  │  2  │  3  │
 *   ├─────┼─────┼─────┤
 *   │  4  │  5  │  6  │
 *   ├─────┼─────┼─────┤
 *   │  7  │  8  │  9  │
 *   ├─────┼─────┼─────┤
 *   │  ⌫  │  0  │ 🗑  │
 *   ├─────┴─────┴─────┤
 *   │   ✅ Confirm     │
 *   ├─────────────────┤
 *   │      Back        │
 *   └─────────────────┘
 *
 * Callbacks:
 *   qkp:<id>:d:<digit>   — push the digit onto the buffer
 *   qkp:<id>:back        — pop the last digit
 *   qkp:<id>:clear       — wipe the buffer
 *   qkp:<id>:confirm     — validate + apply
 *   prod:<id>            — Back / cancel (no apply)
 */
export function qtyKeypadKeyboard(
  lang: Lang,
  product: DBProduct,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const id = product.id;
  const digitRows: ReadonlyArray<ReadonlyArray<string>> = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
  ];
  for (const row of digitRows) {
    for (const d of row) kb.text(d, `qkp:${id}:d:${d}`);
    kb.row();
  }
  // Bottom action row: backspace, 0, clear.
  inlineBtn(kb, lang, 'qty_keypad_back', `qkp:${id}:back`);
  kb.text('0', `qkp:${id}:d:0`);
  inlineBtn(kb, lang, 'qty_keypad_clear', `qkp:${id}:clear`);
  kb.row();
  inlineBtn(kb, lang, 'qty_keypad_confirm', `qkp:${id}:confirm`);
  kb.row();
  inlineBtn(kb, lang, 'back', `prod:${id}`);
  return kb;
}

/**
 * Payment-method picker shown after the user taps *Buy Now* on the
 * product page. Renders the order summary above two buttons:
 * 👛 *Wallet Pay* (charges the user's wallet via the existing
 * `pay:wallet:<id>` flow) and 🪙 *Top Up* (deep-links into the
 * top-up flow at `topup:open`).
 */
export function paymentMethodKeyboard(
  lang: Lang,
  product: DBProduct,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  inlineBtn(kb, lang, 'pay_wallet', `pay:wallet:${product.id}`);
  kb.row();
  inlineBtn(kb, lang, 'pay_topup', 'topup:open');
  kb.row();
  inlineBtn(kb, lang, 'back', `prod:${product.id}`);
  return kb;
}
