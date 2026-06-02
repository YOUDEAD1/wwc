import { InlineKeyboard } from 'grammy';
import { MAIN_MENU_LAYOUT, BUTTON_KEYS, type Lang } from '../../config/index.js';
import { applyButtonChrome, btn, inlineBtn } from './helpers.js';
import { getChannelUrl } from '../services/settings.js';

const CALLBACK: Partial<Record<keyof typeof BUTTON_KEYS, string>> = {
  shop: 'shop:home',
  topup: 'topup:open',
  profile: 'profile:open',
  support: 'support:open',

  main_menu: 'main:open',
  back: 'main:open',
  buy_now: 'noop:buy',
  topup_wallet: 'topup:open',
  my_orders: 'profile:orders',
  refer: 'profile:refer',
  notifications: 'profile:notifications',
  language: 'profile:lang',
  deposit_history: 'profile:deposits',
  channel: 'channel:open',
  back_to_settings: 'profile:open',
  stats: 'profile:stats',
  stats_refresh: 'profile:stats:refresh',
  set_region: 'profile:region',
  set_email: 'profile:email:set',
};

/** Inline keyboard rendered under the welcome message. */
export async function mainMenuKeyboard(lang: Lang): Promise<InlineKeyboard> {
  const kb = new InlineKeyboard();
  const channelUrl = getChannelUrl();

  const rows = [...MAIN_MENU_LAYOUT];

  rows.forEach((row, i) => {
    row.forEach((k) => {
      if (k === 'channel' && channelUrl) {
        kb.url(btn(lang, 'channel'), channelUrl);
        applyButtonChrome(kb, 'channel');
      } else {
        inlineBtn(kb, lang, k, CALLBACK[k] ?? `noop:${k}`);
      }
    });
    if (i < rows.length - 1) kb.row();
  });

  return kb;
}

/** "⬅️ Back" button used at the bottom of sub-screens. Returns to main menu. */
export function backToMenuKeyboard(lang: Lang): InlineKeyboard {
  return inlineBtn(new InlineKeyboard(), lang, 'back', 'main:open');
}
