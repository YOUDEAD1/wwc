import type { Composer } from 'grammy';
import { type Lang } from '../../config/index.js';
import { POPULAR_REGIONS, formatLocalTime, getRegion } from '../../config/regions.js';
import {
  adjustBalance,
  countReferrals,
  countReferralsSince,
  countGiftCodeRedemptions,
  countGiftCodeRedemptionsByUser,
  findUserByEmail,
  getGiftCode,
  getOrder,
  getReferralEarnings,
  getUserStats,
  listDeposits,
  listOrders,
  listOrdersPaginated,
  listWalletLedger,
  recordGiftCodeRedemption,
  recordLedger,
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
  backToSettingsKeyboard,
  depositsActionsKeyboard,
  emailDeleteConfirmKeyboard,
  emailHubKeyboard,
  emailScreenKeyboard,
  referKeyboard,
  whyEmailKeyboard,
} from '../keyboards/profile.js';
import { regionPickerKeyboard } from '../keyboards/region.js';
import { ordersListKeyboard, orderDetailKeyboard, ORDERS_PER_PAGE } from '../keyboards/orders.js';
import { redeemKeyboard } from '../keyboards/redeem.js';
import { publicOrderId, parsePublicOrderId } from '../services/orderId.js';
import type { AppCtx } from '../middleware/user.js';
import { env } from '../env.js';
import { renderPremium, renderMdHtml } from '../services/premium.js';
import { sendWelcomeEmail, sendReportEmail, type ReportKind } from '../services/mailer.js';
import {
  buildOrdersPdf,
  buildDepositsPdf,
  buildStatsPdf,
} from '../services/pdfReport.js';
import { logger } from '../logger.js';
import { getEmailPdfUrl, getAdminContactUrl } from '../services/settings.js';
import { InputFile } from 'grammy';
import { fileURLToPath } from 'url';
import { dirname, resolve as pathResolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/** Path to the explanatory PDF shipped under `assets/`. */
const EMAIL_PDF_PATH = pathResolve(__dirname, '../../../assets/email-explanation.pdf');

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
  // Email row: when set, also stamp "Has been Saved!" + the saved-check
  // premium emoji at the end.
  if (u.email) {
    lines.push(`{profile_email} ${ctx.t('profile.row.email', { email: u.email })}`);
  } else {
    lines.push(`{profile_email} ${ctx.t('profile.row.email_empty')}`);
  }
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

async function showProfile(ctx: AppCtx, opts: { forceReply?: boolean } = {}) {
  // HTML render path: keeps Markdown styling AND auto-wraps any unicode
  // emoji whose key has a configured premium custom_emoji_id.
  const html = renderMdHtml(profileText(ctx));
  const reply_markup = profileKeyboard(ctx.lang);
  // `forceReply` is used after saving an email — we want to send a
  // FRESH settings message (not edit the pre-edit prompt) so the user
  // immediately sees the saved value.
  if (ctx.callbackQuery && !opts.forceReply) {
    await ctx.editMessageText(html, {
      parse_mode: 'HTML',
      reply_markup,
      link_preview_options: { is_disabled: true },
    });
  } else {
    await ctx.reply(html, {
      parse_mode: 'HTML',
      reply_markup,
      link_preview_options: { is_disabled: true },
    });
  }
}

async function showEmailHub(ctx: AppCtx) {
  const current = ctx.user.email
    ? `\`${ctx.user.email}\``
    : '_not set_';
  // Compact two-line layout: title + "Email: <current>".
  const text = [
    ctx.t('profile.email.hub.title'),
    ctx.t('profile.email.hub.body', { current }),
  ].join('\n');
  await ctx.editMessageText(renderMdHtml(text), {
    parse_mode: 'HTML',
    reply_markup: emailHubKeyboard(ctx.lang),
  });
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
      wallet_alert: ctx.user.wallet_alert ?? true,
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

/**
 * Shared body for the three "Send PDF to Email" callbacks. We answer
 * the callback query twice: once with a "sending..." toast (so the
 * user sees feedback while we render the PDF + hit Resend) and once
 * with the final success / failure popup. The screen the user
 * triggered the action from is never edited — they remain on the
 * same orders / deposits / stats list.
 */
async function sendReportPdfFromCallback(
  ctx: AppCtx,
  kind: ReportKind,
): Promise<void> {
  const email = ctx.user.email;
  if (!email) {
    await ctx.answerCallbackQuery({
      text: ctx.t('pdf.no_email_popup'),
      show_alert: true,
    });
    return;
  }
  await ctx.answerCallbackQuery({
    text: ctx.t('pdf.sending_popup', { email }),
    show_alert: false,
  });
  try {
    const reportUser = {
      telegram_id: ctx.user.telegram_id,
      first_name: ctx.user.first_name ?? null,
      username: ctx.user.username ?? null,
      email,
    };
    let pdf: Buffer;
    if (kind === 'orders') {
      const orders = await listOrders(ctx.user.telegram_id, 500);
      pdf = await buildOrdersPdf({ user: reportUser, orders });
    } else if (kind === 'deposits') {
      const [deposits, ledger] = await Promise.all([
        listDeposits(ctx.user.telegram_id, 500),
        listWalletLedger(ctx.user.telegram_id, 500).catch(() => []),
      ]);
      pdf = await buildDepositsPdf({ user: reportUser, deposits, ledger });
    } else {
      const stats = await getUserStats(ctx.user.telegram_id);
      pdf = await buildStatsPdf({ user: reportUser, stats });
    }
    const ok = await sendReportEmail({
      email,
      kind,
      pdf,
      firstName: ctx.user.first_name ?? null,
      username: ctx.user.username ?? null,
    });
    if (ok) {
      // Surface success as a real chat message so the premium 📬
      // custom emoji renders as a `<tg-emoji>` entity rather than a
      // plain toast (Telegram strips custom_emoji from popup text).
      // Auto-deleted 5 s later so the chat doesn't fill up with
      // confirmations after multiple Send-PDF taps.
      const sent = await ctx.reply(renderMdHtml(ctx.t('pdf.sent_message')), {
        parse_mode: 'HTML',
      });
      const chatId = sent.chat.id;
      const messageId = sent.message_id;
      setTimeout(() => {
        ctx.api.deleteMessage(chatId, messageId).catch((err) => {
          logger.warn({ err, chatId, messageId }, 'pdf.sent_message auto-delete failed');
        });
      }, 5_000);
    } else {
      await ctx.answerCallbackQuery({
        text: ctx.t('pdf.failed_popup', { email }),
        show_alert: true,
      });
    }
  } catch (err) {
    logger.error({ err, kind, telegram_id: ctx.user.telegram_id }, 'send-pdf flow failed');
    await ctx.answerCallbackQuery({
      text: ctx.t('pdf.failed_popup', { email }),
      show_alert: true,
    });
  }
}

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

  // ---- Send-PDF buttons (My Orders / Deposits / Stats screens) ----
  // Each callback re-uses the same flow:
  //   1. Bail with a popup if the user hasn't set their email yet.
  //   2. Show a "sending" popup, generate the PDF, hand it to the
  //      mailer, then update the popup with success / failure text.
  // The list / detail message is not touched so the user can keep
  // scrolling while the email is on its way.
  bot.callbackQuery('profile:orders:pdf', async (ctx) => {
    await sendReportPdfFromCallback(ctx, 'orders');
  });
  bot.callbackQuery('profile:deposits:pdf', async (ctx) => {
    await sendReportPdfFromCallback(ctx, 'deposits');
  });
  bot.callbackQuery('profile:stats:pdf', async (ctx) => {
    await sendReportPdfFromCallback(ctx, 'stats');
  });

  // ---- My Orders (list) ----
  // Paginated 2-column grid: each row is [Product Name] [Active status]
  // and tapping anywhere opens that order's detail screen.
  async function showOrdersPage(ctx: AppCtx, page: number): Promise<void> {
    const { rows, total } = await listOrdersPaginated(
      ctx.user.telegram_id,
      page,
      ORDERS_PER_PAGE,
    );
    if (total === 0) {
      await ctx.editMessageText(renderMdHtml(ctx.t('orders.empty')), {
        parse_mode: 'HTML',
        reply_markup: backToSettingsKeyboard(ctx.lang),
      });
      return;
    }
    const totalPages = Math.max(1, Math.ceil(total / ORDERS_PER_PAGE));
    const text = [ctx.t('orders.title'), '', ctx.t('orders.body')].join('\n');
    await ctx.editMessageText(renderMdHtml(text), {
      parse_mode: 'HTML',
      reply_markup: ordersListKeyboard(ctx.lang, rows, page, totalPages),
    });
  }

  bot.callbackQuery('profile:orders', async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.userFlow = { type: 'orders_lookup', step: 'value', data: {} };
    await showOrdersPage(ctx, 0);
  });

  bot.callbackQuery(/^orders:p:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showOrdersPage(ctx, Number(ctx.match[1]));
  });

  // ---- Order detail ----
  async function renderOrderDetail(ctx: AppCtx, orderId: number, asReply = false): Promise<void> {
    const order = await getOrder(orderId);
    if (!order || order.user_id !== ctx.user.telegram_id) {
      const msg = '⚠️ Order not found.';
      if (asReply) await ctx.reply(msg);
      else await ctx.editMessageText(msg, { reply_markup: backToSettingsKeyboard(ctx.lang) });
      return;
    }
    const pubId = publicOrderId(order);
    const status =
      order.status === 'paid'
        ? ctx.t('orders.status.active')
        : order.status === 'refunded'
        ? ctx.t('orders.status.refunded')
        : ctx.t('orders.status.cancelled');
    const when = formatAbsoluteUtc(order.created_at);
    const total = Number(order.total).toFixed(order.total % 1 === 0 ? 0 : 2);
    const lines = [
      ctx.t('orders.detail.title'),
      '',
      ctx.t('orders.detail.id', { id: pubId }),
      ctx.t('orders.detail.product', { name: order.product_name }),
      ctx.t('orders.detail.type', { type: ctx.t('orders.detail.type.wallet') }),
      ctx.t('orders.detail.qty', { qty: order.qty }),
      ctx.t('orders.detail.total', { total }),
      ctx.t('orders.detail.when', { when }),
      ctx.t('orders.detail.status', { status }),
      ctx.t('orders.detail.paid', { paid: when }),
      ctx.t('orders.detail.delivered', { delivered: when }),
    ];
    if (order.delivery) {
      const urlMatch = order.delivery.match(/https?:\/\/\S+/);
      const deliveryText = urlMatch ? urlMatch[0] : order.delivery;
      lines.push('', ctx.t('orders.detail.received', { received: deliveryText }));
    }
    const html = renderMdHtml(lines.join('\n'));
    const openUrl = order.delivery?.match(/https?:\/\/\S+/)?.[0] ?? null;
    const reply_markup = orderDetailKeyboard(ctx.lang, openUrl);
    if (asReply) {
      await ctx.reply(html, {
        parse_mode: 'HTML',
        reply_markup,
        link_preview_options: { is_disabled: true },
      });
    } else {
      await ctx.editMessageText(html, {
        parse_mode: 'HTML',
        reply_markup,
        link_preview_options: { is_disabled: true },
      });
    }
  }

  bot.callbackQuery(/^orders:open:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderOrderDetail(ctx, Number(ctx.match[1]));
  });

  // Allow users to type a public Order ID to open it (works while
  // the My Orders flow is active).
  bot.on('message:text', async (ctx, next) => {
    const flow = ctx.session.userFlow;
    if (!flow || flow.type !== 'orders_lookup') return next();
    const text = ctx.message.text.trim();
    if (text === '/cancel' || text.startsWith('/')) {
      ctx.session.userFlow = undefined;
      return next();
    }
    const id = parsePublicOrderId(text);
    if (!id) {
      await ctx.reply('That doesn\'t look like a valid Order ID.');
      return;
    }
    await renderOrderDetail(ctx, id, true);
  });

  // ---- Redeem Gift Code ----
  async function showRedeemScreen(ctx: AppCtx): Promise<void> {
    const balance = Number(ctx.user.balance).toFixed(
      ctx.user.balance % 1 === 0 ? 0 : 2,
    );
    const text = [
      ctx.t('gift.title'),
      '',
      ctx.t('gift.body', { balance }),
    ].join('\n');
    await ctx.editMessageText(renderMdHtml(text), {
      parse_mode: 'HTML',
      reply_markup: redeemKeyboard(ctx.lang, getAdminContactUrl()),
    });
  }

  bot.callbackQuery('profile:redeem', async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.userFlow = { type: 'redeem_gift', step: 'value', data: {} };
    await showRedeemScreen(ctx);
  });

  // Capture the next plain-text message as the gift code.
  bot.on('message:text', async (ctx, next) => {
    const flow = ctx.session.userFlow;
    if (!flow || flow.type !== 'redeem_gift') return next();
    const code = ctx.message.text.trim().toUpperCase();
    if (code === '/CANCEL' || code.startsWith('/')) {
      ctx.session.userFlow = undefined;
      return next();
    }
    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
      await ctx.reply(renderMdHtml(ctx.t('gift.invalid')), { parse_mode: 'HTML' });
      return;
    }
    const gift = await getGiftCode(code);
    if (!gift) {
      await ctx.reply(renderMdHtml(ctx.t('gift.invalid')), { parse_mode: 'HTML' });
      return;
    }
    if (gift.expires_at && new Date(gift.expires_at).getTime() < Date.now()) {
      await ctx.reply(renderMdHtml(ctx.t('gift.expired')), { parse_mode: 'HTML' });
      return;
    }
    const usedByUser = await countGiftCodeRedemptionsByUser(code, ctx.user.telegram_id);
    if (usedByUser >= gift.per_user_limit) {
      await ctx.reply(renderMdHtml(ctx.t('gift.already_used')), { parse_mode: 'HTML' });
      return;
    }
    if (gift.max_redemptions != null) {
      const totalUsed = await countGiftCodeRedemptions(code);
      if (totalUsed >= gift.max_redemptions) {
        await ctx.reply(renderMdHtml(ctx.t('gift.exhausted')), { parse_mode: 'HTML' });
        return;
      }
    }
    // All checks passed — credit the wallet, log the ledger entry,
    // record the redemption row.
    const amount = Number(gift.amount);
    const newBalance = await adjustBalance(ctx.user.telegram_id, amount);
    await recordLedger(
      ctx.user.telegram_id,
      'gift_code',
      amount,
      `gift:${code}`,
    );
    await recordGiftCodeRedemption({
      code,
      user_id: ctx.user.telegram_id,
      amount,
    });
    ctx.user.balance = newBalance;
    ctx.session.userFlow = undefined;
    const formatted = amount.toFixed(amount % 1 === 0 ? 0 : 2);
    await ctx.reply(
      renderMdHtml(ctx.t('gift.redeemed', { amount: formatted })),
      { parse_mode: 'HTML' },
    );
  });

  // ---- Refer ----
  // Reached from the main menu. Renders the user's referral stats
  // (24-hour, 7-day, lifetime), referral-earning balances, the rules
  // blockquote, and a Copy Link button + Back row.
  bot.callbackQuery('profile:refer', async (ctx) => {
    await ctx.answerCallbackQuery();
    const code = ctx.user.ref_code ?? `R${ctx.user.telegram_id.toString(36).toUpperCase()}`;
    const link = `https://t.me/${env.BOT_USERNAME}?start=${code}`;
    const DAY = 24 * 60 * 60 * 1000;
    const [refTotal, ref24h, ref7d, earnings] = await Promise.all([
      countReferrals(ctx.user.telegram_id),
      countReferralsSince(ctx.user.telegram_id, DAY),
      countReferralsSince(ctx.user.telegram_id, 7 * DAY),
      getReferralEarnings(ctx.user.telegram_id),
    ]);
    const fmt = (n: number): string => n.toFixed(n % 1 === 0 ? 0 : 2);
    const body = ctx.t('profile.refer.body', {
      link,
      ref24h,
      ref7d,
      refTotal,
      earnedTotal: fmt(earnings.total),
      available: fmt(earnings.available),
      transferred: fmt(earnings.transferred),
      withdrawn: fmt(earnings.withdrawn),
    });
    const referText = `${ctx.t('profile.refer.title')}\n\n${body}`;
    await ctx.editMessageText(renderMdHtml(referText), {
      parse_mode: 'HTML',
      reply_markup: referKeyboard(ctx.lang, link),
      link_preview_options: { is_disabled: true },
    });
  });

  // ---- Notifications submenu ----
  bot.callbackQuery('profile:notifications', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showNotifications(ctx);
  });

  bot.callbackQuery('profile:toggle_stock', async (ctx) => {
    try {
      const next = await toggleNotification(ctx.user.telegram_id, 'stock_alert');
      ctx.user.stock_alert = next;
      await ctx.answerCallbackQuery({
        text: next ? ctx.t('profile.notify.stock_on') : ctx.t('profile.notify.stock_off'),
      });
      await showNotifications(ctx);
    } catch {
      await ctx.answerCallbackQuery({
        text: ctx.t('profile.notify.error'),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery('profile:toggle_ann', async (ctx) => {
    try {
      const next = await toggleNotification(ctx.user.telegram_id, 'announcements');
      ctx.user.announcements = next;
      await ctx.answerCallbackQuery({
        text: next ? ctx.t('profile.notify.ann_on') : ctx.t('profile.notify.ann_off'),
      });
      await showNotifications(ctx);
    } catch {
      await ctx.answerCallbackQuery({
        text: ctx.t('profile.notify.error'),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery('profile:toggle_wallet', async (ctx) => {
    try {
      const next = await toggleNotification(ctx.user.telegram_id, 'wallet_alert');
      ctx.user.wallet_alert = next;
      await ctx.answerCallbackQuery({
        text: next ? ctx.t('profile.notify.wallet_on') : ctx.t('profile.notify.wallet_off'),
      });
      await showNotifications(ctx);
    } catch {
      await ctx.answerCallbackQuery({
        text: ctx.t('profile.notify.error'),
        show_alert: true,
      });
    }
  });

  // ---- Language ----
  // The picker title is rendered through `renderMdHtml` so the
  // wrapping premium emojis (`{lang_left}` / `{lang_right}`) and
  // the bold "Select Language" mid-text all show up correctly.
  bot.callbackQuery('profile:lang', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(renderMdHtml(ctx.t('profile.language.title')), {
      parse_mode: 'HTML',
      reply_markup: languageKeyboard(ctx.lang),
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
    try {
      await setUserRegion(ctx.user.telegram_id, reg.code, reg.timezone);
    } catch (err) {
      console.error('setUserRegion failed', err);
      await ctx.answerCallbackQuery({
        text: 'Could not save region — admin must apply migration 0005.',
        show_alert: true,
      });
      return;
    }
    ctx.user.region = reg.code;
    ctx.user.timezone = reg.timezone;
    await ctx.answerCallbackQuery({
      text: `${reg.flag} ${reg.name}`,
    });
    await showProfile(ctx);
  });

  bot.callbackQuery('profile:region:clear', async (ctx) => {
    try {
      await setUserRegion(ctx.user.telegram_id, null, null);
    } catch (err) {
      console.error('setUserRegion(null) failed', err);
      await ctx.answerCallbackQuery({
        text: 'Could not clear region — admin must apply migration 0005.',
        show_alert: true,
      });
      return;
    }
    ctx.user.region = null;
    ctx.user.timezone = null;
    await ctx.answerCallbackQuery({ text: '🚫 Cleared' });
    await showProfile(ctx);
  });

  // ---- Email Settings hub (3-button submenu) ----
  bot.callbackQuery('profile:email', async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.userFlow = undefined;
    await showEmailHub(ctx);
  });

  // Set Email screen.
  bot.callbackQuery('profile:email:set', async (ctx) => {
    // If the user already has an email on file, "Set Email" doesn't
    // make sense — bounce them with a mobile popup pointing at
    // Change / Delete instead so we never silently overwrite a saved
    // address.
    if (ctx.user.email) {
      await ctx.answerCallbackQuery({
        text: ctx.t('profile.email.set.already_set_popup', { current: ctx.user.email }),
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    ctx.session.userFlow = { type: 'set_email', step: 'value', data: { mode: 'set' } };
    const text = [
      ctx.t('profile.email.set.title'),
      '',
      ctx.t('profile.email.set.body'),
    ].join('\n');
    await ctx.editMessageText(renderMdHtml(text), {
      parse_mode: 'HTML',
      reply_markup: emailScreenKeyboard(ctx.lang),
    });
  });

  // Change Email screen — always shown in the hub, but if the user
  // doesn't have an email yet we abort with a mobile popup instead
  // of opening the screen.
  bot.callbackQuery('profile:email:change', async (ctx) => {
    if (!ctx.user.email) {
      await ctx.answerCallbackQuery({
        text: ctx.t('profile.email.change.no_email_popup'),
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    ctx.session.userFlow = { type: 'set_email', step: 'value', data: { mode: 'change' } };
    const text = [
      ctx.t('profile.email.change.title'),
      '',
      ctx.t('profile.email.change.body', { current: ctx.user.email }),
    ].join('\n');
    await ctx.editMessageText(renderMdHtml(text), {
      parse_mode: 'HTML',
      reply_markup: emailScreenKeyboard(ctx.lang),
    });
  });

  // Delete Email confirmation screen — only reachable when an email
  // is on file. Hitting Confirm Delete clears the row; Cancel
  // bounces back to the Email Settings hub.
  bot.callbackQuery('profile:email:delete', async (ctx) => {
    if (!ctx.user.email) {
      await ctx.answerCallbackQuery({
        text: ctx.t('profile.email.delete.no_email_popup'),
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    ctx.session.userFlow = undefined;
    const text = [
      ctx.t('profile.email.delete.title'),
      '',
      ctx.t('profile.email.delete.body', { current: ctx.user.email }),
    ].join('\n');
    await ctx.editMessageText(renderMdHtml(text), {
      parse_mode: 'HTML',
      reply_markup: emailDeleteConfirmKeyboard(ctx.lang),
    });
  });

  // Confirmed delete — null out the column, refresh the in-memory
  // user, and drop the user back on the Email Settings hub so they
  // immediately see "Current email: _not set_".
  bot.callbackQuery('profile:email:delete:confirm', async (ctx) => {
    if (!ctx.user.email) {
      await ctx.answerCallbackQuery({
        text: ctx.t('profile.email.delete.no_email_popup'),
        show_alert: true,
      });
      await showEmailHub(ctx);
      return;
    }
    const oldEmail = ctx.user.email;
    try {
      await setUserEmail(ctx.user.telegram_id, null);
    } catch (err) {
      console.error('setUserEmail(null) failed', err);
      await ctx.answerCallbackQuery({
        text: ctx.t('err.generic'),
        show_alert: true,
      });
      return;
    }
    ctx.user.email = null;
    // Fire-and-forget the deletion confirmation email to the address
    // we just removed so the (human) owner sees evidence of the
    // change — important for the "I never deleted this" recovery
    // path. No PDF attachment for this mode.
    void sendWelcomeEmail({
      email: oldEmail,
      previousEmail: oldEmail,
      firstName: ctx.user.first_name ?? null,
      username: ctx.user.username ?? null,
      mode: 'delete',
    });
    await ctx.answerCallbackQuery({
      text: ctx.t('profile.email.delete.success'),
    });
    await showEmailHub(ctx);
  });

  // Why Email — explanatory screen with a "Know More" PDF button.
  bot.callbackQuery('profile:email:why', async (ctx) => {
    await ctx.answerCallbackQuery();
    // Drop any in-flight email flow so a stray text after reading
    // "Why?" isn't misinterpreted as the new email value.
    ctx.session.userFlow = undefined;
    const text = [
      ctx.t('profile.email.why.title'),
      '',
      ctx.t('profile.email.why.body'),
    ].join('\n');
    const pdfUrl = getEmailPdfUrl();
    await ctx.editMessageText(renderMdHtml(text), {
      parse_mode: 'HTML',
      reply_markup: whyEmailKeyboard(ctx.lang, pdfUrl),
      link_preview_options: { is_disabled: true },
    });
  });

  // Fallback: send the bundled PDF as a chat document (no caption,
  // per user request — "don't add texts under file"). Only fires when
  // `email.pdf_url` setting is unset and the keyboard renders this as
  // a callback button instead of a URL button.
  bot.callbackQuery('profile:email:why:more', async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.replyWithDocument(new InputFile(EMAIL_PDF_PATH));
    } catch (err) {
      console.error('failed to send email-explanation PDF', err);
      await ctx.reply(ctx.t('err.generic'));
    }
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
    // Reject any email already saved against a *different* telegram
    // user. A user re-saving their own address still passes — that
    // path is exercised by `mode='change'` and idempotent re-saves.
    const existingOwner = await findUserByEmail(text);
    if (existingOwner && existingOwner !== ctx.user.telegram_id) {
      await ctx.reply(renderMdHtml(ctx.t('profile.email.in_use')), {
        parse_mode: 'HTML',
      });
      return;
    }
    try {
      await setUserEmail(ctx.user.telegram_id, text);
    } catch (err) {
      console.error('setUserEmail failed', err);
      // Most common causes:
      //   1. Migration 0005 was never applied (`email` column missing).
      //   2. Migration ran, but PostgREST's schema cache is stale — it
      //      will return PGRST204 ("Could not find the 'email' column
      //      … in the schema cache") until the API is reloaded:
      //        select pg_notify('pgrst', 'reload schema');
      //      or Supabase Dashboard → Project Settings → API → Restart.
      const e = err as { code?: string; message?: string } | undefined;
      const escape = (s: string): string =>
        s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
      const detail = e?.message
        ? ` <i>(${escape(e.code ?? 'err')}: ${escape(e.message)})</i>`
        : '';
      await ctx.reply(
        '⚠️ Could not save your email — the bot operator must apply ' +
          'migration <code>0005_user_profile_fields.sql</code>. If it is ' +
          'already applied, reload the API schema in Supabase ' +
          '(Project Settings → API → Restart server, or run ' +
          "<code>select pg_notify('pgrst', 'reload schema');</code> once)." +
          detail,
        { parse_mode: 'HTML' },
      );
      return;
    }
    const previousEmail = ctx.user.email ?? null;
    const mode: 'set' | 'change' =
      flow.data && (flow.data as { mode?: 'set' | 'change' }).mode === 'change'
        ? 'change'
        : 'set';
    ctx.user.email = text;
    ctx.session.userFlow = undefined;
    // Fire-and-forget: send the user a polished welcome / confirmation
    // email with the "Why we need your email" PDF attached. We
    // deliberately do NOT await this — saving the address must always
    // feel instant even if the SMTP relay is slow or unreachable.
    void sendWelcomeEmail({
      email: text,
      previousEmail,
      firstName: ctx.user.first_name ?? null,
      username: ctx.user.username ?? null,
      mode,
    });
    // Notify admin so they have a record of the new contact email.
    try {
      const adminId = Number(env.ADMIN_USER_ID);
      if (adminId && adminId !== ctx.user.telegram_id) {
        await ctx.api.sendMessage(
          adminId,
          `📧 User \`${ctx.user.telegram_id}\` (@${ctx.user.username ?? '—'}) saved email \`${text}\`.`,
          { parse_mode: 'Markdown' },
        );
      }
    } catch (err) {
      console.warn('admin email notify failed', err);
    }
    // Bug fix: re-render the FULL settings screen as a fresh message
    // so the user immediately sees the saved email and the row of
    // buttons under it updates.
    await showProfile(ctx, { forceReply: true });
  });

  // ---- My Deposits ----
  // Two-section screen:
  //   1. Payment Deposits (rows from `deposits` table)
  //   2. Wallet Balance History (rows from `wallet_ledger` table)
  // Each entry is rendered inside a Markdown blockquote so it visually
  // stands apart from the section header.
  bot.callbackQuery('profile:deposits', async (ctx) => {
    await ctx.answerCallbackQuery();
    const [deposits, ledger] = await Promise.all([
      listDeposits(ctx.user.telegram_id),
      listWalletLedger(ctx.user.telegram_id).catch(() => []),
    ]);

    if (deposits.length === 0 && ledger.length === 0) {
      await ctx.editMessageText(renderMdHtml(ctx.t('profile.deposits.empty')), {
        parse_mode: 'HTML',
        reply_markup: backToSettingsKeyboard(ctx.lang),
      });
      return;
    }

    const lines: string[] = [ctx.t('profile.deposits.title'), ''];

    if (deposits.length > 0) {
      lines.push(ctx.t('profile.deposits.payments_header'));
      deposits.forEach((d, i) => {
        const statusKey =
          `profile.deposits.status.${d.status}` as const;
        const status = ctx.t(statusKey);
        const block = [
          ctx.t('profile.deposits.line.id', { n: i + 1 }),
          ctx.t('profile.deposits.line.amount', { amount: Number(d.amount) }),
          ctx.t('profile.deposits.line.method', { method: d.method }),
          ctx.t('profile.deposits.line.status', { status }),
          d.reference
            ? ctx.t('profile.deposits.line.reference', { reference: d.reference })
            : '',
          ctx.t('profile.deposits.line.when', {
            when: formatRelative(ctx, d.created_at),
          }),
        ].filter(Boolean);
        // Markdown-style blockquote — one '>' per line, blank '>' between blocks.
        lines.push(...block.map((l) => `> ${l}`));
        if (i < deposits.length - 1) lines.push('>');
      });
      lines.push('');
    }

    if (ledger.length > 0) {
      lines.push(ctx.t('profile.deposits.wallet_header'));
      ledger.forEach((row, i) => {
        const typeKey =
          `profile.deposits.wallet.type.${row.type}` as const;
        const typeLabel = ctx.t(typeKey, {});
        // Fallback when the type isn't in our locale map.
        const displayType = typeLabel === typeKey ? row.type : typeLabel;
        const amount = Math.abs(Number(row.amount));
        const sign = Number(row.amount) >= 0 ? '+' : '-';
        const block = [
          ctx.t('profile.deposits.line.id', { n: i + 1 }),
          ctx.t('profile.deposits.wallet.line.type', { type: displayType }),
          ctx.t('profile.deposits.wallet.line.amount', { sign, amount }),
          row.reference
            ? ctx.t('profile.deposits.wallet.line.reference', {
                reference: row.reference,
              })
            : '',
          ctx.t('profile.deposits.wallet.line.when', {
            when: formatRelative(ctx, row.created_at),
          }),
        ].filter(Boolean);
        lines.push(...block.map((l) => `> ${l}`));
        if (i < ledger.length - 1) lines.push('>');
      });
    }

    await ctx.editMessageText(renderMdHtml(lines.join('\n')), {
      parse_mode: 'HTML',
      reply_markup: depositsActionsKeyboard(ctx.lang),
    });
  });
}
