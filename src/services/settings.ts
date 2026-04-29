/**
 * Runtime settings cache. The bot reads admin-editable values
 * (texts, colors, emojis) from this in-memory cache. Reload after
 * changes by calling `refreshSettings()`.
 */
import { getAllSettings, setSetting } from '../db/queries.js';
import type { ColorMode, EmojiSpec } from '../../config/index.js';
import { COLOR_PREFIX, DEFAULT_BUTTON_COLORS, EMOJI } from '../../config/index.js';

let cache = new Map<string, unknown>();
let loaded = false;

export async function refreshSettings(): Promise<void> {
  cache = await getAllSettings();
  loaded = true;
}

export async function ensureLoaded(): Promise<void> {
  if (!loaded) await refreshSettings();
}

/** Override a text by i18n key — `text.<key>` in settings table. */
export function getTextOverride(key: string): string | undefined {
  const v = cache.get(`text.${key}`);
  return typeof v === 'string' ? v : undefined;
}

/** Get color mode for a button key. Falls back to the default. */
export function getButtonColor(key: keyof typeof DEFAULT_BUTTON_COLORS): ColorMode {
  const v = cache.get(`color.${key}`);
  if (typeof v === 'string' && v in COLOR_PREFIX) return v as ColorMode;
  return DEFAULT_BUTTON_COLORS[key];
}

/** Get color mode for a state-based key like in_stock / out_of_stock. */
export function getStateColor(key: 'in_stock' | 'out_of_stock'): ColorMode {
  const v = cache.get(`color.${key}`);
  if (typeof v === 'string' && v in COLOR_PREFIX) return v as ColorMode;
  return key === 'in_stock' ? 'blue' : 'red';
}

export function getEmoji(key: string): EmojiSpec {
  const v = cache.get(`emoji.${key}`);
  if (
    v &&
    typeof v === 'object' &&
    'unicode' in (v as Record<string, unknown>) &&
    'custom_emoji_id' in (v as Record<string, unknown>)
  ) {
    return v as { unicode: string; custom_emoji_id: string };
  }
  if (typeof v === 'string') return v;
  return EMOJI[key] ?? key;
}

export async function setText(key: string, value: string, updated_by?: number): Promise<void> {
  await setSetting(`text.${key}`, value, updated_by);
  cache.set(`text.${key}`, value);
}

export async function setColor(
  key: string,
  color: ColorMode,
  updated_by?: number,
): Promise<void> {
  await setSetting(`color.${key}`, color, updated_by);
  cache.set(`color.${key}`, color);
}

export async function setEmoji(
  key: string,
  unicode: string,
  custom_emoji_id?: string,
  updated_by?: number,
): Promise<void> {
  const value: EmojiSpec = custom_emoji_id ? { unicode, custom_emoji_id } : unicode;
  await setSetting(`emoji.${key}`, value, updated_by);
  cache.set(`emoji.${key}`, value);
}

export function clearLocalCache(): void {
  cache.clear();
  loaded = false;
}
