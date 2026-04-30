import { InlineKeyboard } from 'grammy';
import { type Lang } from '../../config/index.js';
import { btn } from './helpers.js';
import { t } from '../i18n/index.js';

export function profileKeyboard(lang: Lang): InlineKeyboard {
  // Row 1 — analytics, history, notifications.
  // Row 2 — language + region setter.
  // Row 3 — email setter + deposit history.
  // Row 4 — back to main menu.
  return new InlineKeyboard()
    .text(btn(lang, 'stats'), 'profile:stats')
    .text(btn(lang, 'my_orders'), 'profile:orders')
    .text(btn(lang, 'notifications'), 'profile:notifications')
    .row()
    .text(btn(lang, 'language'), 'profile:lang')
    .text(btn(lang, 'set_region'), 'profile:region')
    .row()
    .text(btn(lang, 'set_email'), 'profile:email')
    .text(btn(lang, 'deposit_history'), 'profile:deposits')
    .row()
    .text(btn(lang, 'back'), 'main:open');
}

/** Stats screen keyboard — Refresh + Back to Settings. */
export function statsKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(btn(lang, 'stats_refresh'), 'profile:stats:refresh')
    .row()
    .text(btn(lang, 'back_to_settings'), 'profile:open');
}

/**
 * Notifications submenu — both toggles on a single row, with a back
 * button to return to Settings.
 */
export function notificationsKeyboard(
  lang: Lang,
  state: { stock_alert: boolean; announcements: boolean },
): InlineKeyboard {
  const stockKey = state.stock_alert ? 'btn.notify.stock.on' : 'btn.notify.stock.off';
  const annKey = state.announcements ? 'btn.notify.ann.on' : 'btn.notify.ann.off';
  return new InlineKeyboard()
    .text(t(lang, stockKey), 'profile:toggle_stock')
    .text(t(lang, annKey), 'profile:toggle_ann')
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
