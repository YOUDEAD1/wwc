import { InlineKeyboard } from 'grammy';
import { type Lang } from '../../config/index.js';
import { btn } from './helpers.js';
import { t } from '../i18n/index.js';

/**
 * Settings (profile) keyboard.
 *
 * The email row adapts to whether the user has saved an email yet:
 *   - has email: [Change Email] [Why Email?]
 *   - no email:  [Set Email]    [Why Email?]
 *
 * Bug fix: previously this row always showed *Set Email* regardless,
 * which is confusing once the value is saved.
 */
export function profileKeyboard(lang: Lang, hasEmail: boolean): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text(btn(lang, 'stats'), 'profile:stats')
    .text(btn(lang, 'my_orders'), 'profile:orders')
    .text(btn(lang, 'notifications'), 'profile:notifications')
    .row()
    .text(btn(lang, 'language'), 'profile:lang')
    .text(btn(lang, 'set_region'), 'profile:region')
    .row();

  if (hasEmail) {
    kb.text(t(lang, 'btn.email.change'), 'profile:email:change')
      .text(t(lang, 'btn.email.why'), 'profile:email:why');
  } else {
    kb.text(t(lang, 'btn.email.set'), 'profile:email:set')
      .text(t(lang, 'btn.email.why'), 'profile:email:why');
  }
  kb.row()
    .text(btn(lang, 'deposit_history'), 'profile:deposits')
    .row()
    .text(btn(lang, 'back'), 'main:open');
  return kb;
}

/** Email sub-screen footer — Why + Back to Settings. */
export function emailScreenKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, 'btn.email.why'), 'profile:email:why')
    .text(btn(lang, 'back_to_settings'), 'profile:open');
}

/**
 * Why-Email screen — has a "Know More" button that triggers the bot
 * to send the explanation PDF as a chat document.
 */
export function whyEmailKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, 'btn.email.know_more'), 'profile:email:why:more')
    .row()
    .text(btn(lang, 'back_to_settings'), 'profile:open');
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
