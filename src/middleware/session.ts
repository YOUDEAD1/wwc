import { session, type Context, type SessionFlavor } from 'grammy';

/** Multi-step admin input flow state. */
export type AdminFlow =
  | { type: 'add_category'; step: 'name'; data: { emoji?: string } }
  | { type: 'add_category'; step: 'emoji'; data: { name: string } }
  | { type: 'add_product'; step: 'name'; data: { category_id: number } }
  | { type: 'add_product'; step: 'price'; data: { category_id: number; name: string } }
  | {
      type: 'add_product';
      step: 'stock';
      data: { category_id: number; name: string; price: number };
    }
  | {
      type: 'add_product';
      step: 'warranty';
      data: { category_id: number; name: string; price: number; stock: number };
    }
  | {
      type: 'add_product';
      step: 'description';
      data: {
        category_id: number;
        name: string;
        price: number;
        stock: number;
        warranty?: string;
      };
    }
  | {
      type: 'add_product';
      step: 'note';
      data: {
        category_id: number;
        name: string;
        price: number;
        stock: number;
        warranty?: string;
        description?: string;
      };
    }
  | { type: 'add_payment'; step: 'name'; data: Record<string, never> }
  | { type: 'add_payment'; step: 'instructions'; data: { name: string } }
  | {
      type: 'add_payment';
      step: 'min_amount';
      data: { name: string; instructions: string };
    }
  | { type: 'set_text'; step: 'key'; data: Record<string, never> }
  | { type: 'set_text'; step: 'value'; data: { key: string } }
  | { type: 'set_emoji'; step: 'key'; data: Record<string, never> }
  | { type: 'set_emoji'; step: 'value'; data: { key: string } }
  | { type: 'set_color'; step: 'value'; data: { key: string } }
  | { type: 'announce'; step: 'text'; data: Record<string, never> }
  | { type: 'announce'; step: 'confirm'; data: { text: string } }
  | { type: 'set_channel'; step: 'value'; data: Record<string, never> }
  | { type: 'find_user'; step: 'query'; data: Record<string, never> }
  | { type: 'adjust_balance'; step: 'amount'; data: { telegram_id: number } }
  | { type: 'set_deposit_amount'; step: 'amount'; data: { deposit_id: number } }
  | { type: 'add_gift'; step: 'code'; data: Record<string, never> }
  | { type: 'add_gift'; step: 'amount'; data: { code: string } }
  | {
      type: 'add_gift';
      step: 'per_user_limit';
      data: { code: string; amount: number };
    }
  | {
      type: 'add_gift';
      step: 'max_redemptions';
      data: { code: string; amount: number; per_user_limit: number };
    };

/**
 * Multi-step user-side flow.
 *
 * `binance_payid_topup` is the Pay-ID + Order-ID flow. The user is
 * shown a one-time 6-digit note code which they paste into Binance
 * Pay's Remark field when sending USDT. They then send their Binance
 * order ID back to the bot, which records a pending deposit for an
 * admin to verify.
 */
export type UserFlow =
  | {
      type: 'binance_payid_topup';
      step: 'order_id';
      data: {
        method_id: number;
        method_name: string;
        note_code: string;
        /** ms-since-epoch when the user opened the screen; used to enforce a 30-min window */
        opened_at: number;
      };
    }
  | {
      /**
       * Capture an email address sent as a message after tapping "Set
       * Email" or "Change Email". `mode` distinguishes the two so we
       * can echo the right confirmation copy.
       */
      type: 'set_email';
      step: 'value';
      data: { mode: 'set' | 'change' };
    }
  | {
      /**
       * User is on the Redeem Gift Code screen — next plain-text
       * message they send is treated as a code to redeem.
       */
      type: 'redeem_gift';
      step: 'value';
      data: Record<string, never>;
    }
  | {
      /**
       * User is viewing the My Orders list — typing a public order
       * ID opens the detail screen for that order.
       */
      type: 'orders_lookup';
      step: 'value';
      data: Record<string, never>;
    };

export type SessionData = {
  /** Selected qty per product id, used by the shop product page */
  qty: Record<number, number>;
  /** Multi-step admin input flow, if any */
  adminFlow?: AdminFlow;
  /** Multi-step user input flow, if any (e.g. Binance Pay top-up). */
  userFlow?: UserFlow;
  /**
   * Whether we've already silently cleared any leftover persistent
   * reply keyboard for this user (one-time migration from earlier
   * bot versions that used a bottom keyboard).
   */
  kbCleared?: boolean;
};

export type SessionCtx = Context & SessionFlavor<SessionData>;

export const sessionMiddleware = session<SessionData, SessionCtx>({
  initial: (): SessionData => ({ qty: {} }),
});
