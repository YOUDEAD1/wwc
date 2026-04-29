import { InlineKeyboard, Keyboard } from 'grammy';
import { COLOR_PREFIX, BUTTON_KEYS, type ColorMode } from '../../config/index.js';
import { getButtonColor } from '../services/settings.js';
import type { Lang } from '../../config/index.js';
import { t } from '../i18n/index.js';

/** Decorate a label with the color prefix for the given button key. */
export function colored(
  label: string,
  key: keyof typeof BUTTON_KEYS,
  override?: ColorMode,
): string {
  const mode = override ?? getButtonColor(key);
  const prefix = COLOR_PREFIX[mode];
  return prefix ? `${prefix} ${label}` : label;
}

export function btn(lang: Lang, key: keyof typeof BUTTON_KEYS, override?: ColorMode): string {
  return colored(t(lang, BUTTON_KEYS[key]), key, override);
}

/** Build a reply keyboard from a 2D array of button-keys. */
export function makeReplyKeyboard(
  lang: Lang,
  rows: ReadonlyArray<ReadonlyArray<keyof typeof BUTTON_KEYS>>,
): Keyboard {
  const kb = new Keyboard();
  rows.forEach((row, i) => {
    row.forEach((k) => kb.text(btn(lang, k)));
    if (i < rows.length - 1) kb.row();
  });
  return kb.resized();
}

export { InlineKeyboard };
