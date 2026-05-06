/**
 * Friendly user-facing rendering of verifier deferral reasons.
 *
 * The verifier in `services/depositVerify.ts` returns short,
 * structured English reasons that are good for admin-facing logs
 * and DB notes but read terse when shown to a paying customer
 * ("order receiver doesn't match…"). This module maps the most
 * common reasons to longer, friendlier messages so the user
 * understands what happened and what to do next.
 *
 * Unknown reasons fall through to the raw text so we never hide
 * useful information from the user.
 */

export function friendlyReason(reason: string): string {
  const r = reason.toLowerCase();

  // ----- Binance Pay --------------------------------------------------
  if (r.includes('binance api credentials not set')) {
    return 'Binance Pay auto-verify is temporarily unavailable on the server — your payment will be reviewed by an admin.';
  }
  if (r.includes("returned 451") || r.includes('region-blocked')) {
    return 'Binance Pay is temporarily unreachable from the server — your payment will be reviewed by an admin.';
  }
  if (r.includes('order id not found')) {
    return "We couldn't find that Order ID in our Binance Pay history. Make sure you copied the full ID from the receipt and that the payment completed within the 30-minute window.";
  }
  if (r.includes("doesn't match the merchant pay id") || r.includes('belongs to another account')) {
    return 'This Binance Pay transaction was sent to a different account. Please send to the Pay ID shown on the deposit screen.';
  }
  if (r.includes('only usdt binance pay deposits')) {
    return 'Only USDT Binance Pay payments are auto-verified. Please re-send the payment in USDT.';
  }
  if (r.includes('unsupported binance pay order type')) {
    return 'Binance Pay returned an unsupported order type for this transaction. Send the payment as a regular Binance Pay transfer (C2C) and try again.';
  }
  if (r.includes('paid before this deposit screen was opened')) {
    return 'This Binance Pay order was paid before you opened the deposit screen. Please open a fresh deposit screen and pay again, or wait for admin review.';
  }
  if (r.includes('more than 30 minutes after')) {
    return 'This Binance Pay order was paid more than 30 minutes after you opened the deposit screen. Please open a fresh deposit screen and pay again, or wait for admin review.';
  }
  if (r.includes('binance pay order id required')) {
    return 'Please paste your Binance Pay Order ID below.';
  }
  if (r.includes('merchant pay id not configured')) {
    return 'This Binance Pay method has no Pay ID configured yet. Please contact support.';
  }

  // ----- Direct-pay amount guard -------------------------------------
  if (r.startsWith('paid amount') && r.includes('less than order total')) {
    return reason; // already user-friendly, just capitalise sentence
  }

  // ----- Dedupe -------------------------------------------------------
  if (r.includes('tx already used by deposit')) {
    return 'This transaction has already been used to credit a previous deposit. Each transaction can only be used once.';
  }

  // ----- Chain verifiers ---------------------------------------------
  if (r.includes('wallet address not set')) {
    return 'This payment method has no wallet address configured. Please contact support.';
  }
  if (r.includes('tx hash required')) {
    return 'Please paste the transaction hash below.';
  }

  // Fallback — show the raw reason.
  return reason;
}

/**
 * Classify a deferral reason into one of three buckets so the
 * top-up / direct-pay handlers can show the right UX:
 *
 *   * `'duplicate'` — the user resubmitted a hash / order id that
 *      was already used. We show a hard error popup ("already used")
 *      and DON'T mark the deposit rejected (the original deposit
 *      still owns this tx).
 *   * `'reject'` — the verifier proved the tx is wrong / not a
 *      match for our address / wrong amount / wrong asset / etc.
 *      We auto-disapprove the deposit (status = `rejected`) and
 *      show the reason — no admin review needed.
 *   * `'defer'` — transient error (network blip, region block,
 *      service down) where the user's payment may well be valid;
 *      defer to admin review.
 */
export function classifyReason(reason: string): 'duplicate' | 'reject' | 'defer' {
  const r = reason.toLowerCase();

  // Already-used tx hash / Binance order id.
  if (r.includes('tx already used by deposit')) return 'duplicate';

  // Hard rejections — verifier proved the tx is invalid for us.
  const rejectMatchers = [
    'tx not found',
    'transaction not found',
    'unable to find tx',
    "doesn't match the merchant pay id",
    'belongs to another account',
    'recipient address mismatch',
    'wrong recipient',
    'amount mismatch',
    'on-chain amount',
    'less than minimum',
    'less than order total',
    'paid amount',
    'wrong asset',
    'wrong contract',
    'usdt contract address mismatch',
    'token mismatch',
    'only usdt',
    'unsupported binance pay order type',
    'paid before this deposit',
    'more than 30 minutes after',
    'order id not found',
    'tx not confirmed',
    'failed transaction',
    'reverted',
  ];
  for (const m of rejectMatchers) {
    if (r.includes(m)) return 'reject';
  }

  // Everything else (region block, missing creds, verifier crashed,
  // missing config, network errors, …) — defer to manual review.
  return 'defer';
}

