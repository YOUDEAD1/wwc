/**
 * Shared "Top Up Wallet / Select Payment Method" keyboard layout.
 *
 * Renders the per-method buttons in the order shown on the canonical
 * mock-up:
 *
 *   ┌─────────────────────────┐
 *   │ 🟡 Binance Pay          │  full row
 *   ├─────────────────────────┤
 *   │ 🟢 USDT (BEP-20)        │  full row
 *   ├─────────────┬───────────┤
 *   │ 🔵 TON      │ 🔴 Tron   │  paired row
 *   ├─────────────┴───────────┤
 *   │ 💡 Others (primary blue)│  full row
 *   ├─────────────────────────┤
 *   │ Back                    │  full row
 *   └─────────────────────────┘
 *
 * Methods are rendered in the order returned by `listPaymentMethods()`.
 * Adjacent TRC-20 / TON rows are paired into a single keyboard row to
 * mirror the mock; everything else is one button per row.
 *
 * Each button picks up:
 *   - per-method `color_mode` → Bot API 9.4 button style (admin-edit
 *     via `setPaymentMethodColor`).
 *   - per-method `emoji_id` → Bot API 9.4 `icon_custom_emoji_id`,
 *     falling back to `emoji_unicode` then to a per-provider default
 *     glyph (admin-edit via `setPaymentMethodIcon`).
 *
 * The keyboard always ends with an "Others" button (callback specified
 * by the caller) and a Back button (callback specified by the caller).
 */

import { InlineKeyboard } from 'grammy';
import type { Lang } from '../../config/index.js';
import { inlineBtn } from './helpers.js';
import { colorModeToStyle, type ColorMode } from '../../config/index.js';
import type { DBPaymentMethod, PaymentProvider } from '../types.js';

/** Default unicode glyph per provider when no per-row icon is set. */
const PROVIDER_GLYPHS: Record<PaymentProvider, string> = {
  manual: '💳',
  binance_pay: '🟡',
  usdt_trc20: '🔴',
  usdt_bep20: '🟢',
  usdt_ton: '🔵',
  ltc: '⚪',
};

function labelFor(m: DBPaymentMethod): string {
  const glyph = m.emoji_unicode && m.emoji_unicode.length > 0
    ? m.emoji_unicode
    : PROVIDER_GLYPHS[m.provider];
  return `${glyph} ${m.name}`;
}

function applyChrome(kb: InlineKeyboard, m: DBPaymentMethod): void {
  if (m.emoji_id && m.emoji_id.length > 0) {
    kb.icon(m.emoji_id);
  }
  const style = colorModeToStyle(m.color_mode as ColorMode);
  if (style !== undefined) kb.style(style);
}

/**
 * Push one method button onto the keyboard with its admin-configured
 * chrome applied. Caller decides row breaks.
 */
function pushMethod(
  kb: InlineKeyboard,
  m: DBPaymentMethod,
  callbackData: string,
): void {
  kb.text(labelFor(m), callbackData);
  applyChrome(kb, m);
}

/**
 * Build the canonical payment-method keyboard.
 *
 *   - `methods` — payment methods to render.
 *   - `methodCallback` — given a method id, returns the callback data
 *      to attach to its button (e.g. `(id) => `topup:method:${id}`).
 *   - `othersCallback` — callback for the "Others" button.
 *   - `backCallback` — callback for the trailing "Back" button.
 */
export function paymentMethodsKeyboard(
  lang: Lang,
  methods: DBPaymentMethod[],
  methodCallback: (id: number) => string,
  othersCallback: string,
  backCallback: string,
): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Greedy paired-row layout: when two consecutive methods are
  // 'usdt_trc20' / 'usdt_ton' (or vice-versa), put them on the same
  // keyboard row to mirror the photo's TON | Tron split. Everything
  // else goes one-per-row.
  const PAIR_PROVIDERS = new Set<PaymentProvider>(['usdt_trc20', 'usdt_ton']);
  let i = 0;
  while (i < methods.length) {
    const m = methods[i]!;
    const next = methods[i + 1];
    if (
      next &&
      PAIR_PROVIDERS.has(m.provider) &&
      PAIR_PROVIDERS.has(next.provider)
    ) {
      pushMethod(kb, m, methodCallback(m.id));
      pushMethod(kb, next, methodCallback(next.id));
      kb.row();
      i += 2;
      continue;
    }
    pushMethod(kb, m, methodCallback(m.id));
    kb.row();
    i += 1;
  }

  // Others — primary-blue button. Goes through `inlineBtn` so the
  // configured premium icon (`btnicon.paymethod_others` or the
  // compile-time default mapping to `EMOJI.paymethod_others`) is
  // applied via Bot API 9.4 `icon_custom_emoji_id`. Premium
  // subscribers see the animated glyph; non-premium users see the
  // unicode fallback baked into the locale label.
  inlineBtn(kb, lang, 'paymethod_others', othersCallback);
  kb.row();
  // Back — same `inlineBtn` treatment so the row gets the configured
  // colour (red by default — matches the Cancel-pay arrow on the
  // wallet-confirm card) plus the premium back-arrow icon.
  inlineBtn(kb, lang, 'paymethod_back', backCallback);
  return kb;
}
