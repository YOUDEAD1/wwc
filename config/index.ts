/**
 * SafwanTiger Shop Bot â€” central editable config.
 *
 * Almost every user-facing string, button label, emoji, and color
 * mode lives in this single file. The admin can also override any
 * of these values at runtime via the bot itself (see /admin commands)
 * â€” those overrides are stored in the `settings` table in Supabase
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
 *   blue   â†’ 'primary'   (Telegram's accent / blue)
 *   green  â†’ 'success'   (green)
 *   red    â†’ 'danger'    (red)
 *   yellow â†’ no equivalent â€” falls back to the app default
 *   none   â†’ no style    (app default)
 *
 * The prefix strings carry a coloured glyph so the picked color is
 * visible on every Telegram client â€” even on legacy clients that
 * don't yet support Bot API 9.4 styles. Bot owners can override any
 * of these glyphs at runtime via the `color.prefix.<mode>` setting
 * (lookup happens in `services/settings.ts â†’ getColorPrefix()`).
 * Set the override to an empty string to suppress the glyph for
 * a given mode without losing the underlying API-9.4 style.
 */
export const COLOR_PREFIX = {
  blue: 'ðŸ”µ',
  green: 'ðŸŸ¢',
  red: 'ðŸ”´',
  yellow: 'ðŸŸ¡',
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
  redeem_referral: 'btn.redeem_referral',
  referral_earn_buy: 'btn.referral_earn_buy',
  convert_refers: 'btn.convert_refers',
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
  // "Find by Order ID" lets the user jump straight to a specific
  // order detail screen by typing a public Order ID (e.g.
  // ORD67FF2G9YG) â€” useful when the orders list is long.
  find_order_by_id: 'btn.find_order_by_id',

  // ---- Support section ----------------------------------------
  support_contact: 'support.btn.contact',
  support_live: 'support.btn.live',
  support_cancel: 'support.btn.cancel',
  support_end_session: 'support.btn.end_session',
  // "Send chat PDF to email" â€” shown under the closure message so
  // the user can keep a copy of the just-finished Live Support
  // transcript without contacting an admin.
  support_email_transcript: 'support.btn.email_transcript',

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
  qty_dec_1: 'btn.qty.dec_1',
  qty_dec_10: 'btn.qty.dec_10',
  qty_dec_100: 'btn.qty.dec_100',
  qty_inc_1: 'btn.qty.inc_1',
  qty_inc_10: 'btn.qty.inc_10',
  qty_inc_100: 'btn.qty.inc_100',
  qty_display: 'btn.qty.display',

  // ---- Product page extras ----
  share_product: 'btn.share_product',
  view_note_file: 'btn.view_note_file',
  send_note_txt: 'btn.send_note_txt',

  // ---- Custom-quantity keypad (replaces the legacy +/- adder) ---
  custom_qty: 'btn.custom_qty',
  qty_keypad_back: 'btn.qty_keypad_back',
  qty_keypad_clear: 'btn.qty_keypad_clear',
  qty_keypad_confirm: 'btn.qty_keypad_confirm',
  // `qty_keypad_max` snaps the buffer to the user's purchasable
  // ceiling (`min(QTY_MAX, stock)`). Sits next to Confirm so the
  // bulk-buy gesture is one tap.
  qty_keypad_max: 'btn.qty_keypad_max',
  // ---- Buy-now payment-method screen ----------------------------
  pay_wallet: 'btn.pay_wallet',
  pay_referral: 'btn.pay_referral',
  pay_direct: 'btn.pay_direct',
  pay_topup: 'btn.pay_topup',
  // "Others" + "Back" rows on the shared payment-methods keyboard
  // (Top-Up Wallet & Direct-Pay both use this keyboard). Promoted
  // out of the previous hard-coded `kb.text('ðŸ’¡ Others', â€¦)` /
  // `btn.back` rendering so they pick up the standard premium-emoji
  // icon override + Bot API 9.4 button style applied by `inlineBtn`.
  paymethod_others: 'btn.paymethod_others',
  paymethod_back: 'btn.paymethod_back',
  // Wallet-payment confirmation card (page 2 of the buy flow):
  // green Confirm + red back-arrow Cancel.
  confirm_pay: 'btn.confirm_pay',
  cancel_pay: 'btn.cancel_pay',

  // ---- Premium-shop overhaul ----------------------------------
  // `using_method` is the post-order tutorial trigger (pic 3).
  // `bot_tutorial` + `send_price_list` are the two new Settings
  // entries. `tutorial_open_link` opens the admin-configured
  // external URL. `email_reports_on/off` is the new toggle row in
  // the notifications screen.
  using_method: 'btn.using_method',
  tutorial_open_link: 'btn.tutorial_open_link',
  bot_tutorial: 'btn.bot_tutorial',
  send_price_list: 'btn.send_price_list',
  send_price_list_mail: 'btn.send_price_list.mail',
  send_price_list_chat: 'btn.send_price_list.chat',
  notify_email_on: 'btn.notify.email.on',
  notify_email_off: 'btn.notify.email.off',

  // ---- Post-purchase email follow-up --------------------------
  // `set_email_now` is shown under the "Please add your verified
  // email" prompt that follows an Order Delivered card when the
  // buyer has no email on file. `view_invoice` opens the public
  // Order detail screen on the same chat.
  set_email_now: 'btn.set_email_now',
  view_invoice: 'btn.view_invoice',

  // ---- Per-payment-method tutorial ("Where TXID? / Where Order ID?") ----
  // Surfaced under every chain/Binance/LTC instruction screen as
  // an admin-editable how-to card. `where_txid` is for chain &
  // LTC providers (TRC-20 / BEP-20 / TON / LTC); `where_order_id`
  // for the Binance Pay flow (which collects the 18-digit Order ID
  // instead of an on-chain hash).
  where_txid: 'btn.where_txid',
  where_order_id: 'btn.where_order_id',

  // ---- Post-purchase delivery form ----------------------------
  // Two buttons under the success card sent after a buyer submits
  // their per-product details:
  //   â€¢ `delivery_edit` reopens the form pre-filled so the buyer
  //     can correct a typo and resubmit.
  //   â€¢ `delivery_admin_help` is a URL button that opens the admin
  //     DM with the auto-message already pre-filled (see
  //     `getAdminContactUrlWithPrefill`).
  delivery_edit: 'btn.delivery.edit',
  delivery_admin_help: 'btn.delivery.admin_help',
} as const;

/**
 * COLOR ASSIGNMENTS PER BUTTON
 * Maps to Bot API 9.4 button styles via `colorModeToStyle()`:
 *   blue â†’ primary, green â†’ success, red â†’ danger, yellow/none â†’ app default.
 * The admin can override these at runtime via /setcolor <key> <mode>.
 */
export const DEFAULT_BUTTON_COLORS: Record<keyof typeof BUTTON_KEYS, ColorMode> = {
  shop: 'green',
  topup: 'blue',
  profile: 'none',
  support: 'blue',
  ai_support: 'blue',
  main_menu: 'none',
  // 2026-05-08: rolled back to neutral. The previous bot-owner
  // tweak made every plain `Back` look like a destructive button,
  // but the new spec is the *opposite* â€” only the dedicated
  // `Cancel` (red) on payment-instructions screens should read as
  // dangerous; bare `Back` (qty page, picker, settings, etc.) goes
  // back to the neutral default-style rail.
  back: 'none',
  next: 'none',
  prev: 'none',
  refresh: 'none',
  buy_now: 'green',
  redeem_referral: 'green',
  referral_earn_buy: 'green',
  convert_refers: 'blue',
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
  // Find-by-id matches the Send-PDF blue so search-style actions
  // read consistently across the orders screen.
  find_order_by_id: 'blue',

  // Support section.
  support_contact: 'blue',
  support_live: 'green',
  support_cancel: 'red',
  support_end_session: 'red',
  // Email-transcript is a positive follow-up action.
  support_email_transcript: 'blue',

  // Language picker â€” neutral (admin can colour them per language).
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
  // Increment buttons (green = positive); decrements neutral so the
  // counter reads "add" as the visually dominant action.
  qty_dec_1: 'none',
  qty_dec_10: 'none',
  qty_dec_100: 'none',
  qty_inc_1: 'green',
  qty_inc_10: 'green',
  qty_inc_100: 'green',
  qty_display: 'blue',

  // Product extras.
  share_product: 'blue',
  view_note_file: 'none',
  send_note_txt: 'blue',

  // Custom-quantity keypad â€” digits stay neutral so the action
  // buttons (Clear, Confirm, Max) read as the dominant choices.
  custom_qty: 'blue',
  qty_keypad_back: 'none',
  qty_keypad_clear: 'red',
  qty_keypad_confirm: 'green',
  qty_keypad_max: 'green',

  // Buy-now payment-method screen.
  pay_wallet: 'green',
  pay_referral: 'blue',
  pay_direct: 'yellow',
  pay_topup: 'blue',
  // Payment-methods keyboard chrome â€” Others sits below the per-
  // method buttons as the catch-all entry, Back returns to the
  // previous screen. Others stays primary-blue; Back goes red per
  // bot-owner spec on the picker (a separate, dedicated `cancel_pay`
  // button on the per-method instructions screen is also red â€” both
  // are exit-style controls so they share the colour).
  paymethod_others: 'blue',
  paymethod_back: 'red',
  // Wallet-confirm screen.
  confirm_pay: 'green',
  cancel_pay: 'red',

  // Premium-shop overhaul. `using_method` is the post-order
  // tutorial CTA (blue = primary action). `out_of_stock`'s color
  // is already declared above; the new red Buy-Now-when-OOS variant
  // reuses that key. `email_reports_on` is green like the other
  // notification toggles.
  using_method: 'blue',
  tutorial_open_link: 'blue',
  bot_tutorial: 'blue',
  send_price_list: 'blue',
  send_price_list_mail: 'blue',
  send_price_list_chat: 'green',
  notify_email_on: 'green',
  notify_email_off: 'none',
  set_email_now: 'blue',
  view_invoice: 'blue',

  // Per-method tutorial CTAs ("Where TXID? / Where Order ID?")
  // sit right above the back button on the chain/Binance/LTC
  // instruction screens. Blue matches the rest of the help-style
  // buttons in the app.
  where_txid: 'blue',
  where_order_id: 'blue',

  // Post-purchase delivery form action buttons.
  delivery_edit: 'blue',
  delivery_admin_help: 'red',
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
  fire: 'ðŸ”¥',
  rocket: 'ðŸš€',
  tiger: 'ðŸ¯',
  cart: 'ðŸ›',
  wallet: 'ðŸª™',
  wave: 'ðŸ‘‹',
  bell: 'ðŸ””',
  globe: 'ðŸŒ',
  user: 'ðŸ‘¤',
  warranty: 'ðŸ›¡ï¸',
  stock: 'ðŸ“¦',
  price: 'ðŸ’°',
  total: 'ðŸ§®',
  back: 'â—€ï¸',
  next: 'â–¶ï¸',
  refresh: 'ðŸ”„',
  plus: 'âž•',
  minus: 'âž–',
  buy: 'âœ…',
  note: 'ðŸ“',
  star: 'â­',
  ai: 'ðŸ¤–',
  settings: 'âš™ï¸',
  pencil: 'âœï¸',
  megaphone: 'ðŸ“£',
  chart: 'ðŸ“Š',
  trash: 'ðŸ—‘',
  reload: 'ðŸ”',
  broom: 'ðŸ§¹',
  package: 'ðŸ“¦',
  card: 'ðŸ’³',
  folder: 'ðŸ—‚',
  check: 'âœ…',
  cross: 'âŒ',

  // Premium emojis used on the Stats screen. Telegram premium users
  // see the styled/animated glyph; everyone else sees the unicode
  // fallback declared here.
  stats: { unicode: 'ðŸ“Š', custom_emoji_id: '4958506272551863292' },
  stats_refresh: { unicode: 'ðŸ”„', custom_emoji_id: '5346321684574003384' },
  stats_back: { unicode: 'â—€ï¸', custom_emoji_id: '5440509136259267820' },
  stats_orders: { unicode: 'ðŸ§¾', custom_emoji_id: '5377660214096974712' },
  stats_items: { unicode: 'ðŸ›', custom_emoji_id: '5222208236505028301' },
  stats_spent: { unicode: 'ðŸ’°', custom_emoji_id: '5926961826603472005' },
  stats_last: { unicode: 'â±', custom_emoji_id: '5226597108965993909' },
  stats_deposits: { unicode: 'ðŸ’³', custom_emoji_id: '5443127283898405358' },

  // ---- Profile screen (one premium emoji per row) ----------------
  profile_header: { unicode: 'âš™ï¸', custom_emoji_id: '5904630315946611415' },
  profile_id: { unicode: 'ðŸ†”', custom_emoji_id: '5796517197308236353' },
  profile_first_name: { unicode: 'ðŸªª', custom_emoji_id: '5800956853462504394' },
  profile_username: { unicode: 'ðŸ‘¤', custom_emoji_id: '5370935802844946281' },
  profile_link: { unicode: 'ðŸ”—', custom_emoji_id: '4958689671950369798' },
  profile_status: { unicode: 'ðŸš€', custom_emoji_id: '5213147006561692829' },
  profile_email: { unicode: 'ðŸ“§', custom_emoji_id: '5472239203590888751' },
  profile_balance: { unicode: 'ðŸ’°', custom_emoji_id: '6325416826100519483' },
  profile_language: { unicode: 'ðŸŒ', custom_emoji_id: '5364021605578071936' },
  profile_region: { unicode: 'ðŸ—º', custom_emoji_id: '5309748255637118475' },
  profile_joined: { unicode: 'ðŸ“…', custom_emoji_id: '5028418466000930064' },

  // ---- Welcome banner -------------------------------------------
  welcome_banner: { unicode: 'ðŸ‘‹', custom_emoji_id: '6003746779474956178' },
  welcome_balance: { unicode: 'ðŸ’³', custom_emoji_id: '6084583651738132915' },

  // ---- Notifications screen (premium emojis only render in body
  //      text â€” inline-keyboard buttons fall back to the unicode glyph).
  notify_bell: { unicode: 'ðŸ””', custom_emoji_id: '5215372534060428125' },
  notify_stock: { unicode: 'ðŸ“¢', custom_emoji_id: '6082236434930998087' },
  notify_info: { unicode: 'ðŸ’¬', custom_emoji_id: '6082420431329957672' },
  notify_wallet: { unicode: 'ðŸ’°', custom_emoji_id: '6084800852529258692' },
  notify_on: { unicode: 'ðŸŸ¢', custom_emoji_id: '5213147006561692829' },
  notify_off: { unicode: 'ðŸ”•', custom_emoji_id: '5843822645711212265' },

  // ---- Refer & Earn screen -------------------------------------
  refer_title: { unicode: 'ðŸŽ', custom_emoji_id: '5053473385355412667' },
  refer_prize_l: { unicode: 'ðŸ†', custom_emoji_id: '4909043075529048789' },
  refer_prize_r: { unicode: 'âœ¨', custom_emoji_id: '6088990159334808217' },
  refer_clicks: { unicode: 'ðŸ‘', custom_emoji_id: '5019759554234156094' },
  refer_pending: { unicode: 'â³', custom_emoji_id: '5386367538735104399' },
  refer_active: { unicode: 'âœ…', custom_emoji_id: '6115971182542984044' },
  refer_left: { unicode: 'ðŸ“Œ', custom_emoji_id: '6181467651395558500' },
  refer_total: { unicode: 'ðŸ‘¤', custom_emoji_id: '5332724926216428039' },
  refer_user: { unicode: 'ðŸ‘¤', custom_emoji_id: '5332724926216428039' },
  refer_coin: { unicode: 'ðŸª™', custom_emoji_id: '5264977499363746876' },
  refer_transferred: { unicode: 'ðŸ”', custom_emoji_id: '5832493956503442338' },
  refer_withdrawn: { unicode: 'ðŸ’µ', custom_emoji_id: '5201873447554145566' },
  refer_spent: { unicode: 'ðŸ§¾', custom_emoji_id: '6276009124350138166' },

  // ---- Language picker -----------------------------------------
  lang_left: { unicode: 'ðŸŒ', custom_emoji_id: '5330422213860407355' },
  lang_right: { unicode: 'ðŸ—£', custom_emoji_id: '5818984364507139347' },

  // ---- Email screens (set / change / why) -----------------------
  email_saved_check: { unicode: 'âœ¨', custom_emoji_id: '5098088779776787441' },
  email_bracket_l: { unicode: 'ðŸ“©', custom_emoji_id: '6008233706039284019' },
  email_bracket_r: { unicode: 'ðŸ”§', custom_emoji_id: '6010111371251815589' },
  email_arrow: { unicode: 'ðŸ‘‡', custom_emoji_id: '5229212516415978792' },
  email_invoice: { unicode: 'ðŸ§¾', custom_emoji_id: '5444856076954520455' },
  email_secure: { unicode: 'ðŸ”’', custom_emoji_id: '5463413771647069835' },
  email_thanks: { unicode: 'ðŸ™', custom_emoji_id: '5465262274031659421' },
  email_invalid: { unicode: 'âš ï¸', custom_emoji_id: '5974083768233760323' },
  // "Email already in use" warning â€” the only genuinely new id in
  // this group; the others below were already mapped (re-aliased
  // here for readability in the locale templates).
  email_in_use: { unicode: 'ðŸš«', custom_emoji_id: '5098231965396501587' },
  // "PDF sent to mail" success ribbon shown after Send-PDF buttons.
  // Two slot emojis frame the bold copy on either side.
  pdf_sent: { unicode: 'ðŸ“¬', custom_emoji_id: '5096035317257864249' },
  pdf_sent_l: { unicode: 'ðŸ“¤', custom_emoji_id: '5926964914684957537' },
  pdf_sent_r: { unicode: 'ðŸ“¬', custom_emoji_id: '6179461085624536942' },

  // ---- Support screen header -----------------------------------
  // Bot owner refreshed this premium id on 2026-05-08 â€” the previous
  // one (`6247041691652461368`) is no longer used. The new id is
  // applied to the main-menu Support button, the Top-Up Others row,
  // and the rejection / manual-review Admin Help URL button so all
  // "reach support" entry points share the same animated glyph.
  support_title: { unicode: 'ðŸ“ž', custom_emoji_id: '5271619747891388291' },
  // Alias rendered next to the Admin Help URL button on the
  // verification-result keyboards. Same id as `support_title` so
  // the URL button picks up the support glyph; admins can rotate
  // it independently via `/setemoji admin_help`.
  admin_help: { unicode: 'ðŸ†˜', custom_emoji_id: '5271619747891388291' },
  // Premium-styled red "transaction cancelled" warning shown when
  // a buyer pastes an invalid TX / Order ID into the direct-pay
  // flow. Reuses the existing pure-red cross from the Gift-Codes
  // screen so the cancelled state reads as visibly destructive.
  tx_cancelled: { unicode: 'âŒ', custom_emoji_id: '5095957930537124723' },

  // ---- Live Support panel + closure messages -------------------
  // Premium glyphs requested by the bot owner; non-premium users
  // see the unicode fallback.
  support_live_active: { unicode: 'ðŸ’¬', custom_emoji_id: '5456580414254619349' },
  support_live_closed: { unicode: 'ðŸ”´', custom_emoji_id: '5803151379887297481' },
  // Kiwi AI Support â€” premium glyph used in the AI greeting and
  // anywhere the rebrand needs the kiwi avatar in front of text.
  kiwi_ai: { unicode: 'ðŸ¥', custom_emoji_id: '4956398762164487204' },

  // ---- Product page (revamped) ---------------------------------
  // Premium glyphs that prefix every line on the product detail
  // screen. Telegram premium users see the animated/styled icon;
  // everyone else sees the unicode fallback.
  prod_price_base: { unicode: 'ðŸ’°', custom_emoji_id: '6325444137797554944' },
  prod_stock: { unicode: 'ðŸ“¦', custom_emoji_id: '5472170432574528133' },
  prod_warranty: { unicode: 'ðŸ›¡ï¸', custom_emoji_id: '5893365724830765382' },
  prod_qty_selected: { unicode: 'ðŸ”¢', custom_emoji_id: '5363964615657017717' },
  prod_total_amount: { unicode: 'ðŸ§®', custom_emoji_id: '5366223171454278937' },
  prod_wallet: { unicode: 'ðŸ‘›', custom_emoji_id: '6102840685835066490' },
  prod_referral: { unicode: 'ðŸŽ', custom_emoji_id: '4958699241137505132' },
  // Promo line (qty-threshold flat-USDT discount). Reuses the
  // existing ðŸŽ premium glyph from the gift-codes screen for
  // visual consistency.
  prod_promo: { unicode: 'ðŸŽ', custom_emoji_id: '4958699241137505132' },

  // Custom-quantity prompt â€” pencil + keypad framing the bold body.
  qty_prompt_pencil: { unicode: 'âœï¸', custom_emoji_id: '5866355487255039002' },
  qty_prompt_keypad: { unicode: 'ðŸ”¢', custom_emoji_id: '5926964914684957537' },
  // Premium-styled red warning shown when the user enters an
  // invalid quantity (0, > stock, > QTY_MAX, non-integer).
  qty_invalid: { unicode: 'âš ï¸', custom_emoji_id: '5974083768233760323' },

  // ---- My Deposits screen --------------------------------------
  deposits_title: { unicode: 'ðŸ’³', custom_emoji_id: '6102840685835066490' },
  deposits_payments: { unicode: 'ðŸ’¸', custom_emoji_id: '5375312095346704820' },
  deposits_wallet: { unicode: 'ðŸ‘›', custom_emoji_id: '4965219701572503640' },
  deposits_empty: { unicode: 'ðŸ“­', custom_emoji_id: '5798937402789597866' },

  // ---- Language button -----------------------------------------
  lang_globe: { unicode: 'ðŸŒ', custom_emoji_id: '5310249748903504323' },

  // ---- Redeem Gift Code screen --------------------------------
  gift_title: { unicode: 'ðŸŽ', custom_emoji_id: '4958699241137505132' },
  gift_send: { unicode: 'ðŸ‘‡', custom_emoji_id: '5287279155702936525' },
  gift_usdt: { unicode: 'ðŸ’µ', custom_emoji_id: '5463046637842608206' },
  gift_balance: { unicode: 'ðŸ’°', custom_emoji_id: '4958926882994127612' },
  gift_expired: { unicode: 'â°', custom_emoji_id: '5280821895711697516' },
  gift_invalid: { unicode: 'âŒ', custom_emoji_id: '5095957930537124723' },
  gift_redeemed: { unicode: 'âœ…', custom_emoji_id: '5096035317257864249' },

  // ---- My Orders detail screen --------------------------------
  orders_title: { unicode: 'ðŸ§¾', custom_emoji_id: '5893255507380014983' },
  orders_id: { unicode: 'ðŸ†”', custom_emoji_id: '5818885490065017876' },
  orders_product: { unicode: 'ðŸ“¦', custom_emoji_id: '5069075201950483359' },
  orders_type: { unicode: 'ðŸ’³', custom_emoji_id: '5438496463044752972' },
  orders_qty: { unicode: 'ðŸ”¢', custom_emoji_id: '5926964914684957537' },
  orders_total: { unicode: 'ðŸ’°', custom_emoji_id: '4958926882994127612' },
  orders_when: { unicode: 'ðŸ—“', custom_emoji_id: '5800810214689084012' },
  orders_status: { unicode: 'ðŸ›¡', custom_emoji_id: '6179461085624536942' },
  orders_note: { unicode: 'ðŸ“', custom_emoji_id: '5778299625370817409' },
  orders_warranty: { unicode: 'â°', custom_emoji_id: '5280821895711697516' },
  orders_received: { unicode: 'âœ…', custom_emoji_id: '5096035317257864249' },
  // Download TXT button icon
  btn_download_txt: { unicode: 'ðŸ“¥', custom_emoji_id: '5318845185348626090' },
  // Default premium icon for the broadcast "Shop Now" / "Buy Now" button.
  broadcast_shop_now: { unicode: 'ðŸ›', custom_emoji_id: '5312361253610475399' },

  // ---- Find Order by ID prompt + invalid response --------------
  // The two glyphs below frame the "Send Your Order ID to find"
  // prompt shown when the user taps Find by Order ID. The invalid
  // response uses the existing `gift_invalid` âŒ on the left and a
  // dedicated warning glyph on the right.
  order_id_find_l: { unicode: 'ðŸ†”', custom_emoji_id: '5463424023734014980' },
  order_id_find_r: { unicode: 'ðŸ”', custom_emoji_id: '6084844906008812139' },
  order_id_invalid_r: { unicode: 'âš ï¸', custom_emoji_id: '5967560851077469602' },

  // ---- Premium-shop overhaul (PR: premium-shop-overhaul) -------
  // Header glyphs for the new two-step delivery card (pic 3) and
  // the per-product Using Method tutorial. `note_premium` is the
  // animated note glyph used at the top of the View Note screen.
  // All custom_emoji_ids can be overridden by the bot owner via
  // `/setemoji <key> <unicode> <custom_emoji_id>`.
  order_verified: { unicode: 'âœ…', custom_emoji_id: '6325645228166353066' },
  order_delivered: { unicode: 'ðŸšš', custom_emoji_id: '5098567638565520047' },
  tutorial: { unicode: 'ðŸ“˜', custom_emoji_id: '5305737159909581647' },
  // Note section: header / Description label / Note label each get
  // their own slot so the admin can swap them independently from
  // `/setemoji note_premium / note_desc / note_text`. Defaults to
  // the same notepad glyph everywhere.
  note_premium: { unicode: 'ðŸ“', custom_emoji_id: '5778299625370817409' },
  note_desc: { unicode: 'ðŸ“„', custom_emoji_id: '5778299625370817409' },
  note_text: { unicode: 'ðŸ“', custom_emoji_id: '5778299625370817409' },
  // "â³ Delivering your orderâ€¦" trailer under the Payment Verified
  // line. Same id as `email_bracket_r` per the bot-owner spec.
  delivering: { unicode: 'â³', custom_emoji_id: '6010111371251815589' },
  // "Items:" label inside the Order Delivered card.
  delivered_items: { unicode: 'ðŸ“¦', custom_emoji_id: '6156809896256867448' },
  // "Please add your verified email" prompt shown after delivery
  // when the buyer has no email on file.
  email_add_l: { unicode: 'ðŸ“§', custom_emoji_id: '6098324862730768475' },
  email_add_r: { unicode: 'ðŸ“©', custom_emoji_id: '4929214028657460019' },
  // "Product Details and invoice sent to your mail" follow-up shown
  // after delivery when the buyer DOES have an email on file.
  invoice_sent_l: { unicode: 'ðŸ“¬', custom_emoji_id: '6005930963618501222' },
  invoice_sent_r: { unicode: 'ðŸ“¨', custom_emoji_id: '5454113432284446338' },
  invoice_spam: { unicode: 'ðŸ“¥', custom_emoji_id: '6008233706039284019' },
  invoice_email_label: { unicode: 'ðŸ“§', custom_emoji_id: '5357050826412018659' },
  invoice_link_label: { unicode: 'ðŸ”—', custom_emoji_id: '4929214028657460019' },
  // 12-hour email nag glyph + the Email Reports notifications row.
  email_nag: { unicode: 'ðŸ“§', custom_emoji_id: '5472239203590888751' },
  notify_email: { unicode: 'ðŸ“§', custom_emoji_id: '5472239203590888751' },
  // Bot Tutorial + Send Price List row icons in Settings.
  bot_tutorial: { unicode: 'ðŸ“˜', custom_emoji_id: '5305737159909581647' },
  price_list: { unicode: 'ðŸ“Š', custom_emoji_id: '4958506272551863292' },
  // Out-of-stock cross used on the red Buy Now button.
  oos_cross: { unicode: 'âŒ', custom_emoji_id: '5095957930537124723' },
  // ---- Post-purchase delivery form (per-product detail submission) ----
  // Used by the instruction â†’ form â†’ success â†’ vendor-forward flow
  // for products where the admin enables `delivery_form_enabled`.
  // All four slots fall back to plain unicode until the bot owner
  // sets a `custom_emoji_id` via `/setemoji <key> <unicode> <id>`.
  delivery_box: 'ðŸ“¥',
  delivery_field: 'âœï¸',
  delivery_check: 'âœ…',
  delivery_help: 'ðŸ†˜',
  delivery_resubmit: 'ðŸ”',
  delivery_vendor: 'ðŸ¤',
  // Wallet credit / debit notifications shown to a user when an admin
  // adjusts their balance via /credit. Three slots so the admin can
  // swap each independently via `/setemoji credit_emoji / balance_emoji /
  // debit_emoji <unicode> <custom_emoji_id>`. They start as plain
  // unicode glyphs (no premium id) so admins can drop in any premium
  // pack they like without us guessing ids that might not resolve.
  credit_emoji: { unicode: 'ðŸ’°', custom_emoji_id: '5931293928186713205' },
  balance_emoji: { unicode: 'ðŸ’³', custom_emoji_id: '5926961826603472005' },
  debit_emoji: 'âš ï¸',

  // ---- Direct-Pay "Select payment method" header (PR: direct-pay
  //      simple). The page now shows just the title + a product line
  //      + the total + a verification reminder, so we only need
  //      these three premium-emoji slots. Admin can rotate any of
  //      them via `/setemoji` (e.g. `/setemoji direct_pay_total
  //      ðŸ’° 5463046637842608206`).
  direct_pay_title: { unicode: 'ðŸ’¸', custom_emoji_id: '5008248651038852115' },
  direct_pay_total: { unicode: 'ðŸ’³', custom_emoji_id: '5463046637842608206' },
  direct_pay_verify: { unicode: 'ðŸ”Ž', custom_emoji_id: '5789858554890425372' },

  // ---- Buy-flow Pay screens (page 1 + page 2) -----------------
  // `pay_summary` is the premium glyph that prefixes the *Order*
  // header on both screens. Admin can rotate via
  // `/setemoji pay_summary <unicode> <custom_emoji_id>`.
  pay_summary: { unicode: 'ðŸ§¾', custom_emoji_id: '5893255507380014983' },
  // Page-2 Confirm tick + Cancel back-arrow. Same defaults as the
  // existing qty-keypad confirm / stats-back glyphs so the user
  // gets the familiar premium animation.
  pay_confirm: { unicode: 'âœ…', custom_emoji_id: '5096035317257864249' },
  pay_cancel: { unicode: 'â—€ï¸', custom_emoji_id: '5440509136259267820' },

  // ---- Payment-methods keyboard (Others / Back rows) -----------
  // `paymethod_others` is the bot-owner-supplied premium glyph that
  // replaces the legacy free ðŸ’¡ unicode emoji on the Others row
  // (premium subscribers see the animated icon, non-premium users
  // fall back to ðŸ’¡). `paymethod_back` re-uses the same animated
  // back-arrow as the Cancel button on the wallet-confirm card so
  // the back action reads identically across the buy / top-up flow.
  // 2026-05-08 swap: the bot owner asked us to move the previous
  // Support-button glyph (Santa+bottle, id `6247041691652461368`)
  // onto the Top-Up "Others" row, freeing the new help glyph
  // (`5271619747891388291`) to live exclusively on the main-menu
  // Support button + Admin Help URL button. Earlier rotations:
  //   â€¢ `5188540541922480562` (legacy)
  //   â€¢ `5271619747891388291` (briefly applied here, now Support-only)
  // Unicode fallback stays as ðŸ’¡ so non-premium clients see the
  // same glyph the screen used to render with before the icon.
  paymethod_others: { unicode: 'ðŸ’¡', custom_emoji_id: '6247041691652461368' },
  paymethod_back: { unicode: 'â—€ï¸', custom_emoji_id: '5440509136259267820' },
  // Premium ðŸŽ¯-style glyph for the Custom-Quantity Max button.
  // Reuses the qty-numbers id (`prod_qty_selected`) so the keypad's
  // Max + the product page's Selected Qty header read consistently.
  // Bot owner can swap via `/setemoji qty_keypad_max <unicode> <id>`.
  qty_keypad_max: { unicode: 'ðŸ”¢', custom_emoji_id: '5363964615657017717' },
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
  // emoji prefix in the locale label â€” that way the button shows the
  // SAME glyph (just the premium animated version for premium
  // viewers). Keys whose locale emoji has no exact premium twin are
  // left out so the original unicode emoji stays in the label.
  profile: 'profile_header',
  buy_now: 'broadcast_shop_now',
  redeem_referral: 'refer_title',
  referral_earn_buy: 'refer_title',
  convert_refers: 'refer_coin',
  topup_wallet: 'deposits_wallet',
  view_note: 'orders_note',
  my_orders: 'orders_title',
  refer: 'refer_title',
  notifications: 'notify_bell',
  language: 'lang_globe',
  deposit_history: 'deposits_title',
  // `channel` left unset on purpose â€” the user asked for no emoji
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
  // is intentionally left unset â€” the user wants the My Orders
  // sub-screen completely emoji-free. The Stats / Deposits PDF
  // buttons live on different screens and keep their icons.
  send_pdf_stats: 'pdf_sent_l',
  send_pdf_deposits: 'pdf_sent_l',

  // Download TXT button
  send_note_txt: 'btn_download_txt',

  // Refer copy-link
  copy_link: 'refer_transferred',

  // Redeem
  redeem: 'gift_title',
  buy_code: 'gift_usdt',

  // Order detail â€” left unset so the My Orders flow stays
  // emoji-free per the latest UX request. Re-add a key here to bring
  // back a premium icon.

  // Support section
  // Main menu Support row picks up the same premium glyph as the
  // Support body header so the entry point and the destination
  // share an icon. Bot owner refreshed the underlying id on
  // 2026-05-08 â€” see the `support_title` comment in the EMOJI map.
  support: 'support_title',
  support_contact: 'support_title',
  support_live: 'support_live_active',
  support_cancel: 'support_live_closed',
  support_end_session: 'support_live_closed',
  // Kiwi AI button on the main menu â€” premium kiwi avatar with
  // unicode `ðŸ¥` fallback. Matches the locale label so the button
  // renders consistently for premium and non-premium users.
  ai_support: 'kiwi_ai',

  // Inline quantity counter â€” premium twins for the matching unicode
  // glyphs in the locale labels. Keys whose unicode has no premium
  // twin in the EMOJI map (e.g. âª/â©/â®/â­) are intentionally left
  // unset so the unicode glyph still renders.
  qty_reset: 'stats_refresh', // ðŸ”„
  qty_confirm: 'orders_received', // âœ…
  qty_display: 'orders_product', // ðŸ“¦

  // Product-page extras.
  share_product: 'profile_link', // ðŸ”—

  // Custom-quantity keypad â€” keypad on the open button, âœ“ on
  // confirm, premium qty-numbers glyph on Max. Digit buttons are
  // intentionally unset so the plain unicode digit renders as-is
  // on every platform.
  custom_qty: 'qty_prompt_keypad',
  qty_keypad_confirm: 'orders_received',
  // 2026-05-08: bot-owner asked for a premium glyph on Max (the
  // bulk-buy short-cut). Re-uses the existing `qty_keypad_max`
  // EMOJI entry so admins can swap via `/setemoji`.
  qty_keypad_max: 'qty_keypad_max',

  // Buy-now payment-method screen â€” wallet on Pay, topup on Top Up.
  pay_wallet: 'prod_wallet',
  pay_referral: 'refer_title',
  pay_direct: 'prod_total_amount',
  pay_topup: 'deposits_wallet',
  // Wallet-payment confirmation card (page 2): green check icon
  // on Confirm, back-arrow icon on Cancel (red style).
  confirm_pay: 'pay_confirm',
  cancel_pay: 'pay_cancel',

  // Premium-shop overhaul. Out-of-stock Buy Now uses the red cross
  // glyph; Using Method uses the new tutorial book icon, etc.
  out_of_stock: 'oos_cross',
  using_method: 'tutorial',
  tutorial_open_link: 'profile_link',
  bot_tutorial: 'bot_tutorial',
  send_price_list: 'price_list',
  send_price_list_mail: 'pdf_sent_l',
  send_price_list_chat: 'pdf_sent_r',
  notify_email_on: 'notify_on',
  notify_email_off: 'notify_off',

  // Post-purchase email follow-up CTAs.
  set_email_now: 'email_add_l',
  view_invoice: 'invoice_link_label',

  // Payment-methods keyboard chrome â€” premium icon + Bot API 9.4
  // style come from the dedicated EMOJI / DEFAULT_BUTTON_COLORS
  // entries above so the admin can swap either via /setemoji /
  // /setcolor without touching the keyboard code.
  paymethod_others: 'paymethod_others',
  paymethod_back: 'paymethod_back',

  // Per-method tutorial CTAs reuse the same tutorial book glyph
  // as the per-product Using Method button so all "tap-to-learn"
  // entry points across the bot read the same.
  where_txid: 'tutorial',
  where_order_id: 'tutorial',

  // 2026-05-08: every plain `Back` button now picks up the same
  // premium back-arrow glyph as the payment-methods Back row so
  // the navigation control reads identically wherever it appears.
  // Pairs with the `back: 'red'` colour above for the dangerous
  // rail. Per-screen overrides can still be applied via
  // `/setbtnicon back <unicode> <custom_emoji_id>`.
  back: 'paymethod_back',

  // 2026-05-09: bot-owner asked for the Shop pagination Prev button
  // to render a premium back-arrow (id 5440509136259267820) â€” same
  // glyph as `stats_back`. The label's leading â—€ï¸ unicode is
  // stripped automatically by `btn()` once an icon resolves so the
  // button shows just `[premium-back-arrow] Prev`. Per-screen
  // override via `/setbtnicon prev <unicode> <custom_emoji_id>`.
  prev: 'stats_back',

  // Post-purchase delivery form CTAs reuse the dedicated delivery
  // emoji slots â€” admin can swap each via `/setemoji
  // delivery_field / delivery_help <unicode> <custom_emoji_id>`.
  delivery_edit: 'delivery_field',
  delivery_admin_help: 'delivery_help',
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
 *   Row 4: Refer & Earn | Channel
 *
 * The legacy `bot_tutorial` row is intentionally absent here â€” the
 * bot-wide tutorial is still reachable from /profile â†’ Bot Tutorial,
 * but the bot owner asked us to drop the standalone main-menu entry
 * to keep the welcome screen tight.
 */
export const MAIN_MENU_LAYOUT: ReadonlyArray<ReadonlyArray<keyof typeof BUTTON_KEYS>> = [
  ['shop'],
  ['topup', 'profile'],
  ['support', 'ai_support'],
  ['refer', 'channel'],
];

/** Shop pagination size â€” products per page */
export const PRODUCTS_PER_PAGE = 10;

/** Categories pagination size â€” categories per page on the Shop home. */
export const CATEGORIES_PER_PAGE = 9;

/** Quantity limits in the product page */
export const QTY_MIN = 1;
export const QTY_MAX = 999;

/** Default language for new users (overridable via env DEFAULT_LANG) */
export const DEFAULT_LANG: Lang = 'en';
