import { session, type Context, type SessionFlavor } from 'grammy';

/** Multi-step admin input flow state. */
export type AdminFlow =
  | { type: 'add_category'; step: 'name'; data: { emoji?: string } }
  | { type: 'add_category'; step: 'emoji'; data: { name: string } }
  | { type: 'add_product'; step: 'name'; data: { category_id: number } }
  | { type: 'add_product'; step: 'price'; data: { category_id: number; name: string } }
  | {
      // After price we ask: "Unlimited stock?" via two inline buttons
      // (Yes → set unlimited_stock=true and skip stock count; No → ask
      // for integer count). The "stock" step below remains the
      // integer-count step. We carry `unlimited` on data so the
      // finalize step can persist it.
      type: 'add_product';
      step: 'unlimited';
      data: { category_id: number; name: string; price: number };
    }
  | {
      type: 'add_product';
      step: 'stock';
      data: { category_id: number; name: string; price: number };
    }
  | {
      type: 'add_product';
      step: 'warranty';
      data: {
        category_id: number;
        name: string;
        price: number;
        stock: number;
        unlimited?: boolean;
      };
    }
  | {
      type: 'add_product';
      step: 'description';
      data: {
        category_id: number;
        name: string;
        price: number;
        stock: number;
        unlimited?: boolean;
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
        unlimited?: boolean;
        warranty?: string;
        description?: string;
      };
    }
  | {
      // After the note step, prompt for the per-product items pool
      // (the actual deliverables — emails+passwords, links, etc).
      // Multiline; one payload per line. Empty / Skip means no pool
      // and the buyer falls back to the manual-delivery placeholder.
      type: 'add_product';
      step: 'items';
      data: {
        category_id: number;
        name: string;
        price: number;
        stock: number;
        unlimited?: boolean;
        warranty?: string;
        description?: string;
        note?: string;
      };
    }
  // -------- Per-product inline editor (premium-shop overhaul) --------
  // Each step waits for ONE message of the appropriate kind.
  | { type: 'edit_product_emoji'; step: 'premium'; data: { product_id: number; page: number } }
  | { type: 'edit_product_note_text'; step: 'text'; data: { product_id: number; page: number } }
  | { type: 'edit_product_tutorial_text'; step: 'text'; data: { product_id: number; page: number } }
  | { type: 'edit_product_tutorial_file'; step: 'file'; data: { product_id: number; page: number } }
  | { type: 'edit_product_tutorial_url'; step: 'url'; data: { product_id: number; page: number } }
  | { type: 'edit_product_items'; step: 'items'; data: { product_id: number; page: number } }
  | { type: 'edit_product_price'; step: 'price'; data: { product_id: number; page: number } }
  | { type: 'edit_product_stock'; step: 'stock'; data: { product_id: number; page: number } }
  | { type: 'edit_product_name'; step: 'name'; data: { product_id: number; page: number } }
  // -------- Bot Tutorial editor (Settings → Bot Tutorial → Edit) --------
  | { type: 'edit_bot_tutorial_text'; step: 'text'; data: Record<string, never> }
  | { type: 'edit_bot_tutorial_file'; step: 'file'; data: Record<string, never> }
  | { type: 'edit_bot_tutorial_url'; step: 'url'; data: Record<string, never> }
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
  | { type: 'set_btnicon'; step: 'value'; data: { btnKey: string } }
  | { type: 'set_color'; step: 'value'; data: { key: string } }
  | { type: 'set_color_glyph'; step: 'value'; data: { mode: string } }
  | { type: 'announce'; step: 'text'; data: Record<string, never> }
  | { type: 'announce'; step: 'confirm'; data: { text: string } }
  | { type: 'set_channel'; step: 'value'; data: Record<string, never> }
  | { type: 'find_user'; step: 'query'; data: Record<string, never> }
  | { type: 'adjust_balance'; step: 'amount'; data: { telegram_id: number } }
  | {
      // Step 1 of the Custom-Prices flow — admin entered the menu and
      // is being asked to identify which user the overrides apply to.
      type: 'price_overrides_pick_user';
      step: 'query';
      data: Record<string, never>;
    }
  | {
      // Admin tapped "Set/edit override" on a specific product and
      // is now being asked for the override price (numeric, USD).
      type: 'price_override_set';
      step: 'price';
      data: { telegram_id: number; product_id: number };
    }
  | {
      // Admin tapped "Bulk paste" — they'll send a multi-line block
      // of `<product_id> <price>` lines that we apply atomically.
      type: 'price_override_bulk';
      step: 'block';
      data: { telegram_id: number };
    }
  | { type: 'ban_user'; step: 'reason'; data: { telegram_id: number } }
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
    }
  // -------- Promo (qty-threshold flat-USDT discount) flow --------
  // Multi-step `/promo add` wizard. The admin walks through:
  //   scope → (user?) → (product?) → min_qty → discount → (name?)
  // and we materialize the row at the very end. The intermediate
  // `data` carries forward only what's been collected so far so the
  // type narrows naturally per step.
  | {
      type: 'promo_add';
      step: 'pick_user';
      data: { scope: 'user' | 'user_product' };
    }
  | {
      // Awaiting a product callback. Used both when scope is
      // "product" (telegram_id stays null) and when scope is
      // "user_product" (telegram_id was just resolved in pick_user).
      type: 'promo_add';
      step: 'pick_product';
      data: { scope: 'product' | 'user_product'; telegram_id: number | null };
    }
  | {
      type: 'promo_add';
      step: 'min_qty';
      data: {
        scope: 'default' | 'product' | 'user' | 'user_product';
        product_id: number | null;
        telegram_id: number | null;
      };
    }
  | {
      type: 'promo_add';
      step: 'discount';
      data: {
        scope: 'default' | 'product' | 'user' | 'user_product';
        product_id: number | null;
        telegram_id: number | null;
        min_qty: number;
      };
    }
  | {
      type: 'promo_add';
      step: 'name';
      data: {
        scope: 'default' | 'product' | 'user' | 'user_product';
        product_id: number | null;
        telegram_id: number | null;
        min_qty: number;
        discount_amount: number;
      };
    }
  // Single-field edits invoked from the promo edit card.
  | { type: 'promo_edit_qty'; step: 'value'; data: { promo_id: number } }
  | { type: 'promo_edit_discount'; step: 'value'; data: { promo_id: number } }
  | { type: 'promo_edit_name'; step: 'value'; data: { promo_id: number } };

/**
 * Multi-step user-side flow.
 */
export type UserFlow =
  | {
      /**
       * Capture an email address sent as a message after tapping "Set
       * Email" or "Change Email". `mode` distinguishes the two so we
       * can echo the right confirmation copy.
       *
       * `postPurchase` is set when the flow is entered via the
       * post-delivery `Add Verified Email` CTA (vs. Settings →
       * Email). When true the message handler:
       *   - auto-deletes the user's typed-email message + the saved
       *     "Has been Saved!" confirmation card
       *   - drops a single bold "Email has been setuped" line
       *   - fires a retroactive invoice email for `pendingInvoiceOrderId`.
       */
      type: 'set_email';
      step: 'value';
      data: {
        mode: 'set' | 'change';
        postPurchase?: boolean;
        pendingInvoiceOrderId?: number;
        promptChatId?: number;
        promptMessageId?: number;
      };
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
    }
  | {
      /**
       * User opened the *Custom Quantity* keypad on a product page.
       * While this flow is active any plain-text reply is parsed as
       * a quantity (concatenation, not arithmetic — `1` then `1`
       * yields `11`). On a successful submit the bot deletes both
       * the keypad prompt and the user's reply so the chat stays
       * clean. `promptChatId` / `promptMessageId` track the prompt
       * message so it can be edited and ultimately deleted.
       */
      type: 'qty_keypad';
      step: 'await_qty';
      data: {
        productId: number;
        promptChatId: number;
        promptMessageId?: number;
      };
    }
  | {
      /**
       * User is in a Live Support relay session. While this flow is
       * active, every non-command message they send is forwarded to
       * the admin (and admin's replies come back here).
       *
       * `panelMessageId` is the id of the pinned "Live Support" panel
       * message in the user's General chat — we keep it so the cancel
       * callback can unpin and delete the same message instead of
       * guessing from `ctx`.
       *
       * `userTopicId` / `adminTopicId` are the forum-topic message
       * thread ids on the user's and admin's side respectively, when
       * the bot has forum topics enabled in @BotFather. Cancel/end
       * deletes both topics, which removes every relayed message
       * inside them in one shot.
       */
      type: 'live_support';
      step: 'connected';
      data: {
        startedAt: number;
        panelMessageId?: number;
        userTopicId?: number;
        adminTopicId?: number;
      };
    };

export type SessionData = {
  /** Selected qty per product id, used by the shop product page */
  qty: Record<number, number>;
  /**
   * In-progress digit buffer per product id — populated only while
   * the user has the *Custom Quantity* keypad open. Stored as a
   * string so taps and direct-typed numbers can both append cleanly
   * without arithmetic surprises (e.g. `1` + `1` → `"11"`).
   */
  qtyInput?: Record<number, string>;
  /** Multi-step admin input flow, if any */
  adminFlow?: AdminFlow;
  /** Multi-step user input flow, if any. */
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
