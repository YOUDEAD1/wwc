import type { Composer } from 'grammy';
import { type Lang } from '../../config/index.js';
import { POPULAR_REGIONS, formatLocalTime, getRegion } from '../../config/regions.js';
import {
  countReferrals,
  getUserStats,
  listDeposits,
  listOrders,
  setUserEmail,
  setUserLanguage,
  setUserRegion,
  toggleNotification,
} from '../db/queries.js';
import {
  profileKeyboard,
  notificationsKeyboard,
  languageKeyboard,
  statsKeyboard,
  backToMainKeyboard,
  backToSettingsKeyboard,
} from '../keyboards/profile.js';
import { regionPickerKeyboard } from '../keyboards/region.js';
import type { AppCtx } from '../middleware/user.js';
import { env } from '../env.js';
import { renderPremium, renderMdHtml } from '../services/premium.js';

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "25 Apr 2026"-style short date in the user's timezone (UTC fallback). */
function formatShortDate(iso: string, timezone: string | null): string {
  const d = new Date(iso);
  if (timezone) {
    try {
      const fmt = new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: timezone,
      });
      return fmt.format(d);
    } catch {
      // fall through to UTC
    }
  }
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${day} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Build the line-by-line settings/profile screen as a Markdown string.
 * Each line is prefixed with a `{key}` token that maps to a premium
 * emoji (see config/index.ts EMOJI map). `renderMdHtml` later expands
 * these tokens and converts Markdown to HTML.
 */
function profileText(ctx: AppCtx): string {
  const u = ctx.user;
  const joined = formatShortDate(u.joined_at, u.timezone);
  const userLink = u.username ? `https://t.me/${u.username}` : `tg://user?id=${u.telegram_id}`;
  const status = u.status ?? ctx.t('profile.status.default');

  const lines: string[] = [];
  lines.push(`{profile_header} ${ctx.t('profile.title')}`);
  lines.push('');
  lines.push(`{profile_id} ${ctx.t('profile.row.id', { id: u.telegram_id })}`);
  lines.push(
    u.first_name
      ? `{profile_first_name} ${ctx.t('profile.row.first_name', { name: u.first_name })}`
      : `{profile_first_name} ${ctx.t('profile.row.first_name_empty')}`,
  );
  lines.push(
    u.username
      ? `{profile_username} ${ctx.t('profile.row.username', { username: u.username })}`
      : `{profile_username} ${ctx.t('profile.row.username_empty')}`,
  );
  lines.push(`{profile_link} ${ctx.t('profile.row.link', { link: userLink })}`);
  lines.push(`{profile_status} ${ctx.t('profile.row.status', { status })}`);
  lines.push(
    u.email
      ? `{profile_email} ${ctx.t('profile.row.email', { email: u.email })}`
      : `{profile_email} ${ctx.t('profile.row.email_empty')}`,
  );
  lines.push(
    `{profile_balance} ${ctx.t('profile.row.balance', { balance: Number(u.balance).toFixed(3) })}`,
  );
  lines.push(`{profile_language} ${ctx.t('profile.row.language', { language: ctx.lang.toUpperCase() })}`);
  if (u.region && u.timezone) {
    const tz = u.timezone;
    const reg = getRegion(u.region);
    const label = reg ? `${reg.flag} ${reg.name}` : u.region;
    lines.push(
      `{profile_region} ${ctx.t('profile.row.region', { region: label, time: formatLocalTime(tz) })}`,
    );
  } else {
    lines.push(`{profile_region} ${ctx.t('profile.row.region_empty')}`);
  }
  lines.push(`{profile_joined} ${ctx.t('profile.row.joined', { joined })}`);

  return lines.join('\n');
}

async function showProfile(ctx: AppCtx) {
  // HTML render path: keeps Markdown styling AND auto-wraps any unicode
  // emoji whose key has a configured premium custom_emoji_id.
  const html = renderMdHtml(profileText(ctx));
  if (ctx.callbackQuery) {
    await ctx.editMessageText(html, {
      parse_mode: 'HTML',
      reply_markup: profileKeyboard(ctx.lang),
      link_preview_options: { is_disabled: true },
    });
  } else {
    await ctx.reply(html, {
      parse_mode: 'HTML',
      reply_markup: profileKeyboard(ctx.lang),
      link_preview_options: { is_disabled: true },
    });
  }
}

function notificationsText(ctx: AppCtx): string {
  return [ctx.t('profile.notifications.title'), '', ctx.t('profile.notifications.body')].join('\n');
}

async function showNotifications(ctx: AppCtx) {
  await ctx.editMessageText(renderMdHtml(notificationsText(ctx)), {
    parse_mode: 'HTML',
    reply_markup: notificationsKeyboard(ctx.lang, {
      stock_alert: ctx.user.stock_alert,
      announcements: ctx.user.announcements,
    }),
  });
}

/** Format an ISO timestamp as e.g. "30 Apr 2026, 01:29 UTC". */
function formatAbsoluteUtc(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const mon = MONTHS_SHORT[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${mon} ${year}, ${hh}:${mm} UTC`;
}

/** "just now" / "5m ago" / "2h ago" / "3d ago" relative to now. */
function formatRelative(ctx: AppCtx, iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return ctx.t('profile.stats.rel.now');
  if (min < 60) return ctx.t('profile.stats.rel.minutes', { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return ctx.t('profile.stats.rel.hours', { n: hr });
  const days = Math.floor(hr / 24);
  return ctx.t('profile.stats.rel.days', { n: days });
}

async function showStats(ctx: AppCtx): Promise<void> {
  const s = await getUserStats(ctx.user.telegram_id);
  const orders = s.orders;
  const items = s.items;
  const spent = s.spent.toFixed(2);
  const deposits = s.deposits.toFixed(2);

  const lastLine =
    s.lastOrderAt === null
      ? ctx.t('profile.stats.last_none')
      : ctx.t('profile.stats.last', {
          rel: formatRelative(ctx, s.lastOrderAt),
          abs: formatAbsoluteUtc(s.lastOrderAt),
        });

  const template = [
    `{stats} ${ctx.t('profile.stats.title')}`,
    '',
    `{stats_orders} ${ctx.t('profile.stats.orders', { count: orders })}`,
    `{stats_items} ${ctx.t('profile.stats.items', { count: items })}`,
    `{stats_spent} ${ctx.t('profile.stats.spent', { amount: spent })}`,
    `{stats_last} ${lastLine}`,
    `{stats_deposits} ${ctx.t('profile.stats.deposits', { amount: deposits })}`,
  ].join('\n');

  const { text, entities } = renderPremium(template);
  await ctx.editMessageText(text, {
    entities,
    parse_mode: entities.length ? undefined : 'Markdown',
    reply_markup: statsKeyboard(ctx.lang),
  });
}

/** Show the region picker (page-N). */
async function showRegionPicker(ctx: AppCtx, page: number) {
  const text = [ctx.t('profile.region.title'), '', ctx.t('profile.region.body')].join('\n');
  await ctx.editMessageText(renderMdHtml(text), {
    parse_mode: 'HTML',
    reply_markup: regionPickerKeyboard(ctx.lang, page),
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function registerProfile(bot: Composer<AppCtx>): void {
  bot.callbackQuery('profile:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    // Drop any in-flight user flow (e.g. set_email) so subsequent
    // text messages aren't intercepted by a stale flow handler.
    ctx.session.userFlow = undefined;
    await showProfile(ctx);
  });

  // ---- Stats ----
  bot.callbackQuery('profile:stats', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showStats(ctx);
  });

  bot.callbackQuery('profile:stats:refresh', async (ctx) => {
    await ctx.answerCallbackQuery({ text: '🔄' });
    await showStats(ctx);
  });

  // ---- Orders ----
  bot.callbackQuery('profile:orders', async (ctx) => {
    await ctx.answerCallbackQuery();
    const orders = await listOrders(ctx.user.telegram_id);
    if (orders.length === 0) {
      await ctx.editMessageText(ctx.t('profile.orders.empty'), {
        reply_markup: backToSettingsKeyboard(ctx.lang),
      });
      return;
    }
    const lines = [ctx.t('profile.orders.title'), ''];
    for (const o of orders) {
      lines.push(
        ctx.t('profile.orders.line', {
          id: o.id,
          name: o.product_name,
          qty: o.qty,
          total: o.total,
          date: o.created_at.slice(0, 10),
        }),
      );
    }
    await ctx.editMessageText(renderMdHtml(lines.join('\n')), {
      parse_mode: 'HTML',
      reply_markup: backToSettingsKeyboard(ctx.lang),
    });
  });

  // ---- Refer ----
  // Reached from the main menu. Use a dedicated "Back to Main Menu"
  // keyboard so the Settings buttons don't appear underneath.
  bot.callbackQuery('profile:refer', async (ctx) => {
    await ctx.answerCallbackQuery();
    const code = ctx.user.ref_code ?? `R${ctx.user.telegram_id.toString(36).toUpperCase()}`;
    const link = `https://t.me/${env.BOT_USERNAME}?start=${code}`;
    const count = await countReferrals(ctx.user.telegram_id);
    const referText = `${ctx.t('profile.refer.title')}\n\n${ctx.t('profile.refer.body', { link, count })}`;
    await ctx.editMessageText(renderMdHtml(referText), {
      parse_mode: 'HTML',
      reply_markup: backToMainKeyboard(ctx.lang),
      link_preview_options: { is_disabled: true },
    });
  });

  // ---- Notifications submenu ----
  bot.callbackQuery('profile:notifications', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showNotifications(ctx);
  });

  bot.callbackQuery('profile:toggle_stock', async (ctx) => {
    const next = await toggleNotification(ctx.user.telegram_id, 'stock_alert');
    ctx.user.stock_alert = next;
    await ctx.answerCallbackQuery({
      text: next ? ctx.t('profile.notify.stock_on') : ctx.t('profile.notify.stock_off'),
    });
    await showNotifications(ctx);
  });

  bot.callbackQuery('profile:toggle_ann', async (ctx) => {
    const next = await toggleNotification(ctx.user.telegram_id, 'announcements');
    ctx.user.announcements = next;
    await ctx.answerCallbackQuery({
      text: next ? ctx.t('profile.notify.ann_on') : ctx.t('profile.notify.ann_off'),
    });
    await showNotifications(ctx);
  });

  // ---- Language ----
  bot.callbackQuery('profile:lang', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('🌐 Language / اللغة / Ngôn ngữ', {
      reply_markup: languageKeyboard(),
    });
  });

  bot.callbackQuery(/^lang:(en|ar|vi)$/, async (ctx) => {
    const next = ctx.match[1] as Lang;
    await setUserLanguage(ctx.user.telegram_id, next);
    ctx.user.language = next;
    ctx.lang = next;
    await ctx.answerCallbackQuery();
    await showProfile(ctx);
  });

  // ---- Region picker ----
  bot.callbackQuery('profile:region', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showRegionPicker(ctx, 0);
  });

  bot.callbackQuery(/^profile:region:p:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showRegionPicker(ctx, Number(ctx.match[1]));
  });

  bot.callbackQuery(/^profile:region:set:([A-Z]{2})$/, async (ctx) => {
    const code = ctx.match[1];
    const reg = POPULAR_REGIONS.find((r) => r.code === code);
    if (!reg) {
      await ctx.answerCallbackQuery({ text: 'Unknown region' });
      return;
    }
    await setUserRegion(ctx.user.telegram_id, reg.code, reg.timezone);
    ctx.user.region = reg.code;
    ctx.user.timezone = reg.timezone;
    await ctx.answerCallbackQuery({
      text: `${reg.flag} ${reg.name}`,
    });
    await showProfile(ctx);
  });

  bot.callbackQuery('profile:region:clear', async (ctx) => {
    await setUserRegion(ctx.user.telegram_id, null, null);
    ctx.user.region = null;
    ctx.user.timezone = null;
    await ctx.answerCallbackQuery({ text: '🚫 Cleared' });
    await showProfile(ctx);
  });

  // ---- Email setter ----
  bot.callbackQuery('profile:email', async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.userFlow = { type: 'set_email', step: 'value', data: {} };
    const text = [ctx.t('profile.email.title'), '', ctx.t('profile.email.body')].join('\n');
    await ctx.editMessageText(renderMdHtml(text), {
      parse_mode: 'HTML',
      reply_markup: backToSettingsKeyboard(ctx.lang),
    });
  });

  // Capture the next text message as the email value.
  bot.on('message:text', async (ctx, next) => {
    const flow = ctx.session.userFlow;
    if (!flow || flow.type !== 'set_email') return next();
    const text = ctx.message.text.trim();
    if (text === '/cancel' || text.startsWith('/')) {
      ctx.session.userFlow = undefined;
      return next();
    }
    if (!EMAIL_RE.test(text)) {
      await ctx.reply(renderMdHtml(ctx.t('profile.email.bad')), { parse_mode: 'HTML' });
      return;
    }
    await setUserEmail(ctx.user.telegram_id, text);
    ctx.user.email = text;
    ctx.session.userFlow = undefined;
    await ctx.reply(renderMdHtml(ctx.t('profile.email.saved', { email: text })), {
      parse_mode: 'HTML',
      reply_markup: backToSettingsKeyboard(ctx.lang),
    });
  });

  // ---- Deposit history ----
  bot.callbackQuery('profile:deposits', async (ctx) => {
    await ctx.answerCallbackQuery();
    const deposits = await listDeposits(ctx.user.telegram_id);
    if (deposits.length === 0) {
      await ctx.editMessageText(ctx.t('profile.deposits.empty'), {
        reply_markup: backToSettingsKeyboard(ctx.lang),
      });
      return;
    }
    const lines = [ctx.t('profile.deposits.title'), ''];
    for (const d of deposits) {
      lines.push(
        ctx.t('profile.deposits.line', {
          id: d.id,
          amount: d.amount,
          method: d.method,
          status: d.status,
          date: d.created_at.slice(0, 10),
        }),
      );
    }
    await ctx.editMessageText(renderMdHtml(lines.join('\n')), {
      parse_mode: 'HTML',
      reply_markup: backToSettingsKeyboard(ctx.lang),
    });
  });
}
