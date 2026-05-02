import { InlineKeyboard, Keyboard } from 'grammy';
import {
  BUTTON_ICONS,
  BUTTON_KEYS,
  COLOR_PREFIX,
  colorModeToStyle,
  type ButtonStyle,
  type ColorMode,
  type Lang,
} from '../../config/index.js';
import { getButtonColor, getButtonIcon, getEmoji } from '../services/settings.js';
import { t } from '../i18n/index.js';

/**
 * Decorate a label with the legacy color prefix for the given button key.
 *
 * Bot API 9.4 introduced a real `style` field for buttons (see
 * `colorModeToStyle()` and `applyButtonChrome()` below) — the prefix
 * pathway is now an empty no-op for every mode but is kept so any
 * future custom ColorMode that wants to inject a glyph still has a
 * single chokepoint.
 */
export function colored(
  label: string,
  key: keyof typeof BUTTON_KEYS,
  override?: ColorMode,
): string {
  const mode = override ?? getButtonColor(key);
  const prefix = COLOR_PREFIX[mode];
  return prefix ? `${prefix} ${label}` : label;
}

/**
 * Resolve the button label, optionally stripping the leading unicode
 * emoji + space when an icon is going to be set on the button object
 * itself (avoids "[premium icon] 🛍 Shop" — i.e. two emojis side by
 * side).
 *
 * The strip regex matches a single grapheme that's an emoji-like
 * character (or zero-width-joined sequence) at the start of the
 * label, followed by an optional space.
 */
const LEADING_EMOJI = /^(?:\p{Extended_Pictographic}(?:\u200D\p{Extended_Pictographic})*\uFE0F?)\s?/u;

function stripLeadingEmoji(label: string): string {
  return label.replace(LEADING_EMOJI, '');
}

export function btn(lang: Lang, key: keyof typeof BUTTON_KEYS, override?: ColorMode): string {
  const label = colored(t(lang, BUTTON_KEYS[key]), key, override);
  if (resolveIconId(key) !== undefined) return stripLeadingEmoji(label);
  return label;
}

/**
 * Look up the configured premium-emoji `custom_emoji_id` for a button
 * key.
 *
 * Resolution order:
 *   1. Per-button override stored under the dedicated `btnicon.<key>`
 *      namespace (admin opted-in via the "Set Button Icon" picker).
 *      Stored separately from the shared `emoji.<key>` map so a bad
 *      value can't ripple anywhere else.
 *   2. Compile-time `BUTTON_ICONS` mapping (sensible defaults).
 *
 * Returns `undefined` when neither has a `custom_emoji_id` set
 * (icons in Bot API 9.4 require a real premium emoji id — plain
 * unicode can't be used in the icon slot).
 */
export function resolveIconId(key: keyof typeof BUTTON_KEYS): string | undefined {
  const override = getButtonIcon(key);
  if (override) return override.custom_emoji_id;
  const emojiKey = BUTTON_ICONS[key];
  if (!emojiKey) return undefined;
  const spec = getEmoji(emojiKey);
  return typeof spec === 'object' ? spec.custom_emoji_id : undefined;
}

/**
 * Resolve the Bot API 9.4 `style` for a button key, considering any
 * admin override stored in the `settings` table.
 */
export function resolveStyle(
  key: keyof typeof BUTTON_KEYS,
  override?: ColorMode,
): ButtonStyle | undefined {
  return colorModeToStyle(override ?? getButtonColor(key));
}

/**
 * Apply the configured premium icon (`icon_custom_emoji_id`) and
 * Bot API 9.4 `style` to the LAST added button on the inline
 * keyboard. Use this right after the button is added with
 * `kb.text(...)` / `kb.url(...)` / `kb.copyText(...)`.
 */
export function applyButtonChrome(
  kb: InlineKeyboard,
  key: keyof typeof BUTTON_KEYS,
  override?: ColorMode,
): InlineKeyboard {
  const iconId = resolveIconId(key);
  if (iconId !== undefined) kb.icon(iconId);
  const style = resolveStyle(key, override);
  if (style !== undefined) kb.style(style);
  return kb;
}

/**
 * Add a labelled callback button to an inline keyboard, with the
 * configured premium icon + style applied automatically.
 */
export function inlineBtn(
  kb: InlineKeyboard,
  lang: Lang,
  key: keyof typeof BUTTON_KEYS,
  callbackData: string,
  override?: ColorMode,
): InlineKeyboard {
  kb.text(btn(lang, key, override), callbackData);
  return applyButtonChrome(kb, key, override);
}

/**
 * Add a URL button with the configured premium icon + style.
 */
export function inlineUrl(
  kb: InlineKeyboard,
  lang: Lang,
  key: keyof typeof BUTTON_KEYS,
  url: string,
  override?: ColorMode,
): InlineKeyboard {
  kb.url(btn(lang, key, override), url);
  return applyButtonChrome(kb, key, override);
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
