/**
 * Thin wrappers around Supabase queries. Keep all SQL access here so
 * callers don't have to know about the underlying client.
 */
import { supabase } from './supabase.js';
import type {
  DBUser,
  DBCategory,
  DBProduct,
  DBOrder,
  DBDeposit,
  DBPaymentMethod,
  DBWalletLedger,
  DBGiftCode,
  DBGiftCodeRedemption,
  DBUserPriceOverride,
  DBPromo,
  DBOrderDeliverySubmission,
  DeliveryFieldSpec,
  PaymentProvider,
  OrderIntent,
} from '../types.js';
import type { Lang } from '../../config/index.js';
import { logger } from '../logger.js';

// ---------- Users ----------

function makeRefCode(id: number): string {
  return `R${id.toString(36).toUpperCase()}`;
}

export async function getOrCreateUser(args: {
  telegram_id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  language: Lang;
  referred_by?: number | null;
}): Promise<DBUser> {
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', args.telegram_id)
    .maybeSingle();

  if (existing) {
    // Touch last_seen_at and refresh username/first_name in case it changed.
    await supabase
      .from('users')
      .update({
        username: args.username ?? existing.username,
        first_name: args.first_name ?? existing.first_name,
        last_name: args.last_name ?? existing.last_name,
        last_seen_at: new Date().toISOString(),
      })
      .eq('telegram_id', args.telegram_id);
    // Default wallet_alert to true for rows pre-dating migration 0008
    // so the Notifications screen renders with a sensible default.
    const out = {
      ...(existing as DBUser),
      wallet_alert:
        (existing as { wallet_alert?: boolean }).wallet_alert ?? true,
    } as DBUser & { __just_created?: boolean };
    out.__just_created = false;
    return out;
  }

  const ref_code = makeRefCode(args.telegram_id);
  const insert = {
    telegram_id: args.telegram_id,
    username: args.username ?? null,
    first_name: args.first_name ?? null,
    last_name: args.last_name ?? null,
    language: args.language,
    ref_code,
    referred_by: args.referred_by ?? null,
  };
  const { data, error } = await supabase.from('users').insert(insert).select('*').single();
  if (error || !data) {
    logger.error({ err: error }, 'getOrCreateUser failed');
    throw error ?? new Error('Failed to create user');
  }
  if (args.referred_by && args.referred_by !== args.telegram_id) {
    await supabase
      .from('referrals')
      .insert({ referrer_id: args.referred_by, referee_id: args.telegram_id })
      .then(() => {});
  }
  const created = data as DBUser & { __just_created?: boolean };
  created.__just_created = true;
  return created;
}

export async function setUserLanguage(telegram_id: number, language: Lang): Promise<void> {
  await supabase.from('users').update({ language }).eq('telegram_id', telegram_id);
}

/**
 * Set the user's region + IANA timezone in one call. Either field
 * may be cleared by passing `null`.
 *
 * Throws (with a logged error) when the UPDATE fails — typically the
 * `region`/`timezone` columns are missing because migration 0005 was
 * never applied.
 */
export async function setUserRegion(
  telegram_id: number,
  region: string | null,
  timezone: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ region, timezone })
    .eq('telegram_id', telegram_id);
  if (error) {
    logger.error({ err: error, telegram_id }, 'setUserRegion failed');
    throw error;
  }
}

/**
 * Set the user's contact email (`null` clears it).
 *
 * Throws on UPDATE failure — typically the `email` column is missing
 * because migration 0005 was never applied. We surface the error so
 * the caller can show the user a useful message instead of silently
 * "succeeding" while the value is dropped.
 */
export async function setUserEmail(telegram_id: number, email: string | null): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ email })
    .eq('telegram_id', telegram_id);
  if (error) {
    logger.error({ err: error, telegram_id }, 'setUserEmail failed');
    throw error;
  }
}

/**
 * Look up the telegram_id of any user that already has the given
 * email saved. Returns `null` when no row matches. Comparison is
 * case-insensitive (Postgres `ilike` with no wildcards) so
 * `Foo@Bar.com` and `foo@bar.com` collide as expected. Used by the
 * Set / Change Email flows to enforce one-email-per-user.
 */
export async function findUserByEmail(email: string): Promise<number | null> {
  const trimmed = email.trim();
  if (!trimmed) return null;
  const { data, error } = await supabase
    .from('users')
    .select('telegram_id')
    .ilike('email', trimmed)
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.error({ err: error, email: trimmed }, 'findUserByEmail failed');
    return null;
  }
  return (data as { telegram_id: number } | null)?.telegram_id ?? null;
}

/** Set the user's status string (`null` clears it). */
export async function setUserStatus(telegram_id: number, status: string | null): Promise<void> {
  await supabase.from('users').update({ status }).eq('telegram_id', telegram_id);
}

export async function setUserBalance(telegram_id: number, balance: number): Promise<void> {
  await supabase.from('users').update({ balance }).eq('telegram_id', telegram_id);
}

export async function adjustBalance(telegram_id: number, delta: number): Promise<number> {
  const { data: u } = await supabase
    .from('users')
    .select('balance')
    .eq('telegram_id', telegram_id)
    .single();
  const next = Number(u?.balance ?? 0) + delta;
  await supabase.from('users').update({ balance: next }).eq('telegram_id', telegram_id);
  return next;
}

/**
 * Toggle the "Email Reports" preference. Stored as the inverse of
 * `email_nag_disabled` so the existing `false → on, true → off`
 * semantics on the rest of the notify columns still hold for the UI
 * label generator. Returns the new state (true = email reports ON).
 */
export async function toggleEmailReports(telegram_id: number): Promise<boolean> {
  const { data, error: selectErr } = await supabase
    .from('users')
    .select('email_nag_disabled')
    .eq('telegram_id', telegram_id)
    .single();
  if (selectErr) {
    logger.error({ err: selectErr, telegram_id }, 'toggleEmailReports select failed');
    throw selectErr;
  }
  const cur = Boolean((data as { email_nag_disabled?: boolean } | null)?.email_nag_disabled);
  const nextDisabled = !cur;
  const { error } = await supabase
    .from('users')
    .update({ email_nag_disabled: nextDisabled })
    .eq('telegram_id', telegram_id);
  if (error) {
    logger.error({ err: error, telegram_id }, 'toggleEmailReports update failed');
    throw error;
  }
  return !nextDisabled;
}

/**
 * Mark `now()` as the last time the bot sent the 12h "please add an
 * email" nag for this user, so we don't spam them on every interaction.
 */
export async function markEmailNagSent(telegram_id: number): Promise<void> {
  await supabase
    .from('users')
    .update({ last_email_nag_at: new Date().toISOString() })
    .eq('telegram_id', telegram_id);
}

export async function toggleNotification(
  telegram_id: number,
  field: 'stock_alert' | 'announcements' | 'wallet_alert',
): Promise<boolean> {
  const { data: u, error: selectErr } = await supabase
    .from('users')
    .select(field)
    .eq('telegram_id', telegram_id)
    .single();
  if (selectErr) {
    // Most common cause: the `wallet_alert` column is missing because
    // migration 0008 was never applied. Surface so the caller can show
    // a useful message instead of leaving the spinner up.
    logger.error({ err: selectErr, telegram_id, field }, 'toggleNotification select failed');
    throw selectErr;
  }
  // u may be null on race; default to false
  const cur = Boolean((u as Record<string, unknown> | null)?.[field]);
  const next = !cur;
  const { error: updateErr } = await supabase
    .from('users')
    .update({ [field]: next })
    .eq('telegram_id', telegram_id);
  if (updateErr) {
    logger.error({ err: updateErr, telegram_id, field }, 'toggleNotification update failed');
    throw updateErr;
  }
  return next;
}

export async function countReferrals(telegram_id: number): Promise<number> {
  const { count } = await supabase
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_id', telegram_id);
  return count ?? 0;
}

/**
 * Count referrals made by `telegram_id` within the last `windowMs`
 * milliseconds. Used by the Refer & Earn screen to render the 24-hour
 * and 7-day breakdowns.
 */
export async function countReferralsSince(
  telegram_id: number,
  windowMs: number,
): Promise<number> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count } = await supabase
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_id', telegram_id)
    .gte('created_at', since);
  return count ?? 0;
}

/**
 * Read referral-earning totals for a user. Defaults to all zeroes if
 * migration 0009 has not yet been applied (the columns are missing,
 * so the SELECT returns no row data for them).
 */
export async function getReferralEarnings(
  telegram_id: number,
): Promise<{
  total: number;
  available: number;
  transferred: number;
  withdrawn: number;
}> {
  const { data, error } = await supabase
    .from('users')
    .select(
      'referral_earned_total, referral_available, referral_transferred, referral_withdrawn',
    )
    .eq('telegram_id', telegram_id)
    .maybeSingle();
  if (error) {
    // Most likely cause: migration 0009 not applied yet — columns
    // missing. Show zeroes so the screen still renders instead of
    // throwing the user back to a generic error.
    logger.warn(
      { err: error, telegram_id },
      'getReferralEarnings select failed (apply migration 0009?)',
    );
    return { total: 0, available: 0, transferred: 0, withdrawn: 0 };
  }
  const row = (data ?? {}) as Record<string, unknown>;
  const num = (k: string): number => {
    const v = row[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return Number(v) || 0;
    return 0;
  };
  return {
    total: num('referral_earned_total'),
    available: num('referral_available'),
    transferred: num('referral_transferred'),
    withdrawn: num('referral_withdrawn'),
  };
}

// ---------- Admins ----------

export async function isAdmin(telegram_id: number): Promise<boolean> {
  const { data } = await supabase
    .from('admins')
    .select('telegram_id')
    .eq('telegram_id', telegram_id)
    .maybeSingle();
  return Boolean(data);
}

// ---------- Categories ----------

export async function listCategories(): Promise<DBCategory[]> {
  const { data } = await supabase
    .from('categories')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  return (data ?? []) as DBCategory[];
}

export async function getCategory(id: number): Promise<DBCategory | null> {
  const { data } = await supabase.from('categories').select('*').eq('id', id).maybeSingle();
  return (data as DBCategory) ?? null;
}

export async function addCategory(name: string, emoji?: string): Promise<DBCategory> {
  const { data, error } = await supabase
    .from('categories')
    .insert({ name, emoji: emoji ?? null })
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('addCategory failed');
  return data as DBCategory;
}

// ---------- Products ----------

export async function listProducts(
  categoryId: number,
  page: number,
  perPage: number,
): Promise<{ rows: DBProduct[]; total: number }> {
  const from = page * perPage;
  const to = from + perPage - 1;
  const { data, count } = await supabase
    .from('products')
    .select('*', { count: 'exact' })
    .eq('category_id', categoryId)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to);
  return { rows: (data ?? []) as DBProduct[], total: count ?? 0 };
}

export async function getProduct(id: number): Promise<DBProduct | null> {
  const { data } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
  return (data as DBProduct) ?? null;
}

export async function addProduct(p: {
  category_id: number;
  name: string;
  price: number;
  stock: number;
  warranty?: string;
  description?: string;
  note?: string;
  emoji?: string | null;
  emoji_id?: string | null;
  unlimited_stock?: boolean;
}): Promise<DBProduct> {
  const { data, error } = await supabase.from('products').insert(p).select('*').single();
  if (error || !data) throw error ?? new Error('addProduct failed');
  return data as DBProduct;
}

/**
 * Patch any subset of editable product fields. Used by the admin
 * product-edit screen to set the per-product premium emoji, the
 * View Note attachment, the Using Method tutorial, the unlimited
 * stock flag, etc.
 */
export async function updateProduct(
  id: number,
  patch: Partial<{
    name: string;
    price: number;
    stock: number;
    warranty: string | null;
    description: string | null;
    note: string | null;
    emoji: string | null;
    emoji_id: string | null;
    note_file_id: string | null;
    note_file_name: string | null;
    note_file_mime: string | null;
    tutorial_text: string | null;
    tutorial_file_id: string | null;
    tutorial_file_type: 'photo' | 'video' | 'document' | null;
    tutorial_url: string | null;
    unlimited_stock: boolean;
    // Per-product post-purchase delivery form.
    delivery_form_enabled: boolean;
    delivery_instruction: string | null;
    delivery_fields: DeliveryFieldSpec[];
    delivery_success_message: string | null;
    delivery_vendor_chat_id: number | null;
    delivery_vendor_label: string | null;
    // Pinning + OOS auto-reorder (migration 0025).
    is_pinned: boolean;
    stashed_sort_order: number | null;
  }>,
): Promise<void> {
  // When the caller is editing `stock` we capture the pre-write
  // value so a transition across zero (in <-> out of stock) can
  // trigger the auto-reorder side-effect after the write lands.
  let beforeStock: number | null = null;
  if (patch.stock !== undefined) {
    const { data: snap } = await supabase
      .from('products')
      .select('stock')
      .eq('id', id)
      .maybeSingle();
    beforeStock = Number((snap as { stock?: number } | null)?.stock ?? 0);
  }
  const { error } = await supabase.from('products').update(patch).eq('id', id);
  if (error) {
    logger.error({ err: error, id, patch }, 'updateProduct failed');
    throw error;
  }
  if (beforeStock !== null && patch.stock !== undefined) {
    const afterStock = Number(patch.stock);
    await applyStockTransition(id, beforeStock, afterStock).catch((err) => {
      logger.warn(
        { err, id },
        'applyStockTransition after updateProduct(stock) failed',
      );
    });
  }
}

// =====================================================================
// Pinning + out-of-stock auto-reorder (migration 0025)
// =====================================================================

/**
 * Sentinel `sort_order` value used to slam unpinned products to the
 * very end of the catalog when they run out of stock. The catalog
 * read query orders by `(sort_order ASC, id ASC)` so any row with
 * this value naturally falls behind every normally-ordered row.
 *
 * Picked well below int4's `2_147_483_647` ceiling but high enough
 * that no realistic manual ordering could ever collide.
 */
export const OUT_OF_STOCK_SORT_ORDER = 1_000_000_000;

/**
 * Detect and apply an out-of-stock / restock transition for a
 * product. Callers pass the stock value *before* their write and
 * *after* their write — the helper only fires when those cross
 * zero in either direction. This keeps the side-effect bound to
 * real state transitions and prevents a re-fire when the admin
 * manually repositioned an out-of-stock row (no stock change → no
 * transition → no auto-move-to-end).
 *
 * No-op when the product is pinned (`is_pinned = true`) or marked
 * `unlimited_stock` (catalog renders ∞, never goes OOS).
 */
export async function applyStockTransition(
  product_id: number,
  beforeStock: number,
  afterStock: number,
): Promise<void> {
  const wasInStock = beforeStock > 0;
  const isInStock = afterStock > 0;
  if (wasInStock === isInStock) return;
  const { data } = await supabase
    .from('products')
    .select('sort_order, stashed_sort_order, is_pinned, unlimited_stock')
    .eq('id', product_id)
    .maybeSingle();
  if (!data) return;
  const p = data as {
    sort_order: number;
    stashed_sort_order: number | null;
    is_pinned: boolean | null;
    unlimited_stock: boolean | null;
  };
  if (p.is_pinned === true) return;
  if (p.unlimited_stock === true) return;
  // OOS transition: stash the current admin-placed sort_order and
  // sink the row to the bottom of the catalog. The `stashed_sort_order
  // is null` guard makes the operation idempotent — re-runs on an
  // already-stashed row are no-ops.
  if (!isInStock && p.stashed_sort_order === null) {
    const { error } = await supabase
      .from('products')
      .update({
        stashed_sort_order: p.sort_order,
        sort_order: OUT_OF_STOCK_SORT_ORDER,
      })
      .eq('id', product_id);
    if (error) {
      logger.warn(
        { err: error, product_id },
        'applyStockTransition: OOS stash failed',
      );
    }
    return;
  }
  // Restock transition: pop the row back to its old slot.
  if (isInStock && p.stashed_sort_order !== null) {
    const { error } = await supabase
      .from('products')
      .update({
        sort_order: p.stashed_sort_order,
        stashed_sort_order: null,
      })
      .eq('id', product_id);
    if (error) {
      logger.warn(
        { err: error, product_id },
        'applyStockTransition: restock restore failed',
      );
    }
  }
}

/**
 * Toggle the per-product "pin position" flag. Pinning while the
 * product is currently auto-OOS-stashed *restores* the original
 * sort_order so the pinned position is the admin-set one rather
 * than the synthetic bottom-of-the-list sentinel. Unpinning kicks
 * off a stock-state reconciliation so a previously-pinned OOS row
 * slides to the bottom immediately rather than waiting for the
 * next stock change.
 */
export async function setProductPinned(
  id: number,
  pinned: boolean,
): Promise<void> {
  const { data } = await supabase
    .from('products')
    .select('stashed_sort_order, stock, unlimited_stock')
    .eq('id', id)
    .maybeSingle();
  const row = data as
    | {
        stashed_sort_order: number | null;
        stock: number | null;
        unlimited_stock: boolean | null;
      }
    | null;
  if (pinned) {
    if (row && row.stashed_sort_order !== null) {
      await supabase
        .from('products')
        .update({
          is_pinned: true,
          sort_order: row.stashed_sort_order,
          stashed_sort_order: null,
        })
        .eq('id', id);
      return;
    }
    await supabase.from('products').update({ is_pinned: true }).eq('id', id);
    return;
  }
  await supabase.from('products').update({ is_pinned: false }).eq('id', id);
  // After unpinning, force a state reconciliation so a currently-
  // OOS row slides to the catalog bottom right away. We fake a
  // "in-stock -> OOS" transition via applyStockTransition so the
  // existing stash + slam path handles the move.
  if (!row || row.unlimited_stock === true) return;
  const stock = Number(row.stock ?? 0);
  if (stock <= 0 && row.stashed_sort_order === null) {
    await applyStockTransition(id, 1, 0).catch((err) => {
      logger.warn({ err, id }, 'setProductPinned: post-unpin reconcile failed');
    });
  }
}

/**
 * Move a product to the very top of the catalog. Bumps its
 * `sort_order` to one less than the current minimum, ignoring rows
 * currently auto-OOS-stashed at `OUT_OF_STOCK_SORT_ORDER` so the new
 * top isn't out-paced by an OOS row's sentinel value. Clears the
 * stash for the moved row — the admin took an explicit position
 * decision; we don't want a later restock to overwrite that.
 */
export async function moveProductToTop(id: number): Promise<void> {
  const { data } = await supabase
    .from('products')
    .select('sort_order')
    .lt('sort_order', OUT_OF_STOCK_SORT_ORDER)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  const min = data ? Number((data as { sort_order: number }).sort_order) : 0;
  await supabase
    .from('products')
    .update({ sort_order: min - 1, stashed_sort_order: null })
    .eq('id', id);
}

/**
 * Move a product to the end of the *in-stock* portion of the
 * catalog (i.e. after every non-OOS-stashed row but ahead of any
 * rows sitting at the OOS sentinel). Clears the stash for the same
 * reason as `moveProductToTop` — the admin's manual placement wins.
 */
export async function moveProductToBottom(id: number): Promise<void> {
  const { data } = await supabase
    .from('products')
    .select('sort_order')
    .lt('sort_order', OUT_OF_STOCK_SORT_ORDER)
    .order('sort_order', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  const max = data ? Number((data as { sort_order: number }).sort_order) : 0;
  await supabase
    .from('products')
    .update({ sort_order: max + 1, stashed_sort_order: null })
    .eq('id', id);
}

/**
 * Restore a previously auto-OOS-stashed row's `sort_order` so the
 * admin's manual ↑ / ↓ swap operates on a real catalog position
 * rather than the OOS sentinel. No-op when there's no stash. Used
 * by the admin reorder callback to make ↑ / ↓ behave intuitively
 * for OOS rows without requiring a pin or a Top/Bottom detour.
 */
export async function unstashSortOrder(id: number): Promise<void> {
  const { data } = await supabase
    .from('products')
    .select('stashed_sort_order')
    .eq('id', id)
    .maybeSingle();
  const stashed = (data as { stashed_sort_order: number | null } | null)
    ?.stashed_sort_order;
  if (stashed === null || stashed === undefined) return;
  await supabase
    .from('products')
    .update({ sort_order: stashed, stashed_sort_order: null })
    .eq('id', id);
}

// ---------- Post-purchase delivery submissions ----------

/**
 * Fetch the existing delivery submission for an order, if any.
 * Used by:
 *   - "Edit Details" to pre-fill the form with the previous answers
 *     so the buyer can correct individual fields without re-typing
 *     the whole thing.
 *   - The admin-help URL builder to embed the buyer's submitted
 *     payload in the deep-link auto-text.
 */
export async function getDeliverySubmission(
  order_id: number,
): Promise<DBOrderDeliverySubmission | null> {
  const { data, error } = await supabase
    .from('order_delivery_submissions')
    .select('*')
    .eq('order_id', order_id)
    .maybeSingle();
  if (error) {
    logger.error({ err: error, order_id }, 'getDeliverySubmission failed');
    return null;
  }
  if (!data) return null;
  return {
    id: Number((data as { id: number | string }).id),
    order_id: Number((data as { order_id: number | string }).order_id),
    user_id: Number((data as { user_id: number | string }).user_id),
    product_id: Number((data as { product_id: number | string }).product_id),
    payload: (data as { payload: Record<string, string> }).payload ?? {},
    revision: Number((data as { revision: number | string }).revision),
    submitted_at: String((data as { submitted_at: string }).submitted_at),
    updated_at: String((data as { updated_at: string }).updated_at),
  };
}

/**
 * Upsert a delivery submission. On first submit we insert with
 * `revision = 1`. On resubmit (edit-and-resend) we update in place
 * and bump `revision` so the vendor DM can label it as corrected.
 *
 * Returns the resulting row (including the assigned `revision`).
 */
export async function upsertDeliverySubmission(args: {
  order_id: number;
  user_id: number;
  product_id: number;
  payload: Record<string, string>;
}): Promise<DBOrderDeliverySubmission> {
  const existing = await getDeliverySubmission(args.order_id);
  if (!existing) {
    const { data, error } = await supabase
      .from('order_delivery_submissions')
      .insert({
        order_id: args.order_id,
        user_id: args.user_id,
        product_id: args.product_id,
        payload: args.payload,
        revision: 1,
      })
      .select('*')
      .single();
    if (error || !data) {
      logger.error({ err: error, args }, 'upsertDeliverySubmission insert failed');
      throw error ?? new Error('upsertDeliverySubmission insert failed');
    }
    return {
      id: Number((data as { id: number | string }).id),
      order_id: Number((data as { order_id: number | string }).order_id),
      user_id: Number((data as { user_id: number | string }).user_id),
      product_id: Number((data as { product_id: number | string }).product_id),
      payload: (data as { payload: Record<string, string> }).payload ?? {},
      revision: Number((data as { revision: number | string }).revision),
      submitted_at: String((data as { submitted_at: string }).submitted_at),
      updated_at: String((data as { updated_at: string }).updated_at),
    };
  }
  const nextRevision = existing.revision + 1;
  const { data, error } = await supabase
    .from('order_delivery_submissions')
    .update({
      payload: args.payload,
      revision: nextRevision,
      updated_at: new Date().toISOString(),
    })
    .eq('order_id', args.order_id)
    .select('*')
    .single();
  if (error || !data) {
    logger.error({ err: error, args }, 'upsertDeliverySubmission update failed');
    throw error ?? new Error('upsertDeliverySubmission update failed');
  }
  return {
    id: Number((data as { id: number | string }).id),
    order_id: Number((data as { order_id: number | string }).order_id),
    user_id: Number((data as { user_id: number | string }).user_id),
    product_id: Number((data as { product_id: number | string }).product_id),
    payload: (data as { payload: Record<string, string> }).payload ?? {},
    revision: Number((data as { revision: number | string }).revision),
    submitted_at: String((data as { submitted_at: string }).submitted_at),
    updated_at: String((data as { updated_at: string }).updated_at),
  };
}

/**
 * Change the ID of a product. Updates the product row and re-links
 * all product_items rows to the new ID so the items pool stays intact.
 */
export async function changeProductId(oldId: number, newId: number): Promise<void> {
  const { data: product, error: fetchErr } = await supabase
    .from('products')
    .select('*')
    .eq('id', oldId)
    .single();
  if (fetchErr || !product) throw fetchErr ?? new Error('Product not found');

  const { id: _id, ...rest } = product as Record<string, unknown>;
  const { error: insertErr } = await supabase
    .from('products')
    .insert({ ...rest, id: newId });
  if (insertErr) {
    logger.error({ err: insertErr, oldId, newId }, 'changeProductId insert failed');
    throw insertErr;
  }
  const { error: itemsErr } = await supabase
    .from('product_items')
    .update({ product_id: newId })
    .eq('product_id', oldId);
  if (itemsErr) {
    logger.error({ err: itemsErr, oldId, newId }, 'changeProductId re-link items failed');
    throw itemsErr;
  }
  const { error: delErr } = await supabase.from('products').delete().eq('id', oldId);
  if (delErr) {
    logger.error({ err: delErr, oldId, newId }, 'changeProductId delete old failed');
    throw delErr;
  }
}

/**
 * Add a single line of payload to the per-product items pool. Returns
 * the inserted row.
 */
export async function addProductItems(
  product_id: number,
  payloads: string[],
): Promise<number> {
  if (payloads.length === 0) return 0;
  const rows = payloads.map((payload) => ({ product_id, payload }));
  const { error } = await supabase.from('product_items').insert(rows);
  if (error) {
    logger.error({ err: error, product_id }, 'addProductItems failed');
    throw error;
  }
  await syncProductStockToPool(product_id).catch((err) => {
    logger.warn(
      { err, product_id },
      'syncProductStockToPool after addProductItems failed',
    );
  });
  return rows.length;
}

/** Count unconsumed items in the pool (for the admin card). */
export async function countAvailableProductItems(product_id: number): Promise<number> {
  const { count, error } = await supabase
    .from('product_items')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', product_id)
    .is('consumed_at', null);
  if (error) {
    logger.error({ err: error, product_id }, 'countAvailableProductItems failed');
    return 0;
  }
  return count ?? 0;
}

/**
 * List unconsumed items in the pool — used by the admin Stock
 * Inspection screen so the operator can audit remaining accounts /
 * links / codes for a product. Returned in claim order (oldest
 * first) so the next purchase will pull from the top of this list.
 */
export async function listAvailableProductItems(
  product_id: number,
  limit = 200,
): Promise<{ id: number; payload: string; created_at: string }[]> {
  const { data, error } = await supabase
    .from('product_items')
    .select('id, payload, created_at')
    .eq('product_id', product_id)
    .is('consumed_at', null)
    .order('id', { ascending: true })
    .limit(limit);
  if (error) {
    logger.error({ err: error, product_id }, 'listAvailableProductItems failed');
    return [];
  }
  return (data ?? []).map((r) => ({
    id: Number(r.id),
    payload: String(r.payload),
    created_at: String(r.created_at),
  }));
}

/** Wipe every item (consumed or not) from the pool. */
export async function clearProductItems(product_id: number): Promise<void> {
  const { error } = await supabase
    .from('product_items')
    .delete()
    .eq('product_id', product_id);
  if (error) {
    logger.error({ err: error, product_id }, 'clearProductItems failed');
    throw error;
  }
  await syncProductStockToPool(product_id).catch((err) => {
    logger.warn({ err, product_id }, 'syncProductStockToPool after clear failed');
  });
}

/**
 * Delete a single (still-unconsumed) item from the pool. Used by the
 * admin Stock Inspection screen so the bot owner can prune accidental
 * uploads without wiping the whole pool. Re-syncs `products.stock`
 * after deletion so the catalog count never lies.
 */
export async function deleteProductItem(item_id: number): Promise<number | null> {
  const { data: row, error: fetchErr } = await supabase
    .from('product_items')
    .select('id, product_id')
    .eq('id', item_id)
    .maybeSingle();
  if (fetchErr) {
    logger.error({ err: fetchErr, item_id }, 'deleteProductItem fetch failed');
    throw fetchErr;
  }
  if (!row) return null;
  const product_id = Number(row.product_id);
  const { error } = await supabase
    .from('product_items')
    .delete()
    .eq('id', item_id);
  if (error) {
    logger.error({ err: error, item_id }, 'deleteProductItem failed');
    throw error;
  }
  await syncProductStockToPool(product_id).catch((err) => {
    logger.warn(
      { err, product_id },
      'syncProductStockToPool after deleteProductItem failed',
    );
  });
  return product_id;
}

/**
 * Bring `products.stock` back in line with the live count of
 * unconsumed items in the pool. No-op when the product is marked
 * `unlimited_stock` (the catalog renders ∞ and we don't track a
 * count for those rows). Skips silently on legacy schemas missing
 * the `unlimited_stock` column.
 */
export async function syncProductStockToPool(product_id: number): Promise<void> {
  const remaining = await countAvailableProductItems(product_id);
  let unlimited = false;
  let beforeStock = 0;
  const { data: full, error: fullErr } = await supabase
    .from('products')
    .select('stock, unlimited_stock')
    .eq('id', product_id)
    .maybeSingle();
  if (!fullErr && full) {
    unlimited = Boolean((full as { unlimited_stock?: boolean }).unlimited_stock);
    beforeStock = Number((full as { stock?: number }).stock ?? 0);
  }
  if (unlimited) return;
  await supabase.from('products').update({ stock: remaining }).eq('id', product_id);
  await applyStockTransition(product_id, beforeStock, remaining).catch((err) => {
    logger.warn(
      { err, product_id },
      'applyStockTransition after syncProductStockToPool failed',
    );
  });
}

/**
 * Claim up to `qty` unconsumed items from the pool and mark them as
 * consumed by the given order. Returns the payload strings (in the
 * order they were claimed). When the pool is short, returns whatever
 * was available so the caller can fall back to a manual-delivery
 * placeholder.
 */
export async function claimProductItems(
  product_id: number,
  qty: number,
  order_id: number,
): Promise<string[]> {
  const { data: rows, error } = await supabase
    .from('product_items')
    .select('id, payload')
    .eq('product_id', product_id)
    .is('consumed_at', null)
    .order('id', { ascending: true })
    .limit(Math.max(0, qty));
  if (error) {
    logger.error({ err: error, product_id, qty }, 'claimProductItems select failed');
    return [];
  }
  if (!rows || rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const now = new Date().toISOString();
  const { error: upd } = await supabase
    .from('product_items')
    .update({ consumed_at: now, consumed_order_id: order_id })
    .in('id', ids);
  if (upd) {
    logger.error({ err: upd, ids }, 'claimProductItems update failed');
  }
  return rows.map((r) => String(r.payload));
}

export async function decrementProductStock(id: number, qty: number): Promise<void> {
  // Guard against the case where migration 0015 has NOT been applied
  // (no `unlimited_stock` column). We attempt the columned select
  // first and fall back to the legacy `stock`-only select on column
  // errors so the buy flow keeps working on older schemas.
  let unlimited = false;
  let cur = 0;
  const { data: full, error: fullErr } = await supabase
    .from('products')
    .select('stock, unlimited_stock')
    .eq('id', id)
    .single();
  if (fullErr) {
    const { data: legacy } = await supabase
      .from('products')
      .select('stock')
      .eq('id', id)
      .single();
    cur = Number((legacy as { stock?: number } | null)?.stock ?? 0);
  } else {
    unlimited = Boolean((full as { unlimited_stock?: boolean } | null)?.unlimited_stock);
    cur = Number((full as { stock?: number } | null)?.stock ?? 0);
  }
  if (unlimited) return;
  const newStock = Math.max(0, cur - qty);
  await supabase.from('products').update({ stock: newStock }).eq('id', id);
  await applyStockTransition(id, cur, newStock).catch((err) => {
    logger.warn(
      { err, id },
      'applyStockTransition after decrementProductStock failed',
    );
  });
}

// ---------- Per-user price overrides ----------

/**
 * Look up the price override (if any) for a single user × product
 * pair. Returns the override price as a `number`, or `null` when no
 * override is set — callers must fall back to the product's default
 * `products.price`.
 */
export async function getUserProductPrice(
  telegram_id: number,
  product_id: number,
): Promise<number | null> {
  const { data } = await supabase
    .from('user_price_overrides')
    .select('price')
    .eq('telegram_id', telegram_id)
    .eq('product_id', product_id)
    .maybeSingle();
  if (!data) return null;
  return Number((data as { price: number }).price);
}

/**
 * Bulk lookup of overrides for one user across many products.
 * Returns a `Map<product_id, price>` containing only entries that
 * actually have an override — callers iterate the requested product
 * ids and `map.get(id) ?? product.price`.
 *
 * Used by the shop list view so we don't have to issue one query
 * per product on every page render.
 */
export async function getUserProductPriceMap(
  telegram_id: number,
  product_ids: number[],
): Promise<Map<number, number>> {
  if (product_ids.length === 0) return new Map();
  const { data } = await supabase
    .from('user_price_overrides')
    .select('product_id, price')
    .eq('telegram_id', telegram_id)
    .in('product_id', product_ids);
  const map = new Map<number, number>();
  for (const row of (data ?? []) as { product_id: number; price: number }[]) {
    map.set(Number(row.product_id), Number(row.price));
  }
  return map;
}

/**
 * List every override for a single user, joined with the underlying
 * product so the admin UI can show "Product Name — default $X →
 * override $Y" lines.
 */
export async function listUserPriceOverrides(
  telegram_id: number,
): Promise<Array<DBUserPriceOverride & { product_name: string; product_default_price: number }>> {
  const { data } = await supabase
    .from('user_price_overrides')
    .select('*, products(name, price)')
    .eq('telegram_id', telegram_id)
    .order('updated_at', { ascending: false });
  return ((data ?? []) as Array<
    DBUserPriceOverride & { products: { name: string; price: number } | null }
  >).map((row) => ({
    telegram_id: Number(row.telegram_id),
    product_id: Number(row.product_id),
    price: Number(row.price),
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    product_name: row.products?.name ?? `#${row.product_id}`,
    product_default_price: Number(row.products?.price ?? 0),
  }));
}

/**
 * Create or update a price override. Upsert keyed by
 * (telegram_id, product_id) so calling this with the same pair just
 * refreshes the price + bumps `updated_at`.
 */
export async function setUserProductPrice(args: {
  telegram_id: number;
  product_id: number;
  price: number;
  created_by: number | null;
}): Promise<void> {
  const { error } = await supabase
    .from('user_price_overrides')
    .upsert(
      {
        telegram_id: args.telegram_id,
        product_id: args.product_id,
        price: args.price,
        created_by: args.created_by,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'telegram_id,product_id' },
    );
  if (error) {
    logger.error({ err: error, args }, 'setUserProductPrice failed');
    throw error;
  }
}

/** Drop a single override so the user falls back to the default price. */
export async function clearUserProductPrice(
  telegram_id: number,
  product_id: number,
): Promise<void> {
  await supabase
    .from('user_price_overrides')
    .delete()
    .eq('telegram_id', telegram_id)
    .eq('product_id', product_id);
}

/**
 * Admin overview — every override across every user, joined with
 * the user row (for username / first_name) and the product row (for
 * the human-readable name + default price). Sorted by `telegram_id`
 * then `product_id` so callers can group by user with a single
 * pass.
 *
 * `users` is LEFT-joined because overrides can be pre-set for users
 * who haven't `/start`-ed the bot yet — those rows still need to
 * appear in the report, just without a username.
 */
export async function listAllPriceOverrides(): Promise<
  Array<{
    telegram_id: number;
    product_id: number;
    price: number;
    created_at: string;
    updated_at: string;
    created_by: number | null;
    username: string | null;
    first_name: string | null;
    product_name: string;
    product_default_price: number;
  }>
> {
  // Two separate selects — Supabase's PostgREST can't auto-join via
  // a non-FK relation (telegram_id is intentionally NOT a FK), so we
  // hydrate the user row in JS using a Map.
  const { data: rows } = await supabase
    .from('user_price_overrides')
    .select('*, products(name, price)')
    .order('telegram_id', { ascending: true })
    .order('product_id', { ascending: true });
  const overrideRows = ((rows ?? []) as Array<
    DBUserPriceOverride & {
      products: { name: string; price: number } | null;
    }
  >);
  if (overrideRows.length === 0) return [];

  const ids = Array.from(
    new Set(overrideRows.map((r) => Number(r.telegram_id))),
  );
  const { data: users } = await supabase
    .from('users')
    .select('telegram_id, username, first_name')
    .in('telegram_id', ids);
  const userMap = new Map<
    number,
    { username: string | null; first_name: string | null }
  >();
  for (const u of (users ?? []) as Array<{
    telegram_id: number;
    username: string | null;
    first_name: string | null;
  }>) {
    userMap.set(Number(u.telegram_id), {
      username: u.username,
      first_name: u.first_name,
    });
  }

  return overrideRows.map((r) => {
    const u = userMap.get(Number(r.telegram_id));
    return {
      telegram_id: Number(r.telegram_id),
      product_id: Number(r.product_id),
      price: Number(r.price),
      created_at: r.created_at,
      updated_at: r.updated_at,
      created_by: r.created_by,
      username: u?.username ?? null,
      first_name: u?.first_name ?? null,
      product_name: r.products?.name ?? `#${r.product_id}`,
      product_default_price: Number(r.products?.price ?? 0),
    };
  });
}

/** Drop every override for a user (admin convenience). */
export async function clearAllUserPriceOverrides(
  telegram_id: number,
): Promise<number> {
  const { count } = await supabase
    .from('user_price_overrides')
    .delete({ count: 'exact' })
    .eq('telegram_id', telegram_id);
  return count ?? 0;
}

/**
 * Count active overrides on a single product. Used by the product
 * editor to render the "Clear all custom prices" button label and
 * to short-circuit the clear flow when there's nothing to wipe.
 */
export async function countProductPriceOverrides(
  product_id: number,
): Promise<number> {
  const { count } = await supabase
    .from('user_price_overrides')
    .select('product_id', { count: 'exact', head: true })
    .eq('product_id', product_id);
  return count ?? 0;
}

/**
 * Wipe every user's price override for a single product so they all
 * fall back to the product's default price. Returns the row count
 * deleted so the admin toast can confirm how many users were
 * affected.
 */
export async function clearAllProductPriceOverrides(
  product_id: number,
): Promise<number> {
  const { count } = await supabase
    .from('user_price_overrides')
    .delete({ count: 'exact' })
    .eq('product_id', product_id);
  return count ?? 0;
}

// ---------- Promos ----------

/**
 * Fetch every *active* promo whose scope matches the given user +
 * product and whose `min_qty` is satisfied. Scope tier resolution
 * (most-specific wins; ties go to largest discount) lives in
 * `services/promo.ts` so this query stays a dumb filter.
 *
 * The two `or()` calls are AND-combined by Supabase, so the row is
 * kept iff both:
 *   (product_id IS NULL OR product_id = ?)
 *   (telegram_id IS NULL OR telegram_id = ?)
 */
export async function findApplicablePromos(
  telegram_id: number,
  product_id: number,
  qty: number,
): Promise<DBPromo[]> {
  const { data, error } = await supabase
    .from('promos')
    .select('*')
    .eq('active', true)
    .lte('min_qty', qty)
    .or(`product_id.is.null,product_id.eq.${product_id}`)
    .or(`telegram_id.is.null,telegram_id.eq.${telegram_id}`);
  if (error) {
    logger.error({ err: error, telegram_id, product_id, qty }, 'findApplicablePromos failed');
    return [];
  }
  return filterExcluded((data ?? []) as DBPromo[], telegram_id);
}

/**
 * Drop any promo whose `excluded_telegram_ids` contains the given
 * user. Centralised so both the resolve path and the teaser path
 * apply the same opt-out rule.
 */
function filterExcluded(rows: DBPromo[], telegram_id: number): DBPromo[] {
  return rows.filter(
    (p) =>
      !Array.isArray(p.excluded_telegram_ids) ||
      !p.excluded_telegram_ids.map(Number).includes(telegram_id),
  );
}

/**
 * Same scope filter as `findApplicablePromos` but without the
 * qty threshold — used to render the *upcoming* promo teaser on
 * the product page when the buyer hasn't reached `min_qty` yet.
 */
export async function findScopedActivePromos(
  telegram_id: number,
  product_id: number,
): Promise<DBPromo[]> {
  const { data, error } = await supabase
    .from('promos')
    .select('*')
    .eq('active', true)
    .or(`product_id.is.null,product_id.eq.${product_id}`)
    .or(`telegram_id.is.null,telegram_id.eq.${telegram_id}`);
  if (error) {
    logger.error({ err: error, telegram_id, product_id }, 'findScopedActivePromos failed');
    return [];
  }
  return filterExcluded((data ?? []) as DBPromo[], telegram_id);
}

/**
 * Add a telegram_id to a promo's exclusion list. Idempotent — re-
 * adding an already-excluded user is a no-op (Postgres `array_append`
 * would create duplicates, so we use `array(select distinct ...)`
 * via a small JS read-modify-write instead).
 *
 * Returns the resulting exclusion list so the admin UI can show
 * the updated count without an extra fetch.
 */
export async function addPromoExclusion(
  promo_id: number,
  telegram_id: number,
): Promise<number[]> {
  const { data: current, error: readErr } = await supabase
    .from('promos')
    .select('excluded_telegram_ids')
    .eq('id', promo_id)
    .maybeSingle();
  if (readErr) {
    logger.error({ err: readErr, promo_id, telegram_id }, 'addPromoExclusion read failed');
    throw readErr;
  }
  const existing = (current?.excluded_telegram_ids ?? []).map(Number);
  if (existing.includes(telegram_id)) return existing;
  const next = [...existing, telegram_id];
  const { error } = await supabase
    .from('promos')
    .update({ excluded_telegram_ids: next, updated_at: new Date().toISOString() })
    .eq('id', promo_id);
  if (error) {
    logger.error({ err: error, promo_id, telegram_id }, 'addPromoExclusion write failed');
    throw error;
  }
  return next;
}

/**
 * Remove a telegram_id from a promo's exclusion list. Idempotent —
 * removing a user who isn't on the list is a no-op. Returns the
 * resulting exclusion list.
 */
export async function removePromoExclusion(
  promo_id: number,
  telegram_id: number,
): Promise<number[]> {
  const { data: current, error: readErr } = await supabase
    .from('promos')
    .select('excluded_telegram_ids')
    .eq('id', promo_id)
    .maybeSingle();
  if (readErr) {
    logger.error({ err: readErr, promo_id, telegram_id }, 'removePromoExclusion read failed');
    throw readErr;
  }
  const existing = (current?.excluded_telegram_ids ?? []).map(Number);
  if (!existing.includes(telegram_id)) return existing;
  const next = existing.filter((id: number) => id !== telegram_id);
  const { error } = await supabase
    .from('promos')
    .update({ excluded_telegram_ids: next, updated_at: new Date().toISOString() })
    .eq('id', promo_id);
  if (error) {
    logger.error({ err: error, promo_id, telegram_id }, 'removePromoExclusion write failed');
    throw error;
  }
  return next;
}

/** Fetch a single promo by id, for the admin edit/delete screens. */
export async function getPromo(id: number): Promise<DBPromo | null> {
  const { data } = await supabase.from('promos').select('*').eq('id', id).maybeSingle();
  return (data as DBPromo | null) ?? null;
}

/**
 * Paginated promo list for the admin overview. Newest first. Joins
 * the optional product so the admin UI can show the product name
 * inline without a second roundtrip.
 */
/**
 * Flat list of every currently-active promo. Used by the Send Price
 * List CSV builder to surface the cheapest active promo per product
 * inline. Inactive / expired rows are filtered out so the export
 * matches what the buyer would actually see at checkout.
 */
export async function listActivePromos(): Promise<DBPromo[]> {
  const { data, error } = await supabase
    .from('promos')
    .select('*')
    .eq('active', true)
    .order('min_qty', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'listActivePromos failed');
    return [];
  }
  return (data ?? []) as DBPromo[];
}

export async function listPromos(
  page: number,
  pageSize: number,
): Promise<{
  rows: Array<DBPromo & { product_name: string | null }>;
  total: number;
}> {
  const from = page * pageSize;
  const to = from + pageSize - 1;
  const { data, count, error } = await supabase
    .from('promos')
    .select('*, products(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) {
    logger.error({ err: error, page }, 'listPromos failed');
    return { rows: [], total: 0 };
  }
  type RawRow = DBPromo & { products: { name: string } | null };
  const rows = ((data ?? []) as RawRow[]).map(({ products, ...rest }) => ({
    ...rest,
    product_name: products?.name ?? null,
  }));
  return { rows, total: count ?? 0 };
}

export async function addPromo(args: {
  product_id: number | null;
  telegram_id: number | null;
  name: string | null;
  min_qty: number;
  discount_amount: number;
  created_by: number;
}): Promise<DBPromo> {
  const { data, error } = await supabase
    .from('promos')
    .insert({
      product_id: args.product_id,
      telegram_id: args.telegram_id,
      name: args.name,
      min_qty: args.min_qty,
      discount_amount: args.discount_amount,
      created_by: args.created_by,
    })
    .select('*')
    .single();
  if (error || !data) {
    logger.error({ err: error, args }, 'addPromo failed');
    throw error ?? new Error('addPromo failed');
  }
  return data as DBPromo;
}

export async function updatePromo(
  id: number,
  patch: Partial<{
    name: string | null;
    min_qty: number;
    discount_amount: number;
    active: boolean;
  }>,
): Promise<void> {
  const { error } = await supabase
    .from('promos')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    logger.error({ err: error, id, patch }, 'updatePromo failed');
    throw error;
  }
}

export async function deletePromo(id: number): Promise<void> {
  const { error } = await supabase.from('promos').delete().eq('id', id);
  if (error) {
    logger.error({ err: error, id }, 'deletePromo failed');
    throw error;
  }
}

/**
 * Hydrated promo list for the admin "Full overview" + CSV export.
 * Joins product name + default price for product-scoped promos and
 * the user handle for user-scoped promos. `users` is left-joined
 * because user-scoped promos can be pre-set for users who haven't
 * `/start`-ed the bot yet.
 *
 * Sorted by (specificity tier desc, created_at desc) so the most
 * specific rows surface first in the report — same ordering the
 * runtime resolver uses to break ties.
 */
export async function listAllPromos(): Promise<
  Array<
    DBPromo & {
      product_name: string | null;
      product_default_price: number | null;
      product_stock: number | null;
      username: string | null;
      first_name: string | null;
      created_by_username: string | null;
      created_by_first_name: string | null;
    }
  >
> {
  const { data, error } = await supabase
    .from('promos')
    .select('*, products(name, price, stock)')
    .order('created_at', { ascending: false });
  if (error) {
    logger.error({ err: error }, 'listAllPromos failed');
    return [];
  }
  type RawRow = DBPromo & {
    products: { name: string; price: number; stock: number } | null;
  };
  const promoRows = (data ?? []) as RawRow[];
  if (promoRows.length === 0) return [];

  // Resolve user handles for telegram_id columns (target user) AND
  // created_by columns (admin actor) in a single round trip.
  const idSet = new Set<number>();
  for (const p of promoRows) {
    if (p.telegram_id !== null) idSet.add(Number(p.telegram_id));
    if (p.created_by !== null) idSet.add(Number(p.created_by));
  }
  const ids = Array.from(idSet);
  const userMap = new Map<
    number,
    { username: string | null; first_name: string | null }
  >();
  if (ids.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('telegram_id, username, first_name')
      .in('telegram_id', ids);
    for (const u of (users ?? []) as Array<{
      telegram_id: number;
      username: string | null;
      first_name: string | null;
    }>) {
      userMap.set(Number(u.telegram_id), {
        username: u.username,
        first_name: u.first_name,
      });
    }
  }

  return promoRows.map((p) => {
    const target = p.telegram_id !== null ? userMap.get(Number(p.telegram_id)) : null;
    const actor = p.created_by !== null ? userMap.get(Number(p.created_by)) : null;
    return {
      ...p,
      product_name: p.products?.name ?? null,
      product_default_price:
        p.products?.price !== undefined ? Number(p.products.price) : null,
      product_stock:
        p.products?.stock !== undefined ? Number(p.products.stock) : null,
      username: target?.username ?? null,
      first_name: target?.first_name ?? null,
      created_by_username: actor?.username ?? null,
      created_by_first_name: actor?.first_name ?? null,
    };
  });
}

/**
 * Aggregate impact for a single promo: how many paid orders matched
 * it (via `orders.promo_id`) and the total USDT discounted. Only
 * `paid` orders count — refunded/cancelled rows shouldn't inflate
 * the "this promo gave away" headline.
 */
export async function getPromoImpact(promo_id: number): Promise<{
  orders: number;
  total_discount: number;
  last_used: string | null;
}> {
  const { data, error } = await supabase
    .from('orders')
    .select('discount, created_at')
    .eq('promo_id', promo_id)
    .eq('status', 'paid');
  if (error) {
    logger.error({ err: error, promo_id }, 'getPromoImpact failed');
    return { orders: 0, total_discount: 0, last_used: null };
  }
  const rows = (data ?? []) as Array<{ discount: number | string; created_at: string }>;
  let total = 0;
  let last: string | null = null;
  for (const r of rows) {
    total += Number(r.discount);
    if (last === null || r.created_at > last) last = r.created_at;
  }
  return { orders: rows.length, total_discount: total, last_used: last };
}

// ---------- Orders ----------

export async function createOrder(o: {
  user_id: number;
  product_id: number;
  product_name: string;
  qty: number;
  unit_price: number;
  total: number;
  /** Flat USDT discount applied (0 when no promo matched). */
  discount?: number;
  /** ID of the matched promo, when a discount was applied. */
  promo_id?: number | null;
  delivery?: string;
  delivered_items?: string | null;
}): Promise<DBOrder> {
  // Only include `delivered_items` in the insert payload when the
  // caller actually supplied a value. Older deployments may not have
  // applied migration 0015 yet — sending the column to a table that
  // doesn't have it causes Supabase to reject the entire insert,
  // which is what made Wallet Pay hang for the bot owner. Routing
  // delivered_items through `setOrderDeliveredItems` after insert
  // keeps the create path forward-compatible.
  const payload: Record<string, unknown> = {
    user_id: o.user_id,
    product_id: o.product_id,
    product_name: o.product_name,
    qty: o.qty,
    unit_price: o.unit_price,
    total: o.total,
    discount: o.discount ?? 0,
    promo_id: o.promo_id ?? null,
    delivery: o.delivery ?? null,
  };
  if (o.delivered_items !== undefined) {
    payload.delivered_items = o.delivered_items;
  }
  const { data, error } = await supabase
    .from('orders')
    .insert(payload)
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('createOrder failed');
  return data as DBOrder;
}

/**
 * Patch the `delivered_items` payload onto an existing order. Used
 * after `claimProductItems` resolves so the order detail screen can
 * re-show the same payload later without re-consuming the pool.
 */
export async function setOrderDeliveredItems(
  order_id: number,
  delivered_items: string,
): Promise<void> {
  await supabase.from('orders').update({ delivered_items }).eq('id', order_id);
}

export async function listOrders(user_id: number, limit = 10): Promise<DBOrder[]> {
  const { data } = await supabase
    .from('orders')
    .select('*')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as DBOrder[];
}

/**
 * Paginated orders list for the My Orders screen.
 * Returns the slice plus the total count so the UI can render
 * `Page X/Y` without a second round-trip.
 */
export async function listOrdersPaginated(
  user_id: number,
  page: number,
  perPage: number,
): Promise<{ rows: DBOrder[]; total: number }> {
  const from = page * perPage;
  const to = from + perPage - 1;
  const { data, count } = await supabase
    .from('orders')
    .select('*', { count: 'exact' })
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })
    .range(from, to);
  return { rows: (data ?? []) as DBOrder[], total: count ?? 0 };
}

/** Get a single order by numeric primary key. */
export async function getOrder(id: number): Promise<DBOrder | null> {
  const { data } = await supabase
    .from('orders')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return (data ?? null) as DBOrder | null;
}

/**
 * Paginated global orders feed for the admin Orders panel. Returns
 * the slice plus the total count so the UI can render `Page X/Y`
 * without a second round-trip. Newest orders come first.
 */
export async function listAllOrders(
  page: number,
  perPage: number,
): Promise<{ rows: DBOrder[]; total: number }> {
  const from = page * perPage;
  const to = from + perPage - 1;
  const { data, count } = await supabase
    .from('orders')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  return { rows: (data ?? []) as DBOrder[], total: count ?? 0 };
}

/**
 * Paginated orders list scoped to a single product — used by the
 * admin "View Buyers" panel on the product editor so the bot owner
 * can see exactly who bought a given SKU. Newest orders come first.
 */
export async function listOrdersForProduct(
  product_id: number,
  page: number,
  perPage: number,
): Promise<{ rows: DBOrder[]; total: number }> {
  const from = page * perPage;
  const to = from + perPage - 1;
  const { data, count } = await supabase
    .from('orders')
    .select('*', { count: 'exact' })
    .eq('product_id', product_id)
    .order('created_at', { ascending: false })
    .range(from, to);
  return { rows: (data ?? []) as DBOrder[], total: count ?? 0 };
}

// ---------- Deposits ----------

export async function listPaymentMethods(): Promise<DBPaymentMethod[]> {
  const { data } = await supabase
    .from('payment_methods')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  // Backfill the new chrome columns (added in migration 0021) with
  // safe defaults so callers can rely on them existing even on
  // legacy DBs where the migration hasn't been applied yet.
  return ((data ?? []) as Array<Partial<DBPaymentMethod> & { id: number }>).map(
    (row) => ({
      ...(row as DBPaymentMethod),
      color_mode: (row as DBPaymentMethod).color_mode ?? 'none',
      emoji_unicode: (row as DBPaymentMethod).emoji_unicode ?? null,
      emoji_id: (row as DBPaymentMethod).emoji_id ?? null,
    }),
  );
}

export async function addPaymentMethod(p: {
  name: string;
  instructions: string;
  min_amount?: number;
  provider?: PaymentProvider;
  address?: string | null;
  pay_name?: string | null;
}): Promise<DBPaymentMethod> {
  const { data, error } = await supabase
    .from('payment_methods')
    .insert({
      name: p.name,
      instructions: p.instructions,
      min_amount: p.min_amount ?? 0,
      provider: p.provider ?? 'manual',
      address: p.address ?? null,
      pay_name: p.pay_name ?? null,
    })
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('addPaymentMethod failed');
  return data as DBPaymentMethod;
}

/** Update the wallet address on an existing payment method row. */
export async function setPaymentMethodAddress(
  id: number,
  address: string | null,
): Promise<void> {
  await supabase.from('payment_methods').update({ address }).eq('id', id);
}

/**
 * Update the per-method button color mode. Falls back to 'none' on
 * legacy DBs that haven't applied 0021 yet (we swallow the column-
 * does-not-exist error to keep the admin flow non-fatal).
 */
export async function setPaymentMethodColor(
  id: number,
  color_mode: 'none' | 'blue' | 'green' | 'red' | 'yellow',
): Promise<void> {
  const { error } = await supabase
    .from('payment_methods')
    .update({ color_mode })
    .eq('id', id);
  if (error && !/column.+color_mode/i.test(error.message ?? '')) throw error;
}

/**
 * Update the per-method button icon (premium custom_emoji_id +
 * unicode fallback). Pass null/null to reset to the per-provider
 * default.
 *
 * Errors propagate so the caller can surface a clear "apply migration
 * 0021" message to the admin instead of silently no-op'ing on legacy
 * DBs (which used to leave the admin staring at a generic "Couldn't
 * set that as the icon" reply with no idea what was wrong).
 */
export async function setPaymentMethodIcon(
  id: number,
  emoji_unicode: string | null,
  emoji_id: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('payment_methods')
    .update({ emoji_unicode, emoji_id })
    .eq('id', id);
  if (error) throw error;
}

/** Look up a deposit by its `reference` field. */
export async function findDepositByReference(reference: string): Promise<DBDeposit | null> {
  const { data } = await supabase
    .from('deposits')
    .select('*')
    .eq('reference', reference)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as DBDeposit) ?? null;
}

/**
 * Look up a deposit by its on-chain transaction hash. Used to dedupe
 * tx submissions before we credit the wallet again.
 */
export async function findDepositByTxHash(
  tx_hash: string,
): Promise<DBDeposit | null> {
  const { data } = await supabase
    .from('deposits')
    .select('*')
    .eq('tx_hash', tx_hash)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as DBDeposit) ?? null;
}

export async function createDeposit(d: {
  user_id: number;
  method: string;
  amount: number;
  reference?: string;
  note?: string;
  tx_hash?: string;
  /**
   * LTC quote-on-display: amount in LTC the user committed to send.
   * Verifier compares the on-chain output value against this.
   */
  expected_amount?: number;
  /** ISO timestamp when an LTC quote stops being valid. */
  quote_expires_at?: string;
  /**
   * Per-order direct-pay only: locked-in order context the verifier
   * uses to fulfil the order on success. When set, the verifier
   * skips the legacy wallet-credit path entirely.
   */
  order_intent?: OrderIntent;
}): Promise<DBDeposit> {
  const { data, error } = await supabase
    .from('deposits')
    .insert({
      ...d,
      reference: d.reference ?? null,
      note: d.note ?? null,
      tx_hash: d.tx_hash ?? null,
      expected_amount: d.expected_amount ?? null,
      quote_expires_at: d.quote_expires_at ?? null,
      order_intent: d.order_intent ?? null,
    })
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('createDeposit failed');
  return data as DBDeposit;
}

/** Persist the on-chain tx hash on an existing deposit row. */
export async function setDepositTxHash(
  id: number,
  tx_hash: string,
): Promise<void> {
  await supabase.from('deposits').update({ tx_hash }).eq('id', id);
}

export async function listDeposits(user_id: number, limit = 10): Promise<DBDeposit[]> {
  const { data } = await supabase
    .from('deposits')
    .select('*')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as DBDeposit[];
}

// ---------- Settings (admin-editable runtime config) ----------

export async function getAllSettings(): Promise<Map<string, unknown>> {
  const { data } = await supabase.from('settings').select('key,value');
  const map = new Map<string, unknown>();
  for (const row of data ?? []) {
    map.set((row as { key: string }).key, (row as { value: unknown }).value);
  }
  return map;
}

export async function setSetting(
  key: string,
  value: unknown,
  updated_by?: number,
): Promise<void> {
  await supabase.from('settings').upsert({
    key,
    value,
    updated_by: updated_by ?? null,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Read a single setting row directly (bypassing the in-memory cache
 * in `services/settings.ts`). Used for state we need to read fresh
 * from the DB on bot startup, before the cache is populated.
 */
export async function readSetting(key: string): Promise<unknown> {
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  return (data as { value: unknown } | null)?.value ?? null;
}

/** Hard-delete a settings row (for clearing state like Live Support). */
export async function deleteSetting(key: string): Promise<void> {
  await supabase.from('settings').delete().eq('key', key);
}

// ---------- Announcements ----------

export async function listUsersForAnnouncement(): Promise<{ telegram_id: number }[]> {
  const { data } = await supabase
    .from('users')
    .select('telegram_id')
    .eq('announcements', true);
  return (data ?? []) as { telegram_id: number }[];
}

// ---------- Admin: stats / management ----------

export type Stats = {
  users: number;
  orders: number;
  revenue: number;
  pending_deposits: number;
  active_products: number;
  active_categories: number;
};

export async function getStats(): Promise<Stats> {
  const [usersR, ordersR, depR, prodR, catR, totalsR] = await Promise.all([
    supabase.from('users').select('telegram_id', { count: 'exact', head: true }),
    supabase.from('orders').select('id', { count: 'exact', head: true }),
    supabase
      .from('deposits')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('active', true),
    supabase
      .from('categories')
      .select('id', { count: 'exact', head: true })
      .eq('active', true),
    supabase.from('orders').select('total'),
  ]);
  const revenue =
    (totalsR.data as { total: number }[] | null)?.reduce(
      (acc, r) => acc + Number(r.total ?? 0),
      0,
    ) ?? 0;
  return {
    users: usersR.count ?? 0,
    orders: ordersR.count ?? 0,
    revenue: Number(revenue.toFixed(2)),
    pending_deposits: depR.count ?? 0,
    active_products: prodR.count ?? 0,
    active_categories: catR.count ?? 0,
  };
}

/**
 * Per-product sales aggregate, used by `/admin → 📊 Stats` to
 * surface what's actually moving (revenue, units, last sale,
 * remaining stock). Only counts orders in `paid` status — refunded
 * and cancelled rows are excluded so the totals match the wallet
 * ledger.
 *
 * Aggregation key is `product_id` when present, else falls back to
 * `product_name` so historic orders for deleted products still
 * appear in the report. `stock_left` is `null` for deleted
 * products.
 */
export type ProductSalesRow = {
  product_id: number | null;
  product_name: string;
  units_sold: number;
  revenue: number;
  stock_left: number | null;
  last_sold_at: string | null;
};

export async function getProductSales(limit = 50): Promise<ProductSalesRow[]> {
  const { data: orders } = await supabase
    .from('orders')
    .select('product_id, product_name, qty, total, created_at, status')
    .eq('status', 'paid')
    .order('created_at', { ascending: false });
  type OrderRow = Pick<
    DBOrder,
    'product_id' | 'product_name' | 'qty' | 'total' | 'created_at' | 'status'
  >;
  const rows = (orders ?? []) as OrderRow[];
  const byKey = new Map<string, ProductSalesRow>();
  for (const o of rows) {
    const key =
      o.product_id !== null ? `id:${o.product_id}` : `name:${o.product_name}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        product_id: o.product_id,
        product_name: o.product_name,
        units_sold: 0,
        revenue: 0,
        stock_left: null,
        last_sold_at: o.created_at,
      };
      byKey.set(key, row);
    }
    row.units_sold += Number(o.qty);
    row.revenue += Number(o.total);
    if ((row.last_sold_at ?? '') < o.created_at) row.last_sold_at = o.created_at;
  }
  // Single round-trip to fill in current stock for products that
  // still exist. Deleted products keep `stock_left = null`.
  const productIds = Array.from(byKey.values())
    .map((r) => r.product_id)
    .filter((x): x is number => x !== null);
  if (productIds.length > 0) {
    const { data: prods } = await supabase
      .from('products')
      .select('id, stock')
      .in('id', productIds);
    const stockMap = new Map<number, number>();
    for (const p of (prods ?? []) as Array<{ id: number; stock: number }>) {
      stockMap.set(p.id, p.stock);
    }
    for (const row of byKey.values()) {
      if (row.product_id !== null) {
        row.stock_left = stockMap.get(row.product_id) ?? null;
      }
    }
  }
  const list = Array.from(byKey.values()).sort((a, b) => b.revenue - a.revenue);
  // Round revenue to 2dp on the way out so callers don't have to.
  for (const r of list) r.revenue = Number(r.revenue.toFixed(2));
  return list.slice(0, limit);
}

/**
 * Daily revenue trend for the last `days` days (default 7), ordered
 * from oldest → newest. Days with no paid orders are returned with
 * `revenue: 0, orders: 0` so the caller can render a complete row
 * per day without gaps.
 */
export async function getDailyRevenue(
  days = 7,
): Promise<Array<{ date: string; revenue: number; orders: number }>> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await supabase
    .from('orders')
    .select('total, created_at, status')
    .eq('status', 'paid')
    .gte('created_at', since);
  type Row = Pick<DBOrder, 'total' | 'created_at' | 'status'>;
  const rows = (data ?? []) as Row[];
  const byDay = new Map<string, { revenue: number; orders: number }>();
  for (const r of rows) {
    const date = r.created_at.slice(0, 10);
    const cur = byDay.get(date) ?? { revenue: 0, orders: 0 };
    cur.revenue += Number(r.total);
    cur.orders += 1;
    byDay.set(date, cur);
  }
  const result: Array<{ date: string; revenue: number; orders: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const v = byDay.get(d) ?? { revenue: 0, orders: 0 };
    result.push({ date: d, revenue: Number(v.revenue.toFixed(2)), orders: v.orders });
  }
  return result;
}

export async function listAllProducts(
  page: number,
  perPage: number,
): Promise<{ rows: DBProduct[]; total: number }> {
  const from = page * perPage;
  const to = from + perPage - 1;
  const { data, count } = await supabase
    .from('products')
    .select('*', { count: 'exact' })
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to);
  return { rows: (data ?? []) as DBProduct[], total: count ?? 0 };
}

/**
 * Find the row immediately above (`direction='up'`) or below
 * (`direction='down'`) the given product id in the global admin
 * sort order. Returns `null` when the product is already at the
 * boundary (top of page 0 going up, or last row of the last page
 * going down). Used by the admin reorder buttons to figure out
 * which neighbour to swap with — works across page boundaries.
 */
export async function findAdjacentProduct(
  productId: number,
  direction: 'up' | 'down',
): Promise<DBProduct | null> {
  const { data: cur } = await supabase
    .from('products')
    .select('sort_order')
    .eq('id', productId)
    .single();
  if (!cur) return null;
  const sort = Number(cur.sort_order);
  // Find the strict neighbour on the requested side. We compare on
  // the lexicographic (sort_order, id) tuple so ties on sort_order
  // (very common for legacy rows that all default to 0) still
  // produce a deterministic adjacency by id.
  if (direction === 'up') {
    const { data: tied } = await supabase
      .from('products')
      .select('*')
      .eq('sort_order', sort)
      .lt('id', productId)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tied) return tied as DBProduct;
    const { data: above } = await supabase
      .from('products')
      .select('*')
      .lt('sort_order', sort)
      .order('sort_order', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (above as DBProduct | null) ?? null;
  }
  const { data: tied } = await supabase
    .from('products')
    .select('*')
    .eq('sort_order', sort)
    .gt('id', productId)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (tied) return tied as DBProduct;
  const { data: below } = await supabase
    .from('products')
    .select('*')
    .gt('sort_order', sort)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (below as DBProduct | null) ?? null;
}

/**
 * Swap the `sort_order` of two products. When both rows currently
 * share the same sort_order (the common case for legacy rows that
 * default to 0), bumps the lower-id row to `sort_order + 1` so the
 * tuple ordering inverts on the next list render.
 */
export async function swapProductOrder(
  a: { id: number; sort_order: number },
  b: { id: number; sort_order: number },
): Promise<void> {
  if (a.sort_order === b.sort_order) {
    // Tie-break on id — the row with the *lower* id appears first
    // under the (sort_order, id) ordering, so to swap we bump
    // whichever row should now appear later to `sort_order + 1`.
    const earlier = a.id < b.id ? a : b;
    const later = a.id < b.id ? b : a;
    await supabase
      .from('products')
      .update({ sort_order: earlier.sort_order + 1 })
      .eq('id', earlier.id);
    await supabase
      .from('products')
      .update({ sort_order: later.sort_order })
      .eq('id', later.id);
    return;
  }
  await supabase.from('products').update({ sort_order: b.sort_order }).eq('id', a.id);
  await supabase.from('products').update({ sort_order: a.sort_order }).eq('id', b.id);
}

/**
 * Customer-facing all-products list. Filters on `active=true` so
 * the shop shopfront never surfaces hidden / draft products. Order
 * is `(sort_order ASC, id ASC)` so the admin's manual reordering
 * (PR #58) flows through to the customer-facing catalog, with
 * `id ASC` as the deterministic tie-breaker for legacy rows that
 * still share the default sort_order=0.
 */
export async function listActiveProducts(
  page: number,
  perPage: number,
): Promise<{ rows: DBProduct[]; total: number }> {
  const from = page * perPage;
  const to = from + perPage - 1;
  const { data, count } = await supabase
    .from('products')
    .select('*', { count: 'exact' })
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to);
  return { rows: (data ?? []) as DBProduct[], total: count ?? 0 };
}

export async function deleteProduct(id: number): Promise<void> {
  await supabase.from('products').delete().eq('id', id);
}

export async function setProductActive(id: number, active: boolean): Promise<void> {
  await supabase.from('products').update({ active }).eq('id', id);
}

export async function listAllCategories(): Promise<DBCategory[]> {
  const { data } = await supabase
    .from('categories')
    .select('*')
    .order('id', { ascending: true });
  return (data ?? []) as DBCategory[];
}

export async function deleteCategory(id: number): Promise<void> {
  await supabase.from('categories').delete().eq('id', id);
}

export async function deletePaymentMethod(id: number): Promise<void> {
  await supabase.from('payment_methods').delete().eq('id', id);
}

export async function listPendingDeposits(): Promise<DBDeposit[]> {
  const { data } = await supabase
    .from('deposits')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(20);
  return (data ?? []) as DBDeposit[];
}

/**
 * Same as `listPendingDeposits` but without the 20-row cap, used by
 * the admin "🧹 Reject ALL Pending" bulk action so a queue with more
 * pending deposits than the dashboard window can be cleared in one
 * tap. Sorted ascending by id so older / older-test rows are
 * processed first; the bulk handler still iterates row-by-row to
 * DM each user and write per-row admin-log entries.
 */
export async function listAllPendingDeposits(): Promise<DBDeposit[]> {
  const { data } = await supabase
    .from('deposits')
    .select('*')
    .eq('status', 'pending')
    .order('id', { ascending: true });
  return (data ?? []) as DBDeposit[];
}

export async function getDeposit(id: number): Promise<DBDeposit | null> {
  const { data } = await supabase.from('deposits').select('*').eq('id', id).maybeSingle();
  return (data as DBDeposit) ?? null;
}

export async function setDepositStatus(
  id: number,
  status: 'approved' | 'rejected',
): Promise<void> {
  await supabase.from('deposits').update({ status }).eq('id', id);
}

export async function setDepositAmount(id: number, amount: number): Promise<void> {
  await supabase.from('deposits').update({ amount }).eq('id', id);
}

/** Update the free-text `note` column on a deposit row. */
export async function setDepositNote(id: number, note: string | null): Promise<void> {
  await supabase.from('deposits').update({ note }).eq('id', id);
}

// ---------- User management (admin) ----------

/** List most-recently-active users for the admin Users panel. */
export async function listRecentUsers(
  page: number,
  perPage: number,
): Promise<{ rows: DBUser[]; total: number }> {
  const from = page * perPage;
  const to = from + perPage - 1;
  const { data, count } = await supabase
    .from('users')
    .select('*', { count: 'exact' })
    .order('last_seen_at', { ascending: false })
    .range(from, to);
  return { rows: (data ?? []) as DBUser[], total: count ?? 0 };
}

/** Find a user by Telegram numeric id. */
export async function findUserById(telegram_id: number): Promise<DBUser | null> {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegram_id)
    .maybeSingle();
  return (data as DBUser) ?? null;
}

/** Find a user by case-insensitive @username (without the @). */
export async function findUserByUsername(username: string): Promise<DBUser | null> {
  const clean = username.replace(/^@/, '').trim();
  if (clean === '') return null;
  // Escape SQL LIKE wildcards so a literal `_` (e.g. `lais_one`) is
  // matched as itself, not as the single-char wildcard. Without this,
  // an admin lookup for `@lais_one` would match `lais1one`, `laisXone`,
  // etc. and either return the wrong row or — when several rows
  // matched — surface as a thrown PostgREST `maybeSingle` error that
  // the admin saw as the generic "Something went wrong. Cancelled.".
  const escaped = clean.replace(/\\/g, '\\\\').replace(/[_%]/g, '\\$&');
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .ilike('username', escaped)
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.warn({ err: error, username: clean }, 'findUserByUsername failed');
    return null;
  }
  return (data as DBUser) ?? null;
}

/**
 * Ban a user. The next time the bot sees an update from this
 * `telegram_id` it will short-circuit before any handler runs.
 *
 * `reason` is optional and shown only in the admin user card; the
 * banned user themselves never sees it.
 */
export async function banUser(
  telegram_id: number,
  reason: string | null,
): Promise<void> {
  await supabase
    .from('users')
    .update({
      is_banned: true,
      banned_at: new Date().toISOString(),
      banned_reason: reason,
    })
    .eq('telegram_id', telegram_id);
}

/** Lift a previous ban. Leaves `banned_reason` as historical record. */
export async function unbanUser(telegram_id: number): Promise<void> {
  await supabase
    .from('users')
    .update({ is_banned: false, banned_at: null })
    .eq('telegram_id', telegram_id);
}

/**
 * Lightweight ban-check used by the global middleware on every
 * incoming update. Returns true only if a row exists AND its
 * `is_banned` flag is set — banning a Telegram ID that hasn't
 * `/start`-ed the bot yet is intentionally a no-op (their first
 * /start will create the user as unbanned, which the admin can
 * then ban from the user card).
 */
export async function isUserBanned(telegram_id: number): Promise<boolean> {
  const { data } = await supabase
    .from('users')
    .select('is_banned')
    .eq('telegram_id', telegram_id)
    .maybeSingle();
  return Boolean((data as { is_banned?: boolean } | null)?.is_banned);
}

/** Add a Telegram user as bot admin. */
export async function promoteAdmin(telegram_id: number, username?: string | null): Promise<void> {
  await supabase
    .from('admins')
    .upsert({ telegram_id, username: username ?? null }, { onConflict: 'telegram_id' });
}

/** Remove a Telegram user from bot admins. */
export async function demoteAdmin(telegram_id: number): Promise<void> {
  await supabase.from('admins').delete().eq('telegram_id', telegram_id);
}

/**
 * Aggregate stats for one user — used by the Settings → Stats screen.
 * Returns counts/sums across all of their paid orders and approved
 * deposits, plus the timestamp of the most recent order.
 */
export async function getUserStats(telegram_id: number): Promise<{
  orders: number;
  items: number;
  spent: number;
  lastOrderAt: string | null;
  deposits: number;
}> {
  const [{ data: orderRows }, { data: depositRows }] = await Promise.all([
    supabase
      .from('orders')
      .select('qty,total,created_at')
      .eq('user_id', telegram_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('deposits')
      .select('amount,status')
      .eq('user_id', telegram_id)
      .eq('status', 'approved'),
  ]);

  const orders = orderRows ?? [];
  const deposits = depositRows ?? [];

  const totalOrders = orders.length;
  const items = orders.reduce(
    (s, r) => s + Number((r as { qty: number }).qty),
    0,
  );
  const spent = orders.reduce(
    (s, r) => s + Number((r as { total: number }).total),
    0,
  );
  const lastOrderAt =
    orders.length > 0
      ? ((orders[0] as { created_at: string }).created_at ?? null)
      : null;
  const totalDeposits = deposits.reduce(
    (s, r) => s + Number((r as { amount: number }).amount),
    0,
  );

  return {
    orders: totalOrders,
    items,
    spent,
    lastOrderAt,
    deposits: totalDeposits,
  };
}

/** Count orders + total spent by a single user (for the admin user view). */
export async function getUserOrderSummary(
  telegram_id: number,
): Promise<{ orders: number; spent: number }> {
  const { data } = await supabase
    .from('orders')
    .select('total')
    .eq('user_id', telegram_id);
  const orders = (data ?? []).length;
  const spent = (data ?? []).reduce((s, r) => s + Number((r as { total: number }).total), 0);
  return { orders, spent };
}

// ---------- Wallet ledger ----------

/**
 * Append a wallet-balance change to the ledger. `amount` is a signed
 * USDT delta (negative for debits, positive for credits). Failures
 * are logged but never thrown — ledger writes must NEVER block the
 * upstream balance change.
 */
export async function recordLedger(
  user_id: number,
  type: string,
  amount: number,
  reference: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('wallet_ledger')
    .insert({ user_id, type, amount, reference });
  if (error) {
    logger.warn({ err: error, user_id, type }, 'recordLedger failed');
  }
}

export async function listWalletLedger(
  user_id: number,
  limit = 10,
): Promise<DBWalletLedger[]> {
  const { data } = await supabase
    .from('wallet_ledger')
    .select('*')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as DBWalletLedger[];
}

// ---------- Gift codes ----------

export async function getGiftCode(code: string): Promise<DBGiftCode | null> {
  const { data } = await supabase
    .from('gift_codes')
    .select('*')
    .eq('code', code)
    .maybeSingle();
  return (data ?? null) as DBGiftCode | null;
}

export async function listGiftCodes(limit = 50): Promise<DBGiftCode[]> {
  const { data } = await supabase
    .from('gift_codes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as DBGiftCode[];
}

export async function createGiftCode(args: {
  code: string;
  amount: number;
  max_redemptions?: number | null;
  per_user_limit?: number;
  expires_at?: string | null;
  note?: string | null;
  created_by?: number | null;
}): Promise<DBGiftCode> {
  const insert: Record<string, unknown> = {
    code: args.code,
    amount: args.amount,
    max_redemptions: args.max_redemptions ?? null,
    per_user_limit: args.per_user_limit ?? 1,
    expires_at: args.expires_at ?? null,
    note: args.note ?? null,
    created_by: args.created_by ?? null,
  };
  const { data, error } = await supabase
    .from('gift_codes')
    .insert(insert)
    .select('*')
    .single();
  if (error || !data) {
    logger.error({ err: error, code: args.code }, 'createGiftCode failed');
    throw error ?? new Error('Failed to create gift code');
  }
  return data as DBGiftCode;
}

export async function deleteGiftCode(code: string): Promise<void> {
  await supabase.from('gift_codes').delete().eq('code', code);
}

export async function updateGiftCode(
  code: string,
  patch: Partial<Pick<DBGiftCode, 'amount' | 'max_redemptions' | 'per_user_limit' | 'expires_at' | 'note'>>,
): Promise<void> {
  const { error } = await supabase.from('gift_codes').update(patch).eq('code', code);
  if (error) {
    logger.error({ err: error, code }, 'updateGiftCode failed');
    throw error;
  }
}

export async function countGiftCodeRedemptions(code: string): Promise<number> {
  const { count } = await supabase
    .from('gift_code_redemptions')
    .select('id', { count: 'exact', head: true })
    .eq('code', code);
  return count ?? 0;
}

export async function countGiftCodeRedemptionsByUser(
  code: string,
  user_id: number,
): Promise<number> {
  const { count } = await supabase
    .from('gift_code_redemptions')
    .select('id', { count: 'exact', head: true })
    .eq('code', code)
    .eq('user_id', user_id);
  return count ?? 0;
}

export async function listGiftCodeRedemptions(
  code: string,
  limit = 50,
): Promise<DBGiftCodeRedemption[]> {
  const { data } = await supabase
    .from('gift_code_redemptions')
    .select('*')
    .eq('code', code)
    .order('redeemed_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as DBGiftCodeRedemption[];
}

export async function recordGiftCodeRedemption(args: {
  code: string;
  user_id: number;
  amount: number;
}): Promise<DBGiftCodeRedemption> {
  const { data, error } = await supabase
    .from('gift_code_redemptions')
    .insert(args)
    .select('*')
    .single();
  if (error || !data) {
    logger.error({ err: error, ...args }, 'recordGiftCodeRedemption failed');
    throw error ?? new Error('Failed to record gift redemption');
  }
  return data as DBGiftCodeRedemption;
}
