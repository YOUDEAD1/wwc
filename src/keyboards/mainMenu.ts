import { InlineKeyboard } from 'grammy';
import { MAIN_MENU_LAYOUT, BUTTON_KEYS, type Lang } from '../../config/index.js';
import { applyButtonChrome, btn, inlineBtn } from './helpers.js';
import { getChannelUrl } from '../services/settings.js';

/**
 * Map main-menu button keys to their callback data.
 *
 * `Partial` so we don't have to enumerate every BUTTON_KEYS entry —
 * only the ones reachable from MAIN_MENU_LAYOUT actually need a
 * callback here. Unknown keys fall back to a `noop:` callback below.
 */
const CALLBACK: Partial<Record<keyof typeof BUTTON_KEYS, string>> = {
  shop: 'shop:home',
  topup: 'topup:open',
  profile: 'profile:open',
  support: 'support:open',
  ai_support: 'support:ai',
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
  // The bot-wide "How to use this bot" tutorial — historically only
  // surfaced from /profile (callback `profile:tutorial`). Adding the
  // same callback here lets the button live anywhere in the layout
  // (top-row, top-up picker, etc.) without forking a new handler.
  bot_tutorial: 'profile:tutorial',
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
        applyButtonChrome(kb, 'channel');
      } else {
        inlineBtn(kb, lang, k, CALLBACK[k] ?? `noop:${k}`);
      }
    });
    if (i < MAIN_MENU_LAYOUT.length - 1) kb.row();
  });
  return kb;
}

/** "⬅️ Back" button used at the bottom of sub-screens. Returns to main menu. */
export function backToMenuKeyboard(lang: Lang): InlineKeyboard {
  return inlineBtn(new InlineKeyboard(), lang, 'back', 'main:open');
}
