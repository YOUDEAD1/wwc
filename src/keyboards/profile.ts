import { InlineKeyboard } from 'grammy';
import { type Lang } from '../../config/index.js';
import { inlineBtn } from './helpers.js';
import { t } from '../i18n/index.js';

/**
 * Settings (profile) keyboard — eight buttons in a tidy 2×4 grid:
 *
 *   Stats          | My Orders
 *   Language       | Notifications
 *   Email Settings | My Deposits
 *   Set Region     | Gift Code
 *
 * with a Back row at the bottom. Email Settings is a single button
 * that opens a submenu with Set / Change / Why, so the main grid
 * stays compact regardless of whether an email has been saved.
 */
export function profileKeyboard(lang: Lang): InlineKeyboard {
  const kb = new InlineKeyboard();
  inlineBtn(kb, lang, 'stats', 'profile:stats');
  inlineBtn(kb, lang, 'my_orders', 'profile:orders');
  kb.row();
  inlineBtn(kb, lang, 'language', 'profile:lang');
  inlineBtn(kb, lang, 'notifications', 'profile:notifications');
  kb.row();
  kb.text(t(lang, 'btn.email.settings'), 'profile:email');
  inlineBtn(kb, lang, 'deposit_history', 'profile:deposits');
  kb.row();
  inlineBtn(kb, lang, 'set_region', 'profile:region');
  kb.text(t(lang, 'btn.redeem'), 'profile:redeem');
  kb.row();
  inlineBtn(kb, lang, 'back', 'main:open');
  return kb;
}

/**
 * Email Settings hub — Set / Change / Delete / Why Email each on
 * their own full-width row, mirroring the Top-Up Wallet layout, with
 * a Back row at the bottom.
 */
export function emailHubKeyboard(lang: Lang): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text(t(lang, 'btn.email.set'), 'profile:email:set').success();
  kb.row();
  kb.text(t(lang, 'btn.email.change'), 'profile:email:change').primary();
  kb.row();
  kb.text(t(lang, 'btn.email.delete'), 'profile:email:delete').danger();
  kb.row();
  kb.text(t(lang, 'btn.email.why'), 'profile:email:why');
  kb.row();
  inlineBtn(kb, lang, 'back_to_settings', 'profile:open');
  return kb;
}

/**
 * Delete-Email confirmation keyboard — Confirm Delete (destructive)
 * on top, Cancel below to bounce back to the Email Settings hub.
 */
export function emailDeleteConfirmKeyboard(lang: Lang): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text(t(lang, 'btn.email.delete.confirm'), 'profile:email:delete:confirm').danger();
  kb.row();
  kb.text(t(lang, 'btn.email.delete.cancel'), 'profile:email');
  return kb;
}

/** Email sub-screen footer — Why + Back to Email Settings. */
export function emailScreenKeyboard(lang: Lang): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text(t(lang, 'btn.email.why'), 'profile:email:why');
  inlineBtn(kb, lang, 'back_to_settings', 'profile:email');
  return kb;
}

/**
 * Why-Email screen.
 *
 * `pdfUrl` is read from runtime settings (admin-editable). When set,
 * the "Know More" button is a *URL button* — tapping it opens the
 * PDF directly in Telegram's in-app browser, no extra chat clutter.
 * Otherwise the button is a callback that sends the bundled PDF as
 * a chat document (fallback for deployments that haven't configured
 * the public URL yet).
 */
export function whyEmailKeyboard(lang: Lang, pdfUrl: string | null): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (pdfUrl) {
    kb.url(t(lang, 'btn.email.know_more'), pdfUrl).primary();
  } else {
    kb.text(t(lang, 'btn.email.know_more'), 'profile:email:why:more').primary();
  }
  kb.row();
  inlineBtn(kb, lang, 'back_to_settings', 'profile:email');
  return kb;
}

/** Stats screen keyboard — Refresh + Send PDF + Back to Settings. */
export function statsKeyboard(lang: Lang): InlineKeyboard {
  const kb = new InlineKeyboard();
  inlineBtn(kb, lang, 'stats_refresh', 'profile:stats:refresh');
  kb.row();
  kb.text(t(lang, 'btn.send_pdf.stats'), 'profile:stats:pdf').primary();
  kb.row();
  inlineBtn(kb, lang, 'back_to_settings', 'profile:open');
  return kb;
}

/** Stand-alone Send-PDF row used at the bottom of My Deposits. */
export function depositsActionsKeyboard(lang: Lang): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text(t(lang, 'btn.send_pdf.deposits'), 'profile:deposits:pdf').primary();
  kb.row();
  inlineBtn(kb, lang, 'back_to_settings', 'profile:open');
  return kb;
}

/**
 * Notifications submenu — three independent toggles (Stock / Info /
 * Wallet) each on their own full-width row (like the Top-Up Wallet
 * layout) so the long ON/OFF labels fit, with a Back row below.
 */
export function notificationsKeyboard(
  lang: Lang,
  state: {
    stock_alert: boolean;
    announcements: boolean;
    wallet_alert: boolean;
  },
): InlineKeyboard {
  const stockKey = state.stock_alert ? 'btn.notify.stock.on' : 'btn.notify.stock.off';
  const annKey = state.announcements ? 'btn.notify.ann.on' : 'btn.notify.ann.off';
  const walletKey = state.wallet_alert ? 'btn.notify.wallet.on' : 'btn.notify.wallet.off';
  const kb = new InlineKeyboard();
  kb.text(t(lang, stockKey), 'profile:toggle_stock');
  if (state.stock_alert) kb.success();
  kb.row();
  kb.text(t(lang, annKey), 'profile:toggle_ann');
  if (state.announcements) kb.success();
  kb.row();
  kb.text(t(lang, walletKey), 'profile:toggle_wallet');
  if (state.wallet_alert) kb.success();
  kb.row();
  inlineBtn(kb, lang, 'back_to_settings', 'profile:open');
  return kb;
}

/**
 * Language picker — each language on its own full-width row (mirrors
 * Top-Up Wallet layout), with a Back to Settings row at the bottom.
 */
export function languageKeyboard(lang: Lang): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text('🇬🇧 English', 'lang:en');
  kb.row();
  kb.text('🇸🇦 العربية', 'lang:ar');
  kb.row();
  kb.text('🇻🇳 Tiếng Việt', 'lang:vi');
  kb.row();
  inlineBtn(kb, lang, 'back_to_settings', 'profile:open');
  return kb;
}

/** Plain "Back to Settings" only — used for refer / sub-screens. */
export function backToSettingsKeyboard(lang: Lang): InlineKeyboard {
  return inlineBtn(new InlineKeyboard(), lang, 'back_to_settings', 'profile:open');
}

/** "Back to Main Menu" only — used for the Refer screen. */
export function backToMainKeyboard(lang: Lang): InlineKeyboard {
  return inlineBtn(new InlineKeyboard(), lang, 'back', 'main:open');
}

/**
 * Refer & Earn screen keyboard — Copy Link button (using Telegram's
 * `copy_text` button so tapping it copies the referral link to the
 * user's clipboard) followed by a Back row.
 */
export function referKeyboard(lang: Lang, link: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.copyText(t(lang, 'btn.copy_link'), link).success();
  kb.row();
  inlineBtn(kb, lang, 'back', 'main:open');
  return kb;
}
