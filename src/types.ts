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
  active: boolean;
  sort_order: number;
  created_at: string;
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
   * On-chain transaction hash (USDT TRC20 / BEP20) or
   * Binance Pay merchantTradeNo. Unique once set so the same tx
   * cannot be re-submitted to credit a second deposit.
   */
  tx_hash: string | null;
  created_at: string;
  updated_at: string;
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
 * Currently only `manual` is wired up — the user is shown the
 * admin-defined instructions and submits a top-up request that the
 * admin approves manually. The column itself is kept on the row so
 * a future auto-verification flow can re-introduce more values
 * without another schema migration.
 */
export type PaymentProvider = 'manual' | 'binance_pay' | 'usdt_trc20' | 'usdt_bep20';

export type DBPaymentMethod = {
  id: number;
  name: string;
  instructions: string;
  min_amount: number;
  active: boolean;
  sort_order: number;
  provider: PaymentProvider;
  /**
   * Optional wallet / account address. Currently unused by any flow
   * (kept on the row so a future auto-verification provider can
   * pick it up without a schema change).
   */
  address: string | null;
  created_at: string;
};
