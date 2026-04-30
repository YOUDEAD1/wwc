import { InlineKeyboard } from 'grammy';
import { type Lang } from '../../config/index.js';
import { btn } from './helpers.js';
import { t } from '../i18n/index.js';
import {
  CLICK_SOUND_BUTTON_KEYS,
  type ClickSoundButtonKey,
} from '../services/clickSound.js';

export function profileKeyboard(lang: Lang): InlineKeyboard {
  // Five core Settings actions on a single row; Sounds + Main Menu
  // underneath. "Refer" remains accessible from the main menu.
  return new InlineKeyboard()
    .text(btn(lang, 'my_orders'), 'profile:orders')
    .text(btn(lang, 'notifications'), 'profile:notifications')
    .text(btn(lang, 'language'), 'profile:lang')
    .text(btn(lang, 'deposit_history'), 'profile:deposits')
    .text(btn(lang, 'clear_cache'), 'profile:clear_cache')
    .row()
    .text(btn(lang, 'click_sounds'), 'profile:click_sound')
    .text(btn(lang, 'main_menu'), 'main:open');
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

/**
 * Maps each muteable button category to the i18n key whose translation
 * appears in the click-sounds settings UI.
 */
const CLICK_SOUND_LABEL_KEY: Record<ClickSoundButtonKey, string> = {
  shop: 'btn.shop',
  topup: 'btn.topup',
  profile: 'btn.profile',
  support: 'btn.support',
  ai_support: 'btn.ai_support',
  refer: 'btn.refer',
  channel: 'btn.channel',
  main_menu: 'btn.main_menu',
  my_orders: 'btn.my_orders',
  notifications: 'btn.notifications',
  language: 'btn.language',
  deposit_history: 'btn.deposit_history',
  clear_cache: 'btn.clear_cache',
  qty: 'click_sounds.cat.qty',
  buy: 'btn.buy_now',
  note: 'btn.view_note',
  other: 'click_sounds.cat.other',
};

export function clickSoundLabel(lang: Lang, key: ClickSoundButtonKey): string {
  return t(lang, CLICK_SOUND_LABEL_KEY[key]);
}

/**
 * Click-sounds submenu. Master toggle on its own row, then each
 * muteable button category two-per-row, then a back-to-settings row.
 */
export function clickSoundsKeyboard(
  lang: Lang,
  state: { master: boolean; off: ReadonlyArray<string> },
): InlineKeyboard {
  const off = new Set(state.off);
  const masterText = state.master
    ? t(lang, 'click_sounds.master.on')
    : t(lang, 'click_sounds.master.off');

  const kb = new InlineKeyboard().text(masterText, 'profile:click_sound:master').row();

  const items = [...CLICK_SOUND_BUTTON_KEYS];
  for (let i = 0; i < items.length; i += 2) {
    const a = items[i] as ClickSoundButtonKey;
    const b = items[i + 1] as ClickSoundButtonKey | undefined;
    const labelA = `${off.has(a) ? '🔇' : '🔊'} ${clickSoundLabel(lang, a)}`;
    kb.text(labelA, `profile:click_sound:btn:${a}`);
    if (b) {
      const labelB = `${off.has(b) ? '🔇' : '🔊'} ${clickSoundLabel(lang, b)}`;
      kb.text(labelB, `profile:click_sound:btn:${b}`);
    }
    kb.row();
  }
  kb.text(btn(lang, 'back_to_settings'), 'profile:open');
  return kb;
}
