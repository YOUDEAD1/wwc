import { InlineKeyboard } from 'grammy';
import { MAIN_MENU_LAYOUT, BUTTON_KEYS, type Lang } from '../../config/index.js';
import { btn } from './helpers.js';
import { getChannelUrl } from '../services/settings.js';

/** Map main-menu button keys to their callback data. */
const CALLBACK: Record<keyof typeof BUTTON_KEYS, string> = {
  shop: 'shop:home',
  topup: 'topup:open',
  profile: 'profile:open',
  support: 'support:open',
  ai_support: 'support:ai',
  main_menu: 'main:open',
  back: 'main:open',
  next: 'noop:next',
  prev: 'noop:prev',
  refresh: 'noop:refresh',
  buy_now: 'noop:buy',
  topup_wallet: 'topup:open',
  view_note: 'noop:note',
  qty_plus: 'noop:qty+',
  qty_minus: 'noop:qty-',
  out_of_stock: 'noop:oos',
  my_orders: 'profile:orders',
  refer: 'profile:refer',
  notifications: 'profile:notifications',
  toggle_stock: 'profile:toggle_stock',
  toggle_announcements: 'profile:toggle_ann',
  language: 'profile:lang',
  deposit_history: 'profile:deposits',
  clear_cache: 'profile:clear_cache',
  channel: 'channel:open',
  back_to_settings: 'profile:open',
};

/** Inline keyboard rendered under the welcome message. */
export function mainMenuKeyboard(lang: Lang): InlineKeyboard {
  const kb = new InlineKeyboard();
  const channelUrl = getChannelUrl();
  MAIN_MENU_LAYOUT.forEach((row, i) => {
    row.forEach((k) => {
      // Render the channel button as a direct URL when configured so
      // the user is sent straight to Telegram's join screen.
      if (k === 'channel' && channelUrl) {
        kb.url(btn(lang, 'channel'), channelUrl);
      } else {
        kb.text(btn(lang, k), CALLBACK[k]);
      }
    });
    if (i < MAIN_MENU_LAYOUT.length - 1) kb.row();
  });
  return kb;
}

/** "⬅️ Back" button used at the bottom of sub-screens. Returns to main menu. */
export function backToMenuKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard().text(btn(lang, 'back'), 'main:open');
}
