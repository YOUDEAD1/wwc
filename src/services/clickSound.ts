/**
 * Click-sound service.
 *
 * On every inline-button tap (callback query), if the user has the
 * master `click_sound` flag enabled AND the resolved "button key" is
 * NOT in their `click_sound_off` mute list, the bot sends the click
 * sound as a Telegram voice message and auto-deletes it a few seconds
 * later so it doesn't pile up in the chat.
 *
 * Telegram does NOT auto-play voice messages from bots. The user still
 * has to tap the bubble to hear it. This is a Telegram platform limit
 * we cannot work around — this service just makes the sound *available*
 * on every tap, with per-button user opt-out.
 */
import path from 'node:path';
import { InputFile, type Api } from 'grammy';
import { logger } from '../logger.js';

// Resolved against `process.cwd()` rather than `__dirname` so the same
// path works in both source mode (`tsx watch src/index.ts`) and the
// compiled mode (`node dist/src/index.js`) — the bot is always started
// from the repo root.
const SOUND_PATH = path.resolve(process.cwd(), 'assets/click.ogg');

/** How long a click-sound bubble stays in the chat before we delete it. */
const AUTO_DELETE_MS = 4000;

/**
 * Maps callback-query data prefixes to a "button key" that the user
 * can mute individually. Anything not matched falls into the catch-all
 * `'other'` bucket.
 *
 * Order matters — first match wins.
 */
const PREFIX_TO_KEY: ReadonlyArray<readonly [RegExp, string]> = [
  [/^shop:/, 'shop'],
  [/^cat:/, 'shop'],
  [/^prod:/, 'shop'],
  [/^qty:/, 'qty'],
  [/^buy:/, 'buy'],
  [/^note:/, 'note'],
  [/^topup:/, 'topup'],
  [/^binance:/, 'topup'],
  [/^profile:open$/, 'profile'],
  [/^profile:orders$/, 'my_orders'],
  [/^profile:refer$/, 'refer'],
  [/^profile:notifications$/, 'notifications'],
  [/^profile:toggle_/, 'notifications'],
  [/^profile:lang$/, 'language'],
  [/^lang:/, 'language'],
  [/^profile:deposits$/, 'deposit_history'],
  [/^profile:clear_cache$/, 'clear_cache'],
  [/^profile:click_sound/, 'click_sound'],
  [/^support:open$/, 'support'],
  [/^support:ai$/, 'ai_support'],
  [/^channel:/, 'channel'],
  [/^main:/, 'main_menu'],
];

export function callbackToButtonKey(data: string | undefined): string {
  if (!data) return 'other';
  for (const [re, key] of PREFIX_TO_KEY) {
    if (re.test(data)) return key;
  }
  return 'other';
}

/** Button keys the user can individually mute, in display order. */
export const CLICK_SOUND_BUTTON_KEYS = [
  'shop',
  'topup',
  'profile',
  'support',
  'ai_support',
  'refer',
  'channel',
  'main_menu',
  'my_orders',
  'notifications',
  'language',
  'deposit_history',
  'clear_cache',
  'qty',
  'buy',
  'note',
  'other',
] as const;
export type ClickSoundButtonKey = (typeof CLICK_SOUND_BUTTON_KEYS)[number];

/** Cached Telegram file_id for the sound, populated after the first send. */
let cachedFileId: string | null = null;

/**
 * Send the click sound into a chat (fire-and-forget). Errors are
 * swallowed — a failed click sound must never break the actual button
 * action.
 */
export function playClick(api: Api, chatId: number): void {
  void (async () => {
    try {
      const input = cachedFileId ?? new InputFile(SOUND_PATH);
      const m = await api.sendVoice(chatId, input, { disable_notification: true });
      // Cache the file_id so future plays don't re-upload the file.
      const voice = (m as unknown as { voice?: { file_id?: string } }).voice;
      if (!cachedFileId && voice?.file_id) {
        cachedFileId = voice.file_id;
      }
      // Schedule deletion. We deliberately do NOT mark this message as
      // protected — Clear Cache should also wipe any leftover click
      // sounds.
      setTimeout(() => {
        void api.deleteMessage(chatId, m.message_id).catch(() => {
          /* may already be gone */
        });
      }, AUTO_DELETE_MS);
    } catch (err) {
      logger.debug({ err }, 'click sound send failed');
    }
  })();
}
