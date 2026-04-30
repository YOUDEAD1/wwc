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
 * Return the list of (non-protected) tracked message IDs for a chat
 * and reset the tracker so the same IDs aren't deleted twice. Protected
 * IDs (claimed product deliveries) are kept.
 */
export function takeDeletable(chatId: number, exclude: ReadonlySet<number> = new Set()): number[] {
  const arr = sentByChat.get(chatId) ?? [];
  const protectedSet = protectedByChat.get(chatId) ?? new Set<number>();
  const toDelete: number[] = [];
  const remaining: number[] = [];
  for (const id of arr) {
    if (protectedSet.has(id) || exclude.has(id)) {
      remaining.push(id);
    } else {
      toDelete.push(id);
    }
  }
  sentByChat.set(chatId, remaining);
  return toDelete;
}
