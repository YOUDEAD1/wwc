import type { Composer } from 'grammy';
import { type Lang } from '../../config/index.js';
import {
  countReferrals,
  getUserStats,
  listDeposits,
  listOrders,
  setUserLanguage,
  toggleNotification,
} from '../db/queries.js';
import {
  profileKeyboard,
  notificationsKeyboard,
  languageKeyboard,
  statsKeyboard,
} from '../keyboards/profile.js';
import type { AppCtx } from '../middleware/user.js';
import { env } from '../env.js';
import { renderPremium } from '../services/premium.js';

function profileText(ctx: AppCtx): string {
  const joined = new Date(ctx.user.joined_at).toISOString().slice(0, 10);
  return [
    ctx.t('profile.title'),
    '',
    ctx.t('profile.user_id', { id: ctx.user.telegram_id }),
    ctx.user.username ? ctx.t('profile.username', { username: ctx.user.username }) : '',
    ctx.t('profile.balance', { balance: ctx.user.balance }),
    ctx.t('profile.language', { language: ctx.lang.toUpperCase() }),
    ctx.t('profile.joined', { joined }),
  ]
    .filter(Boolean)
    .join('\n');
}

async function showProfile(ctx: AppCtx) {
  const text = profileText(ctx);
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: profileKeyboard(ctx.lang),
    });
  } else {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: profileKeyboard(ctx.lang),
    });
  }
}

function notificationsText(ctx: AppCtx): string {
  return [ctx.t('profile.notifications.title'), '', ctx.t('profile.notifications.body')].join('\n');
}

async function showNotifications(ctx: AppCtx) {
  await ctx.editMessageText(notificationsText(ctx), {
    parse_mode: 'Markdown',
    reply_markup: notificationsKeyboard(ctx.lang, {
      stock_alert: ctx.user.stock_alert,
      announcements: ctx.user.announcements,
    }),
  });
}

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

  // Each {token} is replaced with the unicode glyph + an attached
  // custom_emoji entity (premium users see the styled glyph). We
  // intentionally avoid Markdown bold here because Telegram ignores
  // entities when parse_mode is set.
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

export function registerProfile(bot: Composer<AppCtx>): void {
  bot.callbackQuery('profile:open', async (ctx) => {
    await ctx.answerCallbackQuery();
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
        reply_markup: profileKeyboard(ctx.lang),
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
    await ctx.editMessageText(lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: profileKeyboard(ctx.lang),
    });
  });

  // ---- Refer ----
  bot.callbackQuery('profile:refer', async (ctx) => {
    await ctx.answerCallbackQuery();
    const code = ctx.user.ref_code ?? `R${ctx.user.telegram_id.toString(36).toUpperCase()}`;
    const link = `https://t.me/${env.BOT_USERNAME}?start=${code}`;
    const count = await countReferrals(ctx.user.telegram_id);
    await ctx.editMessageText(
      `${ctx.t('profile.refer.title')}\n\n${ctx.t('profile.refer.body', { link, count })}`,
      {
        parse_mode: 'Markdown',
        reply_markup: profileKeyboard(ctx.lang),
      },
    );
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

  // ---- Deposit history ----
  bot.callbackQuery('profile:deposits', async (ctx) => {
    await ctx.answerCallbackQuery();
    const deposits = await listDeposits(ctx.user.telegram_id);
    if (deposits.length === 0) {
      await ctx.editMessageText(ctx.t('profile.deposits.empty'), {
        reply_markup: profileKeyboard(ctx.lang),
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
    await ctx.editMessageText(lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: profileKeyboard(ctx.lang),
    });
  });

}
