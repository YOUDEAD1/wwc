import { InlineKeyboard } from 'grammy';
import { type Lang } from '../../config/index.js';
import { btn } from './helpers.js';
import { t } from '../i18n/index.js';

/**
 * Settings (profile) keyboard.
 *
 * The email row is a single "Email Settings" button — it opens a
 * submenu with Set / Change / Why so the main Settings card stays
 * compact regardless of whether an email has been saved yet.
 */
export function profileKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(btn(lang, 'stats'), 'profile:stats')
    .text(btn(lang, 'my_orders'), 'profile:orders')
    .text(btn(lang, 'notifications'), 'profile:notifications')
    .row()
    .text(btn(lang, 'language'), 'profile:lang')
    .text(btn(lang, 'set_region'), 'profile:region')
    .row()
    .text(t(lang, 'btn.email.settings'), 'profile:email')
    .text(btn(lang, 'deposit_history'), 'profile:deposits')
    .row()
    .text(t(lang, 'btn.redeem'), 'profile:redeem')
    .row()
    .text(btn(lang, 'back'), 'main:open');
}

/**
 * Email Settings hub — rendered when the user taps "Email Settings"
 * on the main Settings screen. Three short buttons in a single row:
 *   Set | Change | Why Email
 * with a Back row below.
 */
export function emailHubKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, 'btn.email.set'), 'profile:email:set')
    .text(t(lang, 'btn.email.change'), 'profile:email:change')
    .text(t(lang, 'btn.email.why'), 'profile:email:why')
    .row()
    .text(btn(lang, 'back_to_settings'), 'profile:open');
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

/** Stats screen keyboard — Refresh + Back to Settings. */
export function statsKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(btn(lang, 'stats_refresh'), 'profile:stats:refresh')
    .row()
    .text(btn(lang, 'back_to_settings'), 'profile:open');
}

/**
 * Notifications submenu — three independent toggles (Stock / Info /
 * Wallet) on a single row, just like the Email Settings hub. Back
 * button below.
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
    .text(t(lang, annKey), 'profile:toggle_ann')
    .text(t(lang, walletKey), 'profile:toggle_wallet')
    .row()
    .text(btn(lang, 'back_to_settings'), 'profile:open');
}

export function languageKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🇬🇧 English', 'lang:en')
    .text('🇸🇦 العربية', 'lang:ar')
    .text('🇻🇳 Tiếng Việt', 'lang:vi');
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
