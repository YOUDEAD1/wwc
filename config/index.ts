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
 * Bot API 9.4 (Feb 2026) introduced a real `style` field on
 * `InlineKeyboardButton` / `KeyboardButton`. We map the legacy
 * config modes to those style values:
 *
 *   blue   → 'primary'   (Telegram's accent / blue)
 *   green  → 'success'   (green)
 *   red    → 'danger'    (red)
 *   yellow → no equivalent — falls back to the app default
 *   none   → no style    (app default)
 *
 * The prefix strings remain empty so older keyboards that still
 * call the `colored()` helper don't add stray glyphs in front of
 * labels — the colouring is now done at the button level instead.
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
 * Bot API 9.4 button `style` values, returned by
 * `colorModeToStyle()`. Returning `undefined` means "leave the
 * style off" (the app default is used).
 */
export type ButtonStyle = 'primary' | 'success' | 'danger';

export function colorModeToStyle(mode: ColorMode): ButtonStyle | undefined {
  switch (mode) {
    case 'blue':
      return 'primary';
    case 'green':
      return 'success';
    case 'red':
      return 'danger';
    case 'yellow':
    case 'none':
    default:
      return undefined;
  }
}

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

  // ---- Email hub & sub-screens ---------------------------------
  email_settings: 'btn.email.settings',
  email_set: 'btn.email.set',
  email_change: 'btn.email.change',
  email_delete: 'btn.email.delete',
  email_delete_confirm: 'btn.email.delete.confirm',
  email_delete_cancel: 'btn.email.delete.cancel',
  email_why: 'btn.email.why',
  email_know_more: 'btn.email.know_more',

  // ---- Notifications toggles (state-aware labels) --------------
  notify_stock_on: 'btn.notify.stock.on',
  notify_stock_off: 'btn.notify.stock.off',
  notify_ann_on: 'btn.notify.ann.on',
  notify_ann_off: 'btn.notify.ann.off',
  notify_wallet_on: 'btn.notify.wallet.on',
  notify_wallet_off: 'btn.notify.wallet.off',

  // ---- Send-PDF buttons ---------------------------------------
  send_pdf_stats: 'btn.send_pdf.stats',
  send_pdf_deposits: 'btn.send_pdf.deposits',
  send_pdf_orders: 'btn.send_pdf.orders',

  // ---- Refer screen --------------------------------------------
  copy_link: 'btn.copy_link',

  // ---- Redeem Gift Code ---------------------------------------
  redeem: 'btn.redeem',
  buy_code: 'btn.buy_code',

  // ---- Order-detail screen ------------------------------------
  orders_open_link: 'btn.orders_open_link',
  orders_back_list: 'btn.orders_back_list',

  // ---- Support section ----------------------------------------
  support_contact: 'support.btn.contact',
  support_live: 'support.btn.live',
  support_cancel: 'support.btn.cancel',
  support_end_session: 'support.btn.end_session',

  // ---- Language picker ---------------------------------------
  language_en: 'btn.language.english',
  language_ar: 'btn.language.arabic',
  language_vi: 'btn.language.vietnamese',

  // ---- Region picker -----------------------------------------
  region_clear: 'btn.region.clear',

  // ---- Quantity editor (replaces the type-a-number prompt) ----
  qty_max: 'btn.qty.max',
  qty_reset: 'btn.qty.reset',
  qty_confirm: 'btn.qty.confirm',
  contact_admin: 'btn.contact_admin',
} as const;

/**
 * COLOR ASSIGNMENTS PER BUTTON
 * Maps to Bot API 9.4 button styles via `colorModeToStyle()`:
 *   blue → primary, green → success, red → danger, yellow/none → app default.
 * The admin can override these at runtime via /setcolor <key> <mode>.
 */
export const DEFAULT_BUTTON_COLORS: Record<keyof typeof BUTTON_KEYS, ColorMode> = {
  shop: 'green',
  topup: 'blue',
  profile: 'none',
  support: 'blue',
  ai_support: 'blue',
  main_menu: 'none',
  back: 'none',
  next: 'none',
  prev: 'none',
  refresh: 'none',
  buy_now: 'green',
  topup_wallet: 'blue',
  view_note: 'none',
  qty_plus: 'none',
  qty_minus: 'none',
  out_of_stock: 'red',
  my_orders: 'none',
  refer: 'green',
  notifications: 'none',
  toggle_stock: 'none',
  toggle_announcements: 'none',
  language: 'none',
  deposit_history: 'none',
  channel: 'blue',
  back_to_settings: 'none',
  stats: 'none',
  stats_refresh: 'none',
  set_region: 'none',
  set_email: 'none',

  // Email hub: Set/Change blue, Delete red, Why neutral.
  email_settings: 'none',
  email_set: 'green',
  email_change: 'blue',
  email_delete: 'red',
  email_delete_confirm: 'red',
  email_delete_cancel: 'none',
  email_why: 'none',
  email_know_more: 'blue',

  // Notification toggles: ON green, OFF neutral so the difference reads at a glance.
  notify_stock_on: 'green',
  notify_stock_off: 'none',
  notify_ann_on: 'green',
  notify_ann_off: 'none',
  notify_wallet_on: 'green',
  notify_wallet_off: 'none',

  // Send-PDF buttons: blue (matches the existing .primary() styling).
  send_pdf_stats: 'blue',
  send_pdf_deposits: 'blue',
  send_pdf_orders: 'blue',

  // Refer copy-link: green (positive action).
  copy_link: 'green',

  // Redeem flow.
  redeem: 'none',
  buy_code: 'blue',

  // Order detail.
  orders_open_link: 'blue',
  orders_back_list: 'none',

  // Support section.
  support_contact: 'blue',
  support_live: 'green',
  support_cancel: 'red',
  support_end_session: 'red',

  // Language picker — neutral (admin can colour them per language).
  language_en: 'none',
  language_ar: 'none',
  language_vi: 'none',

  // Region clear: destructive.
  region_clear: 'red',

  // Quantity editor.
  qty_max: 'green',
  qty_reset: 'none',
  qty_confirm: 'green',
  contact_admin: 'blue',
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

  // ---- Notifications screen (premium emojis only render in body
  //      text — inline-keyboard buttons fall back to the unicode glyph).
  notify_bell: { unicode: '🔔', custom_emoji_id: '5215372534060428125' },
  notify_stock: { unicode: '📢', custom_emoji_id: '6082236434930998087' },
  notify_info: { unicode: '💬', custom_emoji_id: '6082420431329957672' },
  notify_wallet: { unicode: '💰', custom_emoji_id: '6084800852529258692' },
  notify_on: { unicode: '🟢', custom_emoji_id: '5213147006561692829' },
  notify_off: { unicode: '🔕', custom_emoji_id: '5843822645711212265' },

  // ---- Refer & Earn screen -------------------------------------
  refer_title: { unicode: '🎁', custom_emoji_id: '5053473385355412667' },
  refer_user: { unicode: '👤', custom_emoji_id: '5332724926216428039' },
  refer_coin: { unicode: '🪙', custom_emoji_id: '6325416826100519483' },
  refer_transferred: { unicode: '🔁', custom_emoji_id: '5832493956503442338' },
  refer_withdrawn: { unicode: '💵', custom_emoji_id: '5841484860652263006' },

  // ---- Language picker -----------------------------------------
  lang_left: { unicode: '🌐', custom_emoji_id: '5330422213860407355' },
  lang_right: { unicode: '🗣', custom_emoji_id: '5818984364507139347' },

  // ---- Email screens (set / change / why) -----------------------
  email_saved_check: { unicode: '✨', custom_emoji_id: '5098088779776787441' },
  email_bracket_l: { unicode: '📩', custom_emoji_id: '6008233706039284019' },
  email_bracket_r: { unicode: '🔧', custom_emoji_id: '6010111371251815589' },
  email_arrow: { unicode: '👇', custom_emoji_id: '5229212516415978792' },
  email_invoice: { unicode: '🧾', custom_emoji_id: '5444856076954520455' },
  email_secure: { unicode: '🔒', custom_emoji_id: '5463413771647069835' },
  email_thanks: { unicode: '🙏', custom_emoji_id: '5465262274031659421' },
  email_invalid: { unicode: '⚠️', custom_emoji_id: '5974083768233760323' },
  // "Email already in use" warning — the only genuinely new id in
  // this group; the others below were already mapped (re-aliased
  // here for readability in the locale templates).
  email_in_use: { unicode: '🚫', custom_emoji_id: '5098231965396501587' },
  // "PDF sent to mail" success ribbon shown after Send-PDF buttons.
  // Two slot emojis frame the bold copy on either side.
  pdf_sent: { unicode: '📬', custom_emoji_id: '5096035317257864249' },
  pdf_sent_l: { unicode: '📤', custom_emoji_id: '5926964914684957537' },
  pdf_sent_r: { unicode: '📬', custom_emoji_id: '6179461085624536942' },

  // ---- Support screen header -----------------------------------
  support_title: { unicode: '📞', custom_emoji_id: '6247041691652461368' },

  // ---- Live Support panel + closure messages -------------------
  // Premium glyphs requested by the bot owner; non-premium users
  // see the unicode fallback.
  support_live_active: { unicode: '💬', custom_emoji_id: '5456580414254619349' },
  support_live_closed: { unicode: '🔴', custom_emoji_id: '5803151379887297481' },

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
 * BUTTON ICON MAP (Bot API 9.4)
 * ------------------------------------------------------------------
 * Maps button keys to an `EMOJI` map key whose value MUST be a
 * `{ unicode, custom_emoji_id }` object. The button's
 * `icon_custom_emoji_id` is set to that id, and the leading unicode
 * emoji in the locale label is stripped at render time so the icon
 * doesn't render twice.
 *
 * `icon_custom_emoji_id` requires either:
 *   - the bot was bought on Fragment, OR
 *   - the bot's owner has a Telegram Premium subscription
 *     (which is already required by all the `<tg-emoji>` premium
 *     emojis used elsewhere in this codebase, so if the bot's
 *     working today, button icons will work too).
 */
export const BUTTON_ICONS: Partial<Record<keyof typeof BUTTON_KEYS, string>> = {
  // Each value below MUST point to an EMOJI key whose value is a
  // `{ unicode, custom_emoji_id }` object whose `unicode` matches the
  // emoji prefix in the locale label — that way the button shows the
  // SAME glyph (just the premium animated version for premium
  // viewers). Keys whose locale emoji has no exact premium twin are
  // left out so the original unicode emoji stays in the label.
  profile: 'profile_header',
  buy_now: 'orders_received',
  topup_wallet: 'deposits_wallet',
  view_note: 'orders_note',
  my_orders: 'orders_title',
  refer: 'refer_title',
  notifications: 'notify_bell',
  language: 'lang_globe',
  deposit_history: 'deposits_title',
  // `channel` left unset on purpose — the user asked for no emoji
  // on this button at all (label-only). Re-add an EMOJI key here to
  // restore a premium icon if you change your mind.
  stats: 'stats',
  stats_refresh: 'stats_refresh',
  set_region: 'profile_region',
  set_email: 'profile_email',

  // Email hub & sub-screens
  email_settings: 'profile_email',
  email_set: 'profile_email',
  email_change: 'email_bracket_r',
  email_delete: 'gift_invalid',
  email_delete_confirm: 'gift_invalid',
  email_know_more: 'email_invoice',

  // Notification toggles (ON uses green dot, OFF uses bell-off)
  notify_stock_on: 'notify_on',
  notify_stock_off: 'notify_off',
  notify_ann_on: 'notify_on',
  notify_ann_off: 'notify_off',
  notify_wallet_on: 'notify_on',
  notify_wallet_off: 'notify_off',

  // Send-PDF buttons (paper-plane / outbox icons). `send_pdf_orders`
  // is intentionally left unset — the user wants the My Orders
  // sub-screen completely emoji-free. The Stats / Deposits PDF
  // buttons live on different screens and keep their icons.
  send_pdf_stats: 'pdf_sent_l',
  send_pdf_deposits: 'pdf_sent_l',

  // Refer copy-link
  copy_link: 'refer_transferred',

  // Redeem
  redeem: 'gift_title',
  buy_code: 'gift_usdt',

  // Order detail — left unset so the My Orders flow stays
  // emoji-free per the latest UX request. Re-add a key here to bring
  // back a premium icon.

  // Support section
  support_contact: 'support_title',
  support_live: 'support_live_active',
  support_cancel: 'support_live_closed',
  support_end_session: 'support_live_closed',
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

/** Categories pagination size — categories per page on the Shop home. */
export const CATEGORIES_PER_PAGE = 9;

/** Quantity limits in the product page */
export const QTY_MIN = 1;
export const QTY_MAX = 999;

/** Default language for new users (overridable via env DEFAULT_LANG) */
export const DEFAULT_LANG: Lang = 'en';
