/**
 * Runtime settings cache. The bot reads admin-editable values
 * (texts, colors, emojis) from this in-memory cache. Reload after
 * changes by calling `refreshSettings()`.
 */
import { deleteSetting, getAllSettings, setSetting } from '../db/queries.js';
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

/** Drop an emoji override so the key falls back to its default. */
export async function clearEmoji(key: string): Promise<void> {
  await deleteSetting(`emoji.${key}`);
  cache.delete(`emoji.${key}`);
}

export function clearLocalCache(): void {
  cache.clear();
  loaded = false;
}

/** Channel URL shown as a direct-join button in the main menu. */
export function getChannelUrl(): string | undefined {
  const v = cache.get('channel.url');
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export async function setChannelUrl(url: string, updated_by?: number): Promise<void> {
  await setSetting('channel.url', url, updated_by);
  cache.set('channel.url', url);
}

export async function clearChannelUrl(updated_by?: number): Promise<void> {
  await setSetting('channel.url', '', updated_by);
  cache.set('channel.url', '');
}

/**
 * Public URL of the email-explanation PDF. When set, the Why Email
 * "Know More" button becomes a URL button that opens the PDF in
 * Telegram's in-app browser. Falls back to env var `EMAIL_PDF_URL`
 * so a sane default can be baked in at deploy time.
 *
 * Admins can set this at runtime via /settext key=`email.pdf_url`.
 */
export function getEmailPdfUrl(): string | null {
  const v = cache.get('email.pdf_url');
  if (typeof v === 'string' && v.length > 0) return v;
  const env = process.env.EMAIL_PDF_URL;
  return env && env.length > 0 ? env : null;
}

/**
 * Direct-message URL for the admin / shop owner. Used by:
 *   - Settings → Redeem Gift Code → "Buy Code" button
 *   - any other screen that wants a 1-tap "contact admin" hop.
 *
 * Resolution order:
 *   1. settings.admin.contact_url (admin-editable via /settext)
 *   2. env ADMIN_CONTACT_URL
 *   3. https://t.me/safwantiger as the documented default.
 */
export function getAdminContactUrl(): string {
  const v = cache.get('admin.contact_url');
  if (typeof v === 'string' && v.length > 0) return v;
  const env = process.env.ADMIN_CONTACT_URL;
  if (env && env.length > 0) return env;
  return 'https://t.me/safwantiger';
}

/**
 * Same as `getAdminContactUrl` but with a `?text=...` param appended
 * so Telegram pre-fills the admin DM's input bar with the given text
 * the moment the user lands in the chat.
 */
export function getAdminContactUrlWithPrefill(text: string): string {
  const base = getAdminContactUrl();
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}text=${encodeURIComponent(text)}`;
}
