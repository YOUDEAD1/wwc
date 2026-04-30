/**
 * Helpers to render text containing premium emojis.
 *
 * Telegram allows bots to send `MessageEntity` with type
 * `custom_emoji` referencing a `custom_emoji_id` from a Telegram
 * premium emoji pack. Telegram premium subscribers see the animated/
 * styled glyph; non-premium users see the unicode fallback.
 *
 * Usage:
 *   const { text, entities } = renderPremium('Hi {fire}!', { fire: 'fire' });
 *   await ctx.reply(text, { entities });
 */
import type { MessageEntity } from 'grammy/types';
import { getEmoji } from './settings.js';

const TOKEN = /\{([\w.]+)\}/g;

export function renderPremium(
  template: string,
  map: Record<string, string> = {},
): { text: string; entities: MessageEntity[] } {
  const entities: MessageEntity[] = [];
  let out = '';
  let lastIndex = 0;

  for (const match of template.matchAll(TOKEN)) {
    const [whole, key] = match;
    const idx = match.index ?? 0;
    out += template.slice(lastIndex, idx);
    lastIndex = idx + whole.length;

    const emojiKey = map[key!] ?? key!;
    const spec = getEmoji(emojiKey);
    if (typeof spec === 'string') {
      out += spec;
    } else {
      // Telegram entity offsets/lengths are counted in UTF-16 code
      // units (matching JavaScript's `String.prototype.length`), NOT
      // Unicode code points. Non-BMP emojis like 📊 occupy 2 code
      // units each, so spreading into an array (which yields code
      // points) under-counts and Telegram rejects or misplaces the
      // custom_emoji entities.
      const offset = out.length;
      const unicode = spec.unicode;
      out += unicode;
      entities.push({
        type: 'custom_emoji',
        offset,
        length: unicode.length,
        custom_emoji_id: spec.custom_emoji_id,
      });
    }
  }
  out += template.slice(lastIndex);
  return { text: out, entities };
}
