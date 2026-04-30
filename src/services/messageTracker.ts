/**
 * Tracks message IDs the bot has sent into each chat so the user-facing
 * "Clear Cache" button can delete old menu / navigation messages and
 * speed the chat up.
 *
 * Messages can be marked as *protected* — those represent claimed
 * products (e.g. delivered account/link purchase confirmations) and
 * must NOT be deleted by Clear Cache.
 */

const MAX_PER_CHAT = 500;

const sentByChat = new Map<number, number[]>();
const protectedByChat = new Map<number, Set<number>>();

export function recordMessage(chatId: number, messageId: number): void {
  const arr = sentByChat.get(chatId) ?? [];
  arr.push(messageId);
  if (arr.length > MAX_PER_CHAT) arr.shift();
  sentByChat.set(chatId, arr);
}

export function protectMessage(chatId: number, messageId: number): void {
  let s = protectedByChat.get(chatId);
  if (!s) {
    s = new Set<number>();
    protectedByChat.set(chatId, s);
  }
  s.add(messageId);
}

/**
 * Build the list of message IDs to attempt to delete for a chat.
 *
 * We combine two sources so Clear Cache works even on messages the bot
 * sent before the current process started (the in-memory tracker is
 * empty after every restart):
 *
 *   1. Any IDs we've actively tracked since the last restart.
 *   2. A scan-back window of `lookback` message IDs counting down from
 *      `anchorMessageId` (the message hosting the Settings screen the
 *      user pressed Clear Cache on). Telegram silently rejects deletes
 *      for messages that aren't ours or are older than 48 hours, so
 *      this is safe to brute-force.
 *
 * Protected IDs (claimed product deliveries) and IDs in `exclude` are
 * always skipped. Tracked IDs are then forgotten so we don't try to
 * delete them again on a later Clear Cache.
 */
export function buildDeletable(
  chatId: number,
  anchorMessageId: number | null,
  lookback: number,
  exclude: ReadonlySet<number> = new Set(),
): number[] {
  const tracked = sentByChat.get(chatId) ?? [];
  const protectedSet = protectedByChat.get(chatId) ?? new Set<number>();

  const candidateSet = new Set<number>();
  if (typeof anchorMessageId === 'number') {
    const start = Math.max(1, anchorMessageId - lookback);
    for (let id = anchorMessageId - 1; id >= start; id--) {
      candidateSet.add(id);
    }
  }
  for (const id of tracked) candidateSet.add(id);

  const toDelete: number[] = [];
  for (const id of candidateSet) {
    if (protectedSet.has(id)) continue;
    if (exclude.has(id)) continue;
    toDelete.push(id);
  }

  // Forget the tracked IDs we're about to attempt; keep only protected
  // ones so future Clear Cache calls don't keep re-attempting them.
  const remaining: number[] = [];
  for (const id of tracked) {
    if (protectedSet.has(id)) remaining.push(id);
  }
  sentByChat.set(chatId, remaining);

  // Sort descending so we delete newest-first (looks better visually
  // and the protect-current-message check stays correct).
  toDelete.sort((a, b) => b - a);
  return toDelete;
}
