/**
 * Keyboard for the Redeem Gift Code screen.
 *
 * - Back → Settings
 * - Buy Code → URL button to admin contact (DM via t.me link)
 */
import { InlineKeyboard } from 'grammy';
import { type Lang } from '../../config/index.js';
import { btn } from './helpers.js';
import { t } from '../i18n/index.js';

export function redeemKeyboard(lang: Lang, adminContactUrl: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(btn(lang, 'back_to_settings'), 'profile:open')
    .url(t(lang, 'btn.buy_code'), adminContactUrl);
}
