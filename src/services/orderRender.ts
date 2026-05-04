/**
 * Shared helpers for rendering the delivered-items block on the My
 * Orders detail screen and the post-/start invoice deep-link.
 *
 * The delivered items are stored on `orders.delivered_items` as one
 * payload per line (URL, code, account creds, etc.) once the buyer
 * goes through Wallet Pay. We render them as a sequence of separate
 * Telegram blockquote pills:
 *
 *   *Received:*
 *
 *   > #1
 *   > [Open Link #1](https://…)
 *
 *   > #2
 *   > [Open Link #2](https://…)
 *
 * Each pair of `> …` lines is its own blockquote because
 * `renderMdHtml` treats blank lines as blockquote separators.
 *
 * Items that aren't an `https?://` URL render as plain text inside
 * the blockquote (e.g. `> ACCOUNT:PASSWORD`).
 */

const URL_RE = /^https?:\/\/\S+$/i;

/**
 * Build the blockquoted received-items block for an order. Returns an
 * empty string when there are no delivered items so the caller can
 * skip the section entirely.
 */
export function formatReceivedItemsBlock(deliveredItems: string | null | undefined): string {
  if (!deliveredItems) return '';
  const items = deliveredItems
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (items.length === 0) return '';
  const blocks = items.map((item, i) => {
    const n = i + 1;
    const inner = URL_RE.test(item) ? `[Open Link #${n}](${item})` : item;
    return `> #${n}\n> ${inner}`;
  });
  return blocks.join('\n\n');
}
