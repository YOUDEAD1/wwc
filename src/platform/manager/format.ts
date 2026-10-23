// Pure formatter: the controller must not import a commerce worker's environment.
import type { MessageEntity } from 'grammy/types';
import { escapeHtml } from './content.js';
export function entitiesToHtml(text: string, entities: ReadonlyArray<MessageEntity> = []) {
  const ranges = entities.flatMap((e, i) => {
    let tag: [string, string] | undefined;
    const tags: Record<string, string> = {
      bold: 'b',
      italic: 'i',
      underline: 'u',
      strikethrough: 's',
      spoiler: 'tg-spoiler',
      code: 'code',
      blockquote: 'blockquote',
      expandable_blockquote: 'blockquote expandable',
    };
    if (tags[e.type]) tag = ['<' + tags[e.type] + '>', '</' + tags[e.type]!.split(' ')[0] + '>'];
    if (e.type === 'pre') tag = ['<pre>', '</pre>'];
    if (e.type === 'text_link' && /^(https?:\/\/|tg:\/\/|mailto:)/.test(e.url))
      tag = ['<a href="' + escapeHtml(e.url) + '">', '</a>'];
    if (e.type === 'custom_emoji' && /^\d{5,25}$/.test(e.custom_emoji_id))
      tag = ['<tg-emoji emoji-id="' + e.custom_emoji_id + '">', '</tg-emoji>'];
    const start = Math.max(0, Math.min(text.length, e.offset)),
      end = Math.max(start, Math.min(text.length, e.offset + e.length));
    return tag && end > start ? [{ id: i, start, end, tag }] : [];
  });
  const points = [...new Set([0, text.length, ...ranges.flatMap((r) => [r.start, r.end])])].sort(
    (a, b) => a - b,
  );
  let out = '',
    active: typeof ranges = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!,
      end = points[i + 1]!,
      next = ranges
        .filter((r) => r.start <= start && r.end >= end)
        .sort((a, b) => a.start - b.start || b.end - a.end || a.id - b.id);
    let same = 0;
    while (same < active.length && same < next.length && active[same]!.id === next[same]!.id)
      same++;
    for (let j = active.length - 1; j >= same; j--) out += active[j]!.tag[1];
    for (let j = same; j < next.length; j++) out += next[j]!.tag[0];
    out += escapeHtml(text.slice(start, end));
    active = next;
  }
  return (
    out +
    active
      .reverse()
      .map((r) => r.tag[1])
      .join('')
  );
}
