import { InlineKeyboard } from 'grammy';
import { type Lang } from '../../config/index.js';
import { POPULAR_REGIONS, REGIONS_PER_PAGE } from '../../config/regions.js';
import { btn } from './helpers.js';

/**
 * Paginated region picker. Each tile shows the country flag + name;
 * tapping it commits the selection (callback `profile:region:set:CC`).
 *
 * Pages are 0-indexed. We render two columns to keep labels readable
 * on mobile.
 */
export function regionPickerKeyboard(lang: Lang, page: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  const total = POPULAR_REGIONS.length;
  const pages = Math.max(1, Math.ceil(total / REGIONS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pages - 1);
  const start = safePage * REGIONS_PER_PAGE;
  const slice = POPULAR_REGIONS.slice(start, start + REGIONS_PER_PAGE);

  for (let i = 0; i < slice.length; i += 2) {
    const a = slice[i]!;
    kb.text(`${a.flag} ${a.name}`, `profile:region:set:${a.code}`);
    const b = slice[i + 1];
    if (b) kb.text(`${b.flag} ${b.name}`, `profile:region:set:${b.code}`);
    kb.row();
  }

  // Pagination controls (only when needed).
  if (pages > 1) {
    if (safePage > 0) kb.text(btn(lang, 'prev'), `profile:region:p:${safePage - 1}`);
    kb.text(`${safePage + 1}/${pages}`, 'noop:page');
    if (safePage < pages - 1) kb.text(btn(lang, 'next'), `profile:region:p:${safePage + 1}`);
    kb.row();
  }

  // Clear + Back row.
  kb.text('🚫 Clear', 'profile:region:clear');
  kb.text(btn(lang, 'back_to_settings'), 'profile:open');
  return kb;
}
