/**
 * SafwanTiger Shop Bot — central editable config.
 *
 * Almost every user-facing string, button label, emoji, and color
 * mode lives in this single file. The admin can also override any
 * of these values at runtime via the bot itself (see /admin commands)
 * — those overrides are stored in the `settings` table in Supabase
 * and take precedence over the values defined here.
 *
 * Multi-language strings live under `locales/` and are merged into
 * this config at load time. Edit those files to change translations.
 */

import { en } from './locales/en.js';
import { ar } from './locales/ar.js';
import { vi } from './locales/vi.js';

export type Lang = 'en' | 'ar' | 'vi';

/**
 * BUTTON COLOR MODE
 * ------------------------------------------------------------------
 * Telegram's Bot API does NOT expose a true "color" property on
 * inline-keyboard buttons. To indicate state we prefix labels with
 * coloured square emojis. Available modes:
 *   - "blue"   →  🟦  (default available / actionable)
 *   - "green"  →  🟩
 *   - "red"    →  🟥  (used for out-of-stock / destructive)
 *   - "yellow" →  🟨
 *   - "none"   →  no prefix
 */
export const COLOR_PREFIX = {
  blue: '🟦',
  green: '🟩',
  red: '🟥',
  yellow: '🟨',
  none: '',
} as const;
export type ColorMode = keyof typeof COLOR_PREFIX;

/**
 * BUTTON LABELS
 * ------------------------------------------------------------------
 * Stored as i18n keys; the actual translated strings live in
 * `config/locales/<lang>.ts`.
 */
export const BUTTON_KEYS = {
  shop: 'btn.shop',
  topup: 'btn.topup',
  profile: 'btn.profile',
  support: 'btn.support',
  ai_support: 'btn.ai_support',
  main_menu: 'btn.main_menu',
  back: 'btn.back',
  next: 'btn.next',
  prev: 'btn.prev',
  refresh: 'btn.refresh',
  buy_now: 'btn.buy_now',
  topup_wallet: 'btn.topup_wallet',
  view_note: 'btn.view_note',
  qty_plus: 'btn.qty_plus',
  qty_minus: 'btn.qty_minus',
  out_of_stock: 'btn.out_of_stock',
  my_orders: 'btn.my_orders',
  refer: 'btn.refer',
  notifications: 'btn.notifications',
  toggle_stock: 'btn.toggle_stock',
  toggle_announcements: 'btn.toggle_announcements',
  language: 'btn.language',
  deposit_history: 'btn.deposit_history',
  clear_cache: 'btn.clear_cache',
  channel: 'btn.channel',
  back_to_settings: 'btn.back_to_settings',
} as const;

/**
 * COLOR ASSIGNMENTS PER BUTTON
 * The admin can override these via /setcolor <key> <mode>.
 * Default is 'none' for clean, professional buttons. Re-enable with
 * /setcolor <key> <mode> if you want coloured-square indicators.
 */
export const DEFAULT_BUTTON_COLORS: Record<keyof typeof BUTTON_KEYS, ColorMode> = {
  shop: 'none',
  topup: 'none',
  profile: 'none',
  support: 'none',
  ai_support: 'none',
  main_menu: 'none',
  back: 'none',
  next: 'none',
  prev: 'none',
  refresh: 'none',
  buy_now: 'none',
  topup_wallet: 'none',
  view_note: 'none',
  qty_plus: 'none',
  qty_minus: 'none',
  out_of_stock: 'none',
  my_orders: 'none',
  refer: 'none',
  notifications: 'none',
  toggle_stock: 'none',
  toggle_announcements: 'none',
  language: 'none',
  deposit_history: 'none',
  clear_cache: 'none',
  channel: 'none',
  back_to_settings: 'none',
};

/**
 * EMOJI / PREMIUM EMOJI MAP
 * ------------------------------------------------------------------
 * Each entry can be a plain unicode string OR a "premium emoji"
 * descriptor with a `custom_emoji_id` from a Telegram premium emoji
 * pack. When sending messages the bot will attach the proper
 * `custom_emoji` MessageEntity so premium subscribers see the
 * animated/styled version.
 *
 * Admin can update via /setemoji <key> <unicode> [custom_emoji_id]
 */
export type EmojiSpec = string | { unicode: string; custom_emoji_id: string };

export const EMOJI: Record<string, EmojiSpec> = {
  fire: '🔥',
  rocket: '🚀',
  tiger: '🐯',
  cart: '🛍',
  wallet: '🪙',
  wave: '👋',
  bell: '🔔',
  globe: '🌐',
  user: '👤',
  warranty: '🛡️',
  stock: '📦',
  price: '💰',
  total: '🧮',
  back: '◀️',
  next: '▶️',
  refresh: '🔄',
  plus: '➕',
  minus: '➖',
  buy: '✅',
  note: '📝',
  star: '⭐',
  ai: '🤖',
  settings: '⚙️',
  pencil: '✏️',
  megaphone: '📣',
  chart: '📊',
  trash: '🗑',
  reload: '🔁',
  broom: '🧹',
  package: '📦',
  card: '💳',
  folder: '🗂',
  check: '✅',
  cross: '❌',
};

/**
 * LOCALES (i18n)
 * Re-exported from the locales/ folder. Edit those files to change
 * translations. Adding a new language is a 3-step process:
 *   1. add a new file under config/locales/
 *   2. import & add it to the LOCALES map below
 *   3. add the lang code to the `Lang` union and DB CHECK constraint.
 */
export const LOCALES = { en, ar, vi } as const satisfies Record<Lang, Record<string, string>>;

/**
 * MAIN MENU LAYOUT (inline keyboard).
 * Edit here to rearrange the rows.
 *
 *   Row 1: Shop
 *   Row 2: Topup | My Profile
 *   Row 3: Support | AI Support
 */
export const MAIN_MENU_LAYOUT: ReadonlyArray<ReadonlyArray<keyof typeof BUTTON_KEYS>> = [
  ['shop'],
  ['topup', 'profile'],
  ['support', 'ai_support'],
  ['refer', 'channel'],
];

/** Shop pagination size — products per page */
export const PRODUCTS_PER_PAGE = 10;

/** Quantity limits in the product page */
export const QTY_MIN = 1;
export const QTY_MAX = 999;

/** Default language for new users (overridable via env DEFAULT_LANG) */
export const DEFAULT_LANG: Lang = 'en';
