import { InlineKeyboard } from 'grammy';
import { EMOJI, colorModeToStyle, type Lang } from '../../config/index.js';
import { inlineBtn, inlineCopyText } from './helpers.js';
import { getStateColor, getCategoryColor } from '../services/settings.js';
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
 * Top-level Shop home â€” paginated all-products list. The categories
 * step has been removed; tapping the Shop button drops the user
 * straight onto this screen.
 *
 * Each row renders as `{name} - {price} USDT (Stock: {N or âˆž})` to
 * match the bot-owner reference UX (pic 1). The row icon is the
 * per-product premium emoji_id when set, falling back to the
 * default ðŸ“¦ (in-stock) / red âŒ (out-of-stock) glyphs.
 *
 * Out-of-stock items remain tappable â€” tapping opens the product
 * page where the green Buy Now turns into a red âŒ Buy Now that
 * pops up the "contact admin to restock" alert.
 */
export function shopProductsKeyboard(
  lang: Lang,
  products: DBProduct[],
  page: number,
  totalPages: number,
): InlineKeyboard {
  const kb = new InlineKeyboard();

  const defaultInStockIcon = premiumIconId('orders_product');
  const oosIcon = premiumIconId('gift_invalid');

  products.forEach((p) => {
    const inStock = p.unlimited_stock || p.stock > 0;
    // Stock label format matches pic 1: `(Stock: âˆž)` for unlimited
    // products, otherwise `(Stock: N)` with the actual count.
    const stockLabel = p.unlimited_stock ? 'âˆž' : String(p.stock);
    // Drop the leading unicode emoji from the label when a per-
    // product premium icon is configured â€” the icon renders to the
    // left of the label so we don't want a duplicate glyph.
    const hasPremiumIcon = Boolean(p.emoji_id);
    const namePrefix = hasPremiumIcon ? '' : (p.emoji ? `${p.emoji} ` : '');
    const label = `${namePrefix}${p.name} - ${p.price} USDT (Stock: ${stockLabel})`.trim();
    // Out-of-stock products still navigate to the product page so
    // the user sees details + a popup-armed Buy Now button.
    kb.text(label, `prod:${p.id}`);
    const iconId = inStock
      ? p.emoji_id ?? defaultInStockIcon
      : p.emoji_id ?? oosIcon;
    if (iconId) kb.icon(iconId);
    // Colour resolution:
    //   â€¢ Out-of-stock â†’ state colour wins (red by default â€” the
    //     red rail is a hard signal the buyer shouldn't tap).
    //   â€¢ In-stock â†’ category colour set by the admin via
    //     /admin â†’ Customize â†’ ðŸŽ¨ Set Color â†’ ðŸ“‚ Product Categories
    //     wins, falling back to the in-stock state colour (blue
    //     by default) when that category has no override.
    let mode = getStateColor(inStock ? 'in_stock' : 'out_of_stock');
    if (inStock && p.category_id != null) {
      const catMode = getCategoryColor(p.category_id);
      if (catMode !== 'none') mode = catMode;
    }
    const style = colorModeToStyle(mode);
    if (style !== undefined) kb.style(style);
    kb.row();
    // Add blank space between products
    kb.row();
  });

  // Footer layout (bot-owner spec v2): the page indicator always
  // lives in the middle, the page-nav arrow takes its natural side
  // (Prev on the left, Next on the right), and Refresh fills the
  // opposite end of the nav row. Back is back to its classic full-
  // width row at the very bottom â€” the biggest, easiest tap target.
  //
  //  â€¢ First page  â†’  [Refresh]    [1/N]   [Next]
  //  â€¢ Last  page  â†’  [Prev]       [N/N]   [Refresh]
  //  â€¢ Middle page â†’  [Prev]       [k/N]   [Next]   (nav row)
  //                   [Refresh]                     (dedicated row)
  //  â€¢ Single page â†’  [Refresh]    [1/1]
  //
  //  Bottom row, every case: [Back] (full width).
  const hasPrev = page > 0;
  const hasNext = page + 1 < totalPages;
  const indicator = `${page + 1}/${totalPages}`;
  if (hasPrev && hasNext) {
    // Middle page: keep the nav row symmetric, push Refresh down so
    // both arrows stay flush against their natural edge.
    inlineBtn(kb, lang, 'prev', `shop:p:${page - 1}`);
    kb.text(indicator, 'noop:page');
    inlineBtn(kb, lang, 'next', `shop:p:${page + 1}`);
    kb.row();
    inlineBtn(kb, lang, 'refresh', `shop:p:${page}`);
    kb.row();
  } else if (hasNext) {
    // First page of a multi-page list.
    inlineBtn(kb, lang, 'refresh', `shop:p:${page}`);
    kb.text(indicator, 'noop:page');
    inlineBtn(kb, lang, 'next', `shop:p:${page + 1}`);
    kb.row();
  } else if (hasPrev) {
    // Last page of a multi-page list.
    inlineBtn(kb, lang, 'prev', `shop:p:${page - 1}`);
    kb.text(indicator, 'noop:page');
    inlineBtn(kb, lang, 'refresh', `shop:p:${page}`);
    kb.row();
  } else {
    // Single-page list â€” no nav arrows to render.
    inlineBtn(kb, lang, 'refresh', `shop:p:${page}`);
    kb.text(indicator, 'noop:page');
    kb.row();
  }
  // Bottom row: full-width Back, like the old layout used to be.
  inlineBtn(kb, lang, 'back', 'main:open');
  return kb;
}

/**
 * The product-detail page keyboard. The ðŸ”¢ *Custom Quantity* button
 * opens a numeric keypad (digits accumulate â€” tapping `1` then `1`
 * sets qty to `11`); the inline `âž– N âž•` adder lets the user nudge
 * the qty one step at a time without leaving the product page; and
 * the ðŸ”„ *Refresh* button re-renders the page so the user sees the
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
  const inStock = product.unlimited_stock || product.stock > 0;
  if (!inStock) {
    // Out-of-stock UX: keyboard still shows a "Buy Now" button with
    // the cross emoji per the bot-owner spec. Tapping it pops up
    // the "contact admin to restock" alert instead of a silent ack.
    inlineBtn(kb, lang, 'out_of_stock', 'noop:oos');
    kb.row();
  } else {
    // Inline qty stepper first: âž– on the left, the live qty in the
    // middle (tap is a no-op â€” it's a label), âž• on the right.
    // Clamping to `[1, min(QTY_MAX, stock)]` happens in the
    // callback handler so the keyboard stays presentation-only.
    inlineBtn(kb, lang, 'qty_minus', `qty:${product.id}:dec`);
    kb.text(String(qty), 'noop:qty');
    inlineBtn(kb, lang, 'qty_plus', `qty:${product.id}:inc`);
    kb.row();
    // Buy Now sits directly under the stepper so the user's tap
    // path is "set qty â†’ buy".
    inlineBtn(kb, lang, 'buy_now', `buy:${product.id}`);
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
  // clipboard with a "Copied" toast â€” no share-to-chat dialog, no
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
 * appends to a session buffer (string concat, not arithmetic â€” so
 * `1` then `1` becomes `11`); âŒ« pops the last digit; ðŸ—‘ Clear empties
 * the buffer; âœ… Confirm validates against `[1, min(QTY_MAX, stock)]`
 * and either applies the qty (and returns to the product page) or
 * surfaces the premium-emoji invalid-quantity warning.
 *
 * The user can also send a number directly via the chat input â€” the
 * text-message handler short-circuits for any active keypad session
 * and reuses the same validation path.
 *
 * Layout:
 *   â”Œâ”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”
 *   â”‚  1  â”‚  2  â”‚  3  â”‚
 *   â”œâ”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”¤
 *   â”‚  4  â”‚  5  â”‚  6  â”‚
 *   â”œâ”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”¤
 *   â”‚  7  â”‚  8  â”‚  9  â”‚
 *   â”œâ”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”¤
 *   â”‚  âŒ«  â”‚  0  â”‚ ðŸ—‘  â”‚
 *   â”œâ”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”¤
 *   â”‚ 25  â”‚ 50  â”‚ 100 â”‚
 *   â”œâ”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”¤
 *   â”‚ ðŸŽ¯ Max â”‚ âœ… Confirmâ”‚
 *   â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
 *   â”‚      Back        â”‚
 *   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
 *
 * Callbacks:
 *   qkp:<id>:d:<digit>   â€” push the digit onto the buffer
 *   qkp:<id>:back        â€” pop the last digit
 *   qkp:<id>:clear       â€” wipe the buffer
 *   qkp:<id>:p:<value>   â€” snap buffer to a preset (25 / 50 / 100),
 *                          clamped down to min(QTY_MAX, stock)
 *   qkp:<id>:max         â€” fill buffer with min(QTY_MAX, stock)
 *   qkp:<id>:confirm     â€” validate + apply
 *   prod:<id>            â€” Back / cancel (no apply)
 */

/**
 * Quick-pick quantity presets shown above the Max / Confirm row on
 * the custom-quantity keypad. Each tap snaps the digit buffer to the
 * preset value (clamped down to `min(QTY_MAX, stock)` so a small-
 * stock product never silently exceeds availability). Order them
 * smallest-to-largest left-to-right so the row reads naturally.
 */
export const QTY_KEYPAD_PRESETS = [25, 50, 100] as const;

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
  // Quick-pick preset row â€” saves the bulk-buy user from tapping
  // each digit individually. Snapping happens in the keypad action
  // handler in `src/handlers/shop.ts` (clamps down to the user's
  // purchasable ceiling).
  for (const preset of QTY_KEYPAD_PRESETS) {
    kb.text(String(preset), `qkp:${id}:p:${preset}`);
  }
  kb.row();
  // Max + Confirm share a row so the bulk-buy gesture (Max â†’ Confirm)
  // is two adjacent taps. The action handler in
  // `src/handlers/shop.ts` snaps the buffer to
  // `min(QTY_MAX, stock)` (or `QTY_MAX` for unlimited-stock items)
  // before re-rendering the card.
  inlineBtn(kb, lang, 'qty_keypad_max', `qkp:${id}:max`);
  inlineBtn(kb, lang, 'qty_keypad_confirm', `qkp:${id}:confirm`);
  kb.row();
  inlineBtn(kb, lang, 'back', `prod:${id}`);
  return kb;
}

/**
 * Payment-method picker shown after the user taps *Buy Now* on the
 * product page. Renders the order summary above three buttons:
 * ðŸ‘› *Wallet Pay* (charges the user's wallet via the existing
 * `pay:wallet:<id>` flow), ðŸ’¸ *Pay Directly* (Phase B per-order
 * crypto direct-pay, fulfils the order on tx confirmation without
 * touching the wallet), and ðŸª™ *Top Up* (deep-links into the top-up
 * flow at `topup:open`).
 */
export function paymentMethodKeyboard(
  lang: Lang,
  product: DBProduct,
  options?: { showReferralPay?: boolean },
): InlineKeyboard {
  const kb = new InlineKeyboard();
  inlineBtn(kb, lang, 'pay_wallet', `pay:wallet:${product.id}`);
  kb.row();
  inlineBtn(kb, lang, 'pay_direct', `pay:direct:${product.id}`);
  kb.row();
  // Top-up Wallet from the buy flow carries the originating product
  // id so the topup screen's Back button returns the user to THIS
  // payment-method picker (`buy:<productId>`) instead of dropping
  // them on the main menu.
  inlineBtn(kb, lang, 'pay_topup', `topup:open:from:buy:${product.id}`);
  kb.row();
  if (options?.showReferralPay) {
    inlineBtn(kb, lang, 'pay_referral', `pay:referral:${product.id}`);
    kb.row();
  }
  inlineBtn(kb, lang, 'back', `prod:${product.id}`);
  return kb;
}
