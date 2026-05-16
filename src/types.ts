import type { Lang } from '../config/index.js';

export type DBUser = {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language: Lang;
  balance: number;
  stock_alert: boolean;
  announcements: boolean;
  wallet_alert: boolean;
  ref_code: string | null;
  referred_by: number | null;
  joined_at: string;
  last_seen_at: string;
  email: string | null;
  region: string | null;
  timezone: string | null;
  status: string | null;
  referral_earned_total: number;
  referral_available: number;
  referral_transferred: number;
  referral_withdrawn: number;
  is_banned: boolean;
  banned_at: string | null;
  banned_reason: string | null;
  /**
   * When true, the bot suppresses the 12-hour "please add your
   * email" nag *and* every Send-PDF-to-mail action. Drives the
   * "Email Reports" notifications toggle.
   */
  email_nag_disabled: boolean;
  /** Last time the 12h nag was sent — null if never. */
  last_email_nag_at: string | null;
};

export type DBCategory = {
  id: number;
  name: string;
  emoji: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
};

export type DBProduct = {
  id: number;
  category_id: number | null;
  name: string;
  description: string | null;
  note: string | null;
  price: number;
  stock: number;
  warranty: string | null;
  emoji: string | null;
  /** Premium custom_emoji_id for the row icon. Falls back to `emoji`. */
  emoji_id: string | null;
  /** Telegram file_id of an admin-uploaded note attachment. */
  note_file_id: string | null;
  note_file_name: string | null;
  note_file_mime: string | null;
  /** Per-product Using Method tutorial body. */
  tutorial_text: string | null;
  /** Optional media attached to the tutorial. */
  tutorial_file_id: string | null;
  tutorial_file_type: 'photo' | 'video' | 'document' | null;
  tutorial_url: string | null;
  /** When true, the catalog row renders "(Stock: ∞)". */
  unlimited_stock: boolean;
  /**
   * Per-product post-purchase detail-submission form. When true, a
   * customizable instruction message + input box is shown to the
   * buyer right after Order Delivered, asking them to submit fields
   * declared in `delivery_fields`. See `services/postPurchaseDelivery.ts`.
   */
  delivery_form_enabled: boolean;
  /** Admin-set instruction text shown above the submission box. */
  delivery_instruction: string | null;
  /** Ordered list of input fields the buyer must submit. */
  delivery_fields: DeliveryFieldSpec[];
  /** Admin-set success message shown after the buyer submits the form. */
  delivery_success_message: string | null;
  /**
   * Telegram chat id (user / group) of the vendor for THIS product.
   * Submissions are auto-DM'd to this id with an order tag + the
   * submitted details. Null disables the vendor forward.
   */
  delivery_vendor_chat_id: number | null;
  /** Optional display name for the vendor used in the auto-message. */
  delivery_vendor_label: string | null;
  active: boolean;
  sort_order: number;
  /**
   * When true, the product is exempt from automatic sort-order moves
   * (most importantly the out-of-stock-to-end shuffle). It stays
   * exactly where the admin manually placed it via the ↑ / ↓ /
   * ⏫ Top / ⏬ Bottom buttons.
   */
  is_pinned: boolean;
  /**
   * When a product transitions to out-of-stock and is NOT pinned,
   * the original `sort_order` is stashed here and `sort_order` is
   * set to a large sentinel so the catalog lists it at the very end.
   * On restock the stashed value is restored and this column is
   * cleared. Null means "not currently auto-moved".
   */
  stashed_sort_order: number | null;
  created_at: string;
};

/**
 * One input field on a per-product post-purchase delivery form.
 *
 * `key` is the stable identifier persisted on the submission row;
 * `label` is what the buyer sees ("Email", "Password", "Recovery
 * Code", …). `required` defaults to true.
 */
export type DeliveryFieldSpec = {
  key: string;
  label: string;
  required?: boolean;
};

/**
 * One per-order post-purchase detail submission. Stored 1:1 with
 * `orders`. On edit/resubmit we update the row in place and bump
 * `revision` so the vendor DM can flag it as corrected.
 */
export type DBOrderDeliverySubmission = {
  id: number;
  order_id: number;
  user_id: number;
  product_id: number;
  /** `{ <field.key>: <user value> }`. */
  payload: Record<string, string>;
  revision: number;
  submitted_at: string;
  updated_at: string;
};

/** A single item in the per-product delivery pool. */
export type DBProductItem = {
  id: number;
  product_id: number;
  payload: string;
  consumed_at: string | null;
  consumed_order_id: number | null;
  created_at: string;
};

/**
 * Admin-set custom price for a single user × product combination.
 * Keyed by `telegram_id` (not users FK) so the admin can pre-set a
 * price for a user who hasn't `/start`-ed the bot yet.
 */
export type DBUserPriceOverride = {
  telegram_id: number;
  product_id: number;
  price: number;
  created_at: string;
  updated_at: string;
  created_by: number | null;
};

export type DBOrder = {
  id: number;
  user_id: number;
  product_id: number | null;
  product_name: string;
  qty: number;
  unit_price: number;
  total: number;
  /** Flat USDT discount applied at order time (0 if no promo matched). */
  discount: number;
  /** ID of the promo that produced `discount`. Null when no promo applied. */
  promo_id: number | null;
  delivery: string | null;
  /** Actual delivered items (URLs / codes / creds), one per line. */
  delivered_items: string | null;
  status: 'paid' | 'refunded' | 'cancelled';
  created_at: string;
};

/**
 * Quantity-threshold flat-USDT promo. Either or both of `product_id`
 * / `telegram_id` may be `null` — `null` means "applies to any". The
 * resolution code picks the most specific scope tier that matches.
 *
 * `min_qty` is the threshold qty for the promo to fire;
 * `discount_amount` is the flat USDT taken off the line total
 * (clamped at the line total at apply time so we never go negative).
 */
export type DBPromo = {
  id: number;
  product_id: number | null;
  telegram_id: number | null;
  name: string | null;
  min_qty: number;
  discount_amount: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by: number | null;
  /**
   * Telegram ids that are explicitly opted out of this promo even
   * if they otherwise match the scope. Empty array by default —
   * resolve-time filtering happens in `findApplicablePromos` /
   * `findScopedActivePromos` so the rest of the pricing stack
   * doesn't have to know about the exclusion list.
   */
  excluded_telegram_ids: number[];
};

export type DBDeposit = {
  id: number;
  user_id: number;
  method: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  reference: string | null;
  note: string | null;
  /**
   * On-chain transaction hash (USDT TRC20 / BEP20 / TON / LTC).
   * Unique once set so the same tx cannot be re-submitted to
   * credit a second deposit.
   */
  tx_hash: string | null;
  /**
   * For LTC quote-on-display top-ups: the LTC amount the user
   * committed to send when the quote was generated. The verifier
   * compares the on-chain output value against this with a small
   * tolerance for fee dust. Null for every other provider.
   */
  expected_amount: number | null;
  /**
   * For LTC quote-on-display top-ups: ISO timestamp when the rate
   * quote stops being valid (10 minutes after deposit creation).
   * Null for every other provider.
   */
  quote_expires_at: string | null;
  /**
   * For per-order direct-pay deposits: locked-in order context the
   * verifier uses to fulfil the order on success (instead of
   * crediting the wallet). Null for normal wallet top-ups.
   */
  order_intent: OrderIntent | null;
  created_at: string;
  updated_at: string;
};

/**
 * Locked-in order context attached to a *direct-pay* deposit.
 * When non-null on a deposit row, the verifier creates the order
 * and fulfils it (decrement stock, claim items, deliver) instead
 * of crediting the user's wallet.
 */
export type OrderIntent = {
  product_id: number;
  product_name: string;
  qty: number;
  unit_price: number;
  discount: number;
  promo_id: number | null;
  total: number;
};

export type DBGiftCode = {
  code: string;
  amount: number;
  max_redemptions: number | null;
  per_user_limit: number;
  expires_at: string | null;
  note: string | null;
  created_by: number | null;
  created_at: string;
};

export type DBGiftCodeRedemption = {
  id: number;
  code: string;
  user_id: number;
  amount: number;
  redeemed_at: string;
};

export type DBWalletLedger = {
  id: number;
  user_id: number;
  type: string;
  /** Signed amount; negative = debit, positive = credit. */
  amount: number;
  reference: string | null;
  created_at: string;
};

/**
 * Payment provider tag.
 *
 * Each non-`manual` value triggers a different verifier path:
 *   - `binance_pay`  Personal-account Binance Spot API
 *                    `/sapi/v1/pay/transactions` lookup, matched by
 *                    a user-pasted Pay Order ID. Recipient (the
 *                    merchant Pay ID) is stored in
 *                    `payment_methods.address`; the human-readable
 *                    Binance Pay Name is stored in `pay_name`.
 *   - `usdt_trc20`   TronGrid REST tx lookup (tx hash input)
 *   - `usdt_bep20`   BSC public RPC tx lookup (tx hash input)
 *   - `usdt_ton`     TonCenter REST tx lookup (tx hash input)
 *   - `ltc`          BlockCypher REST tx lookup (USD amount input →
 *                    quote LTC amount, then tx hash)
 *
 * `manual` skips auto-verification and falls back to the
 * legacy admin-approval flow.
 */
export type PaymentProvider =
  | 'manual'
  | 'binance_pay'
  | 'usdt_trc20'
  | 'usdt_bep20'
  | 'usdt_ton'
  | 'ltc';

export type DBPaymentMethod = {
  id: number;
  name: string;
  instructions: string;
  min_amount: number;
  active: boolean;
  sort_order: number;
  provider: PaymentProvider;
  /**
   * Wallet / account address. Required for every non-manual
   * provider — chain providers verify the recipient against this.
   * For `binance_pay` rows this stores the merchant's 10-digit
   * Binance Pay ID (e.g. `"1101801594"`).
   */
  address: string | null;
  /**
   * Human-readable Binance Pay Name shown next to the Pay ID on the
   * user-facing top-up screen (e.g. `"urweebboii"`). Only set for
   * `binance_pay` provider rows; null for every other provider.
   */
  pay_name: string | null;
  /**
   * Per-method Bot API 9.4 button style. Maps via `colorModeToStyle`:
   *   blue → primary, green → success, red → danger, yellow/none →
   *   app default. Defaults to 'none' so existing rows look the same.
   */
  color_mode: 'none' | 'blue' | 'green' | 'red' | 'yellow';
  /**
   * Fallback unicode glyph rendered on non-premium Telegram clients
   * (e.g. '🟡', '💎'). Null falls back to the per-provider default.
   */
  emoji_unicode: string | null;
  /**
   * Telegram premium custom_emoji_id used as the button's
   * `icon_custom_emoji_id`. Null falls back to a per-provider default.
   */
  emoji_id: string | null;
  created_at: string;
};
