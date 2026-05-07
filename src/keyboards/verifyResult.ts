/**
 * Inline keyboards rendered under the final "verification done /
 * declined" status messages produced by `services/verifyingMsg.ts`.
 *
 * The keyboard always carries the standard "Back" button. On manual
 * (defer) outcomes we additionally show a premium-emoji "Admin Help"
 * button that deep-links to the bot owner's DM with a prefilled
 * message — letting the user one-tap escalate without copy-pasting
 * the deposit id by hand.
 */

import { InlineKeyboard } from 'grammy';
import type { Lang } from '../../config/index.js';
import { btn } from './helpers.js';
import { getAdminContactUrlWithPrefill } from '../services/settings.js';

/**
 * Default Admin Help label rendered next to a 🆘 fallback. The
 * actual button uses a premium custom_emoji_id when one has been
 * configured under `btnicon.admin_help` (see `helpers.ts → applyIcon`).
 */
const ADMIN_HELP_LABEL = '🆘 Admin Help';

/** Build the Admin Help URL for a deposit awaiting manual review. */
export function buildAdminHelpUrl(depositId: number, txOrOrderId: string): string {
  const text =
    `Hi Admin, I need help with my deposit #${depositId}.\n\n` +
    `Tx / Order ID: ${txOrOrderId}\n\n` +
    `My payment was sent but auto-verification didn't pass — please check it manually.`;
  return getAdminContactUrlWithPrefill(text);
}

/**
 * Build the Admin Help URL for a hard-rejected deposit. The user
 * still gets a one-tap escalation in case the rejection was wrong
 * (e.g. their wallet does report the right tx but our verifier
 * didn't find it because of a CDN cache hit).
 */
export function buildAdminHelpUrlForRejection(
  depositId: number,
  txOrOrderId: string,
  reason: string,
): string {
  const text =
    `Hi Admin, my deposit #${depositId} was auto-rejected — please double-check.\n\n` +
    `Tx / Order ID: ${txOrOrderId}\n` +
    `Auto-rejection reason: ${reason}`;
  return getAdminContactUrlWithPrefill(text);
}

export function manualReviewKeyboard(
  lang: Lang,
  depositId: number,
  txOrOrderId: string,
  backCallback: string = 'main:open',
): InlineKeyboard {
  return new InlineKeyboard()
    .url(ADMIN_HELP_LABEL, buildAdminHelpUrl(depositId, txOrOrderId))
    .row()
    .text(btn(lang, 'back'), backCallback);
}

export function rejectionKeyboard(
  lang: Lang,
  depositId: number,
  txOrOrderId: string,
  reason: string,
  backCallback: string = 'main:open',
): InlineKeyboard {
  return new InlineKeyboard()
    .url(ADMIN_HELP_LABEL, buildAdminHelpUrlForRejection(depositId, txOrOrderId, reason))
    .row()
    .text(btn(lang, 'back'), backCallback);
}

export function successKeyboard(
  lang: Lang,
  backCallback: string = 'main:open',
): InlineKeyboard {
  return new InlineKeyboard().text(btn(lang, 'back'), backCallback);
}
