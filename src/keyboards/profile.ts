import { InlineKeyboard } from 'grammy';
import { type Lang } from '../../config/index.js';
import { btn } from './helpers.js';

export function profileKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(btn(lang, 'my_orders'), 'profile:orders')
    .text(btn(lang, 'refer'), 'profile:refer')
    .row()
    .text(btn(lang, 'toggle_stock'), 'profile:toggle_stock')
    .text(btn(lang, 'toggle_announcements'), 'profile:toggle_ann')
    .row()
    .text(btn(lang, 'language'), 'profile:lang')
    .text(btn(lang, 'deposit_history'), 'profile:deposits')
    .row()
    .text(btn(lang, 'clear_cache'), 'profile:clear_cache');
}

export function languageKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🇬🇧 English', 'lang:en')
    .text('🇸🇦 العربية', 'lang:ar')
    .text('🇻🇳 Tiếng Việt', 'lang:vi');
}
