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
 * inline-keyboard buttons. The legacy modes below are kept as labels
 * for the admin colour-picker, but the *prefix* is now empty for all
 * of them — the previous coloured-square indicators (🟦🟩🟥🟨) were
 * removed because they cluttered the UI.
 */
export const COLOR_PREFIX = {
  blue: '',
  green: '',
  red: '',
  yellow: '',
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
  channel: 'btn.channel',
  back_to_settings: 'btn.back_to_settings',
  stats: 'btn.stats',
  stats_refresh: 'btn.stats_refresh',
  set_region: 'btn.set_region',
  set_email: 'btn.set_email',
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
  channel: 'none',
  back_to_settings: 'none',
  stats: 'none',
  stats_refresh: 'none',
  set_region: 'none',
  set_email: 'none',
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

  // Premium emojis used on the Stats screen. Telegram premium users
  // see the styled/animated glyph; everyone else sees the unicode
  // fallback declared here.
  stats: { unicode: '📊', custom_emoji_id: '4958506272551863292' },
  stats_refresh: { unicode: '🔄', custom_emoji_id: '5346321684574003384' },
  stats_back: { unicode: '◀️', custom_emoji_id: '5440509136259267820' },
  stats_orders: { unicode: '🧾', custom_emoji_id: '5377660214096974712' },
  stats_items: { unicode: '🛍', custom_emoji_id: '5222208236505028301' },
  stats_spent: { unicode: '💰', custom_emoji_id: '5926961826603472005' },
  stats_last: { unicode: '⏱', custom_emoji_id: '5226597108965993909' },
  stats_deposits: { unicode: '💳', custom_emoji_id: '5443127283898405358' },

  // ---- Profile screen (one premium emoji per row) ----------------
  profile_header: { unicode: '⚙️', custom_emoji_id: '5904630315946611415' },
  profile_id: { unicode: '🆔', custom_emoji_id: '5796517197308236353' },
  profile_first_name: { unicode: '🪪', custom_emoji_id: '5800956853462504394' },
  profile_username: { unicode: '👤', custom_emoji_id: '5370935802844946281' },
  profile_link: { unicode: '🔗', custom_emoji_id: '4958689671950369798' },
  profile_status: { unicode: '🚀', custom_emoji_id: '5213147006561692829' },
  profile_email: { unicode: '📧', custom_emoji_id: '5472239203590888751' },
  profile_balance: { unicode: '💰', custom_emoji_id: '6325416826100519483' },
  profile_language: { unicode: '🌐', custom_emoji_id: '5364021605578071936' },
  profile_region: { unicode: '🗺', custom_emoji_id: '5309748255637118475' },
  profile_joined: { unicode: '📅', custom_emoji_id: '5028418466000930064' },

  // ---- Welcome banner -------------------------------------------
  welcome_banner: { unicode: '👋', custom_emoji_id: '6003746779474956178' },
  welcome_balance: { unicode: '💳', custom_emoji_id: '6084583651738132915' },

  // ---- Email screens (set / change / why) -----------------------
  email_saved_check: { unicode: '✨', custom_emoji_id: '5098088779776787441' },
  email_bracket_l: { unicode: '📩', custom_emoji_id: '6008233706039284019' },
  email_bracket_r: { unicode: '🔧', custom_emoji_id: '6010111371251815589' },
  email_arrow: { unicode: '👇', custom_emoji_id: '5229212516415978792' },
  email_invoice: { unicode: '🧾', custom_emoji_id: '5444856076954520455' },
  email_secure: { unicode: '🔒', custom_emoji_id: '5463413771647069835' },
  email_thanks: { unicode: '🙏', custom_emoji_id: '5465262274031659421' },
  email_invalid: { unicode: '⚠️', custom_emoji_id: '5974083768233760323' },

  // ---- My Deposits screen --------------------------------------
  deposits_title: { unicode: '💳', custom_emoji_id: '6102840685835066490' },
  deposits_payments: { unicode: '💸', custom_emoji_id: '5375312095346704820' },
  deposits_wallet: { unicode: '👛', custom_emoji_id: '4965219701572503640' },
  deposits_empty: { unicode: '📭', custom_emoji_id: '5798937402789597866' },

  // ---- Language button -----------------------------------------
  lang_globe: { unicode: '🌐', custom_emoji_id: '5310249748903504323' },

  // ---- Redeem Gift Code screen --------------------------------
  gift_title: { unicode: '🎁', custom_emoji_id: '4958699241137505132' },
  gift_send: { unicode: '👇', custom_emoji_id: '5287279155702936525' },
  gift_usdt: { unicode: '💵', custom_emoji_id: '5463046637842608206' },
  gift_balance: { unicode: '💰', custom_emoji_id: '4958926882994127612' },
  gift_expired: { unicode: '⏰', custom_emoji_id: '5280821895711697516' },
  gift_invalid: { unicode: '❌', custom_emoji_id: '5095957930537124723' },
  gift_redeemed: { unicode: '✅', custom_emoji_id: '5096035317257864249' },

  // ---- My Orders detail screen --------------------------------
  orders_title: { unicode: '🧾', custom_emoji_id: '5893255507380014983' },
  orders_id: { unicode: '🆔', custom_emoji_id: '5818885490065017876' },
  orders_product: { unicode: '📦', custom_emoji_id: '5069075201950483359' },
  orders_type: { unicode: '💳', custom_emoji_id: '5438496463044752972' },
  orders_qty: { unicode: '🔢', custom_emoji_id: '5926964914684957537' },
  orders_total: { unicode: '💰', custom_emoji_id: '4958926882994127612' },
  orders_when: { unicode: '🗓', custom_emoji_id: '5800810214689084012' },
  orders_status: { unicode: '🛡', custom_emoji_id: '6179461085624536942' },
  orders_note: { unicode: '📝', custom_emoji_id: '5778299625370817409' },
  orders_warranty: { unicode: '⏰', custom_emoji_id: '5280821895711697516' },
  orders_received: { unicode: '✅', custom_emoji_id: '5096035317257864249' },
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
