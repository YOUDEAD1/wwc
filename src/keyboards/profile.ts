import { InlineKeyboard } from 'grammy';
import { type Lang } from '../../config/index.js';
import { btn } from './helpers.js';
import { t } from '../i18n/index.js';

export function profileKeyboard(lang: Lang): InlineKeyboard {
  // Core Settings actions on a single row, with a Back button
  // underneath. "Refer" remains accessible from the main menu.
  return new InlineKeyboard()
    .text(btn(lang, 'my_orders'), 'profile:orders')
    .text(btn(lang, 'notifications'), 'profile:notifications')
    .text(btn(lang, 'language'), 'profile:lang')
    .text(btn(lang, 'deposit_history'), 'profile:deposits')
    .row()
    .text(btn(lang, 'back'), 'main:open');
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
