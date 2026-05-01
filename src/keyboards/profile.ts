import { InlineKeyboard } from 'grammy';
import { type Lang } from '../../config/index.js';
import { btn } from './helpers.js';
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
  return new InlineKeyboard()
    .text(btn(lang, 'stats'), 'profile:stats')
    .text(btn(lang, 'my_orders'), 'profile:orders')
    .row()
    .text(btn(lang, 'language'), 'profile:lang')
    .text(btn(lang, 'notifications'), 'profile:notifications')
    .row()
    .text(t(lang, 'btn.email.settings'), 'profile:email')
    .text(btn(lang, 'deposit_history'), 'profile:deposits')
    .row()
    .text(btn(lang, 'set_region'), 'profile:region')
    .text(t(lang, 'btn.redeem'), 'profile:redeem')
    .row()
    .text(btn(lang, 'back'), 'main:open');
}

/**
 * Email Settings hub — Set / Change / Delete / Why Email each on
 * their own full-width row, mirroring the Top-Up Wallet layout, with
 * a Back row at the bottom.
 */
export function emailHubKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, 'btn.email.set'), 'profile:email:set')
    .row()
    .text(t(lang, 'btn.email.change'), 'profile:email:change')
    .row()
    .text(t(lang, 'btn.email.delete'), 'profile:email:delete')
    .row()
    .text(t(lang, 'btn.email.why'), 'profile:email:why')
    .row()
    .text(btn(lang, 'back_to_settings'), 'profile:open');
}

/**
 * Delete-Email confirmation keyboard — Confirm Delete (destructive)
 * on top, Cancel below to bounce back to the Email Settings hub.
 */
export function emailDeleteConfirmKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, 'btn.email.delete.confirm'), 'profile:email:delete:confirm')
    .row()
    .text(t(lang, 'btn.email.delete.cancel'), 'profile:email');
}

/** Email sub-screen footer — Why + Back to Email Settings. */
export function emailScreenKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, 'btn.email.why'), 'profile:email:why')
    .text(btn(lang, 'back_to_settings'), 'profile:email');
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
    kb.url(t(lang, 'btn.email.know_more'), pdfUrl);
  } else {
    kb.text(t(lang, 'btn.email.know_more'), 'profile:email:why:more');
  }
  kb.row().text(btn(lang, 'back_to_settings'), 'profile:email');
  return kb;
}

/** Stats screen keyboard — Refresh + Send PDF + Back to Settings. */
export function statsKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(btn(lang, 'stats_refresh'), 'profile:stats:refresh')
    .row()
    .text(t(lang, 'btn.send_pdf.stats'), 'profile:stats:pdf')
    .row()
    .text(btn(lang, 'back_to_settings'), 'profile:open');
}

/** Stand-alone Send-PDF row used at the bottom of My Deposits. */
export function depositsActionsKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, 'btn.send_pdf.deposits'), 'profile:deposits:pdf')
    .row()
    .text(btn(lang, 'back_to_settings'), 'profile:open');
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
  return new InlineKeyboard()
    .text(t(lang, stockKey), 'profile:toggle_stock')
    .row()
    .text(t(lang, annKey), 'profile:toggle_ann')
    .row()
    .text(t(lang, walletKey), 'profile:toggle_wallet')
    .row()
    .text(btn(lang, 'back_to_settings'), 'profile:open');
}

/**
 * Language picker — each language on its own full-width row (mirrors
 * Top-Up Wallet layout), with a Back to Settings row at the bottom.
 */
export function languageKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text('🇬🇧 English', 'lang:en')
    .row()
    .text('🇸🇦 العربية', 'lang:ar')
    .row()
    .text('🇻🇳 Tiếng Việt', 'lang:vi')
    .row()
    .text(btn(lang, 'back_to_settings'), 'profile:open');
}

/** Plain "Back to Settings" only — used for refer / sub-screens. */
export function backToSettingsKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard().text(btn(lang, 'back_to_settings'), 'profile:open');
}

/** "Back to Main Menu" only — used for the Refer screen. */
export function backToMainKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard().text(btn(lang, 'back'), 'main:open');
}

/**
 * Refer & Earn screen keyboard — Copy Link button (using Telegram's
 * `copy_text` button so tapping it copies the referral link to the
 * user's clipboard) followed by a Back row.
 */
export function referKeyboard(lang: Lang, link: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.copyText(t(lang, 'btn.copy_link'), link);
  kb.row().text(btn(lang, 'back'), 'main:open');
  return kb;
}
