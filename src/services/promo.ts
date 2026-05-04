/**
 * Quantity-threshold flat-USDT promo resolution.
 *
 * Each promo row defines (optionally per-product, optionally per-user)
 * a `min_qty` and a flat `discount_amount` taken off the line total.
 * At order time we want exactly *one* promo applied:
 *
 *   - The most specific scope tier that matches the (user, product)
 *     pair: per-user-per-product → per-user → per-product → default.
 *   - Within a tier, the largest discount wins (best for the buyer).
 *
 * The applied discount is always clamped to `unit_price * qty` so the
 * line total can never go below zero.
 */
import { findApplicablePromos } from '../db/queries.js';
import type { DBPromo } from '../types.js';

export type PromoMatch = {
  promo: DBPromo;
  /**
   * Scope tier — higher is more specific.
   *   3 = per-user + per-product
   *   2 = per-user (any product)
   *   1 = per-product (any user)
   *   0 = default (any user, any product)
   */
  specificity: 0 | 1 | 2 | 3;
  /** Effective USDT discount, clamped to the line total. */
  discount: number;
};

function tier(p: DBPromo): 0 | 1 | 2 | 3 {
  if (p.telegram_id !== null && p.product_id !== null) return 3;
  if (p.telegram_id !== null) return 2;
  if (p.product_id !== null) return 1;
  return 0;
}

/**
 * Pick the single best promo (if any) for the given line. Returns
 * `null` when no active promo matches, or when the line qty / total
 * is too small to apply any candidate.
 */
export async function resolvePromo(
  telegram_id: number,
  product_id: number,
  qty: number,
  unit_price: number,
): Promise<PromoMatch | null> {
  if (qty <= 0 || unit_price < 0) return null;
  const lineTotal = +(unit_price * qty).toFixed(2);
  if (lineTotal <= 0) return null;
  const promos = await findApplicablePromos(telegram_id, product_id, qty);
  if (promos.length === 0) return null;
  const candidates: PromoMatch[] = promos.map((p) => ({
    promo: p,
    specificity: tier(p),
    discount: Math.min(Number(p.discount_amount), lineTotal),
  }));
  // Highest specificity tier; within tier, largest effective discount.
  candidates.sort(
    (a, b) =>
      b.specificity - a.specificity ||
      b.discount - a.discount ||
      // Stable-ish tiebreaker: newer promo wins when discount + tier
      // are identical so the most recently added promo takes effect.
      Number(b.promo.created_at >= a.promo.created_at ? 1 : -1),
  );
  const best = candidates[0];
  if (!best || best.discount <= 0) return null;
  return best;
}

/**
 * Compute a price preview for the product page / payment screen.
 * `gross` is `unit_price * qty` (raw); `discount` is the applied
 * promo discount (0 when none); `total` is what the user is actually
 * charged. Always returns valid finite numbers.
 */
export function priceBreakdown(
  unit_price: number,
  qty: number,
  match: PromoMatch | null,
): { gross: number; discount: number; total: number } {
  const gross = +(unit_price * qty).toFixed(2);
  const discount = match ? Math.min(match.discount, gross) : 0;
  const total = +(gross - discount).toFixed(2);
  return { gross, discount, total };
}
