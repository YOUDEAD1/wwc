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
  listAllProducts,
  listActivePromos,
  listDeposits,
  listOrders,
  listOrdersPaginated,
  listWalletLedger,
  recordGiftCodeRedemption,
  recordLedger,
  setUserEmail,
  setUserLanguage,
  setUserRegion,
  toggleEmailReports,
  toggleNotification,
} from '../db/queries.js';
import {
  profileKeyboard,
  notificationsKeyboard,
  languageKeyboard,
  statsKeyboard,
  backToSettingsKeyboard,
  botTutorialKeyboard,
  depositsActionsKeyboard,
  emailDeleteConfirmKeyboard,
  emailHubKeyboard,
  emailScreenKeyboard,
  priceListKeyboard,
  referKeyboard,
  whyEmailKeyboard,
} from '../keyboards/profile.js';
import { regionPickerKeyboard } from '../keyboards/region.js';
import { ordersListKeyboard, orderDetailKeyboard, ORDERS_PER_PAGE } from '../keyboards/orders.js';
import { redeemKeyboard } from '../keyboards/redeem.js';
import { publicOrderId, parsePublicOrderId } from '../services/orderId.js';
import { buildOrderDetailReceivedBlock } from '../services/orderRender.js';
import type { AppCtx } from '../middleware/user.js';
import { env } from '../env.js';
import {
  clampForTelegram,
  escapeAttr,
  htmlToPlain,
  renderMdHtml,
  renderPremium,
  sanitizeButtonUrl,
} from '../services/premium.js';
import {
  type ReportKind,
  sendWelcomeEmail,
  sendReportEmail,
  sendInvoiceEmail,
  sendPriceListEmail,
} from '../services/mailer.js';

import {
  buildOrdersPdf,
  buildDepositsPdf,
  buildStatsPdf,
  buildPriceListPdf,
} from '../services/pdfReport.js';
import {
  buildOrdersCsv,
  buildDepositsCsv,
  buildPriceListCsv,
  buildStatsCsv,
} from '../services/csvReport.js';
import { logger } from '../logger.js';
import {
  getEmailPdfUrl,
  getAdminContactUrlWithPrefill,
  getBotTutorial,
} from '../services/settings.js';
import * as adminLog from '../services/adminLog.js';
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
 * Schedule deletion of a chat message after `EMAIL_AUTODELETE_MS`
 * has elapsed. Used for "✅ Sent to your email" / mail-sent
 * confirmations the bot owner asked us to auto-clean from chat
 * history. Deletion errors are swallowed because Telegram throws
 * "message can't be deleted" for messages older than 48h or already
 * removed by the user.
 */
const EMAIL_AUTODELETE_MS = 5_000;
function autoDeleteMessage(ctx: AppCtx, message_id: number): void {
  setTimeout(() => {
    void ctx.api.deleteMessage(ctx.chat!.id, message_id).catch(() => {
      // Silent — user may have closed the chat or the message is gone
    });
  }, EMAIL_AUTODELETE_MS);
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
      // Email Reports is stored as the inverse of `email_nag_disabled`
      // so the rest of the toggle UX (false = OFF, true = ON) matches.
      email_reports: !(ctx.user.email_nag_disabled ?? false),
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

  // Find by Order ID — surface the typed-input flow that was
  // previously only documented inline. Tapping the button arms the
  // `orders_lookup` flow and posts a prompt so the next plain text
  // message the user sends is parsed as a public Order ID.
  bot.callbackQuery('profile:orders:find', async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.userFlow = { type: 'orders_lookup', step: 'value', data: {} };
    await ctx.reply(renderMdHtml(ctx.t('orders.lookup.prompt')), {
      parse_mode: 'HTML',
    });
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
    // Prefer the actual claimed delivered_items pool (one per line)
    // so each entry renders as its own quoted pill ("> #N\n> Open
    // Link #N"). Falls back to the legacy single-line `delivery`
    // text for orders predating the per-item pool.
    //
    // For bulk orders the renderer truncates the inline preview at a
    // safe Telegram-message budget and surfaces an `attach` payload
    // we ship as a `.txt` document right after the edited card, so
    // tapping a 37-link order in /myorders never fails on the 4096-
    // char limit.
    const itemsRender = buildOrderDetailReceivedBlock(order.delivered_items, {
      filename: `order-${pubId}-items.txt`,
    });
    if (itemsRender.inlineBlock) {
      lines.push(
        '',
        ctx.t('orders.detail.received', { received: itemsRender.inlineBlock }),
      );
    } else if (order.delivery) {
      const urlMatch = order.delivery.match(/https?:\/\/\S+/);
      const deliveryText = urlMatch ? urlMatch[0] : order.delivery;
      lines.push('', ctx.t('orders.detail.received', { received: deliveryText }));
    }
    const html = clampForTelegram(renderMdHtml(lines.join('\n')));
    const openUrl = order.delivery?.match(/https?:\/\/\S+/)?.[0] ?? null;
    const reply_markup = orderDetailKeyboard(ctx.lang, openUrl);
    try {
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
    } catch (err) {
      // Belt-and-suspenders: if the rendered HTML still trips
      // Telegram (malformed entity, message_id stale, etc.), drop
      // the formatting and re-send so the user always sees their
      // order instead of a broken edit.
      logger.warn(
        { err, orderId, htmlLen: html.length },
        'profile: order detail render failed — falling back to plain reply',
      );
      try {
        await ctx.reply(htmlToPlain(html), {
          reply_markup,
          link_preview_options: { is_disabled: true },
        });
      } catch (fallbackErr) {
        logger.warn(
          { err: fallbackErr, orderId },
          'profile: order detail plain-text fallback also failed',
        );
      }
    }
    if (itemsRender.attach) {
      try {
        await ctx.replyWithDocument(
          new InputFile(
            Buffer.from(itemsRender.attach.contents, 'utf8'),
            itemsRender.attach.filename,
          ),
          { caption: `📎 Order #${pubId} — full items list` },
        );
      } catch (err) {
        logger.warn(
          { err, orderId },
          'profile: order detail .txt attachment failed',
        );
      }
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
      await ctx.reply(renderMdHtml(ctx.t('orders.lookup.invalid')), {
        parse_mode: 'HTML',
      });
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
      reply_markup: redeemKeyboard(
        ctx.lang,
        getAdminContactUrlWithPrefill(
          'Hi sir i wanna buy gift coupon code money: ',
        ),
      ),
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
    void adminLog.logGiftRedeem(ctx.api, {
      user: {
        telegram_id: ctx.user.telegram_id,
        username: ctx.user.username ?? null,
        first_name: ctx.user.first_name ?? null,
        email: ctx.user.email ?? null,
      },
      code,
      amount,
      balanceAfter: Number(newBalance.toFixed(3)),
    });
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
      void adminLog.logNotificationToggle(ctx.api, {
        user: {
          telegram_id: ctx.user.telegram_id,
          username: ctx.user.username ?? null,
          first_name: ctx.user.first_name ?? null,
          email: ctx.user.email ?? null,
        },
        channel: 'stock',
        enabled: next,
      });
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
      void adminLog.logNotificationToggle(ctx.api, {
        user: {
          telegram_id: ctx.user.telegram_id,
          username: ctx.user.username ?? null,
          first_name: ctx.user.first_name ?? null,
          email: ctx.user.email ?? null,
        },
        channel: 'announcements',
        enabled: next,
      });
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
      void adminLog.logNotificationToggle(ctx.api, {
        user: {
          telegram_id: ctx.user.telegram_id,
          username: ctx.user.username ?? null,
          first_name: ctx.user.first_name ?? null,
          email: ctx.user.email ?? null,
        },
        channel: 'wallet',
        enabled: next,
      });
    } catch {
      await ctx.answerCallbackQuery({
        text: ctx.t('profile.notify.error'),
        show_alert: true,
      });
    }
  });


  // ---------------------------------------------------------------
  //  Bot Tutorial (Settings → Bot Tutorial)
  //  Renders the admin-editable tutorial page (text + optional
  //  photo / video / document attachment + optional URL button).
  // ---------------------------------------------------------------
  bot.callbackQuery('profile:tutorial', async (ctx) => {
    // Always ack first so Telegram never shows a perpetual spinner
    // even if the body below throws.
    await ctx.answerCallbackQuery();
    let stage = 'load_settings';
    try {
      const tut = getBotTutorial();
      stage = 'compose_body';
      const text = (tut.text ?? '').trim();
      const titleLine = ctx.t('profile.bot_tutorial.title');
      const body =
        text.length > 0
          ? `${titleLine}\n\n${ctx.t('profile.bot_tutorial.body', { body: text })}`
          : `${titleLine}\n\n${ctx.t('profile.bot_tutorial.empty')}`;
      stage = 'build_keyboard';
      const safeUrl = sanitizeButtonUrl(tut.url);
      const kb = botTutorialKeyboard(ctx.lang, safeUrl);
      stage = 'render_html';
      const html = renderMdHtml(body);
      const safeHtml = clampForTelegram(html);
      logger.info(
        {
          hasText: text.length > 0,
          hasFile: Boolean(tut.file_id && tut.file_type),
          fileType: tut.file_type ?? null,
          hasUrl: Boolean(safeUrl),
          rejectedUrl: tut.url && !safeUrl ? tut.url : null,
          htmlLen: safeHtml.length,
        },
        'profile:tutorial — rendering Bot Tutorial',
      );
      // Bot-owner spec: the tutorial should NOT arrive as a fresh
      // message below Settings — it should *replace* the Settings
      // page in-place, so tapping Bot Tutorial converts the open
      // Settings card into the tutorial card without cluttering
      // the chat. The Back button on the tutorial keyboard already
      // routes back to `profile:open`, which itself uses
      // `editMessageText`, so the round-trip stays on a single
      // message bubble.
      //
      // Telegram doesn't let us turn a text-only message into a
      // media one, so when the admin has uploaded a tutorial
      // photo / video / document we still send the *file* as a
      // follow-up — but the actual instruction card is edited in
      // place, removing the duplicate text page the bot owner
      // flagged.
      stage = 'edit_html';
      try {
        await ctx.editMessageText(safeHtml, {
          parse_mode: 'HTML',
          reply_markup: kb,
          link_preview_options: { is_disabled: true },
        });
      } catch (htmlErr) {
        logger.warn(
          { err: htmlErr },
          'profile:tutorial: HTML edit failed, retrying as plain text edit',
        );
        stage = 'edit_plain';
        try {
          await ctx.editMessageText(htmlToPlain(safeHtml), {
            reply_markup: kb,
            link_preview_options: { is_disabled: true },
          });
        } catch (plainErr) {
          // Edit can hard-fail on some clients (e.g. message too
          // old, or the previous Settings render was actually a
          // media message that can't accept `editMessageText`).
          // Fall back to sending a fresh card so the user still
          // gets the tutorial — a one-off duplicate is always
          // better than a broken button.
          logger.warn(
            { err: plainErr },
            'profile:tutorial: edit failed entirely, falling back to reply',
          );
          stage = 'send_html_fallback';
          await ctx.reply(safeHtml, {
            parse_mode: 'HTML',
            reply_markup: kb,
            link_preview_options: { is_disabled: true },
          });
        }
      }
      if (tut.file_id && tut.file_type) {
        try {
          stage = 'send_file';
          if (tut.file_type === 'photo') {
            await ctx.replyWithPhoto(tut.file_id);
          } else if (tut.file_type === 'video') {
            await ctx.replyWithVideo(tut.file_id);
          } else {
            await ctx.replyWithDocument(tut.file_id);
          }
        } catch (err) {
          logger.warn({ err }, 'bot_tutorial file send failed');
        }
      }
    } catch (err) {
      logger.error({ err, stage }, 'profile:tutorial — failed to render');
      const reason = (err as Error)?.message ?? String(err);
      try {
        await ctx.reply(
          `⚠️ <b>Couldn't load the Bot Tutorial.</b>\n\n` +
            `Stage: <code>${escapeAttr(stage)}</code>\n` +
            `Reason: <code>${escapeAttr(reason).slice(0, 200)}</code>\n\n` +
            `Admin: open <code>/admin</code> → <i>Bot Tutorial → Set Text / Set File / Set URL</i> and double-check the URL (must start with <code>https://</code> and contain no spaces or newlines).`,
          { parse_mode: 'HTML' },
        );
      } catch {
        // Last-ditch: nothing else to do.
      }
    }
  });

  // ---------------------------------------------------------------
  //  Send Price List (Settings → Send Price List)
  //  Two delivery options: mail or chat.
  // ---------------------------------------------------------------
  bot.callbackQuery('profile:pricelist', async (ctx) => {
    await ctx.answerCallbackQuery();
    const text = [
      ctx.t('profile.pricelist.title'),
      '',
      ctx.t('profile.pricelist.body'),
    ].join('\n');
    await ctx.editMessageText(renderMdHtml(text), {
      parse_mode: 'HTML',
      reply_markup: priceListKeyboard(ctx.lang),
    });
  });

  // The chat path keeps the CSV (lightweight, easy to inspect on
  // mobile in any spreadsheet app); the email path now ships a PDF
  // because the bot owner explicitly asked for it.
  async function buildPriceListChatCsv(ctx: AppCtx): Promise<Buffer | null> {
    // Pull EVERY product (active + upcoming) so the user gets a real
    // catalog snapshot, not just the in-stock subset.
    const { rows } = await listAllProducts(0, 1000);
    if (rows.length === 0) return null;
    const promos = await listActivePromos();
    const promoFooter = ctx.t('profile.pricelist.promo_footer');
    return buildPriceListCsv({
      products: rows,
      promos,
      labels: {
        col_name: ctx.t('profile.pricelist.csv.col.name'),
        col_status: ctx.t('profile.pricelist.csv.col.status'),
        col_stock: ctx.t('profile.pricelist.csv.col.stock'),
        col_price: ctx.t('profile.pricelist.csv.col.price'),
        col_promo: ctx.t('profile.pricelist.csv.col.promo'),
        status_in_stock: ctx.t('profile.pricelist.csv.status.in_stock'),
        status_out_of_stock: ctx.t('profile.pricelist.csv.status.out_of_stock'),
        status_upcoming: ctx.t('profile.pricelist.csv.status.upcoming'),
        promo_none: ctx.t('profile.pricelist.csv.promo_none'),
        promo_format: (min_qty: number, discount: string) =>
          ctx.t('profile.pricelist.csv.promo_format', {
            min_qty,
            discount,
          }),
        unlimited: ctx.t('profile.pricelist.csv.unlimited'),
        promo_footer: promoFooter,
      },
    });
  }

  async function buildPriceListMailPdf(ctx: AppCtx): Promise<Buffer | null> {
    const { rows } = await listAllProducts(0, 1000);
    if (rows.length === 0) return null;
    const promos = await listActivePromos();
    const promoFooter = ctx.t('profile.pricelist.promo_footer');
    return buildPriceListPdf({
      products: rows,
      promos,
      labels: {
        reportTitle: ctx.t('profile.pricelist.pdf.title'),
        sectionTitle: ctx.t('profile.pricelist.pdf.section'),
        status_in_stock: ctx.t('profile.pricelist.csv.status.in_stock'),
        status_out_of_stock: ctx.t('profile.pricelist.csv.status.out_of_stock'),
        status_upcoming: ctx.t('profile.pricelist.csv.status.upcoming'),
        unlimited: ctx.t('profile.pricelist.csv.unlimited'),
        promo_none: ctx.t('profile.pricelist.csv.promo_none'),
        promo_format: (min_qty: number, discount: string) =>
          ctx.t('profile.pricelist.csv.promo_format', {
            min_qty,
            discount,
          }),
        promo_footer: promoFooter,
      },
    });
  }



  bot.callbackQuery('profile:pricelist:chat', async (ctx) => {
    await ctx.answerCallbackQuery({
      text: ctx.t('profile.pricelist.sending'),
      show_alert: false,
    });
    const csv = await buildPriceListChatCsv(ctx);
    if (!csv) {
      await ctx.reply(renderMdHtml(ctx.t('profile.pricelist.empty')), {
        parse_mode: 'HTML',
      });
      return;
    }
    const filename = `Homlander-Store-PriceList-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    await ctx.replyWithDocument(new InputFile(csv, filename));
    await ctx.reply(renderMdHtml(ctx.t('profile.pricelist.chat_sent')), {
      parse_mode: 'HTML',
    });
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
    const prev = ctx.user.language;
    await setUserLanguage(ctx.user.telegram_id, next);
    ctx.user.language = next;
    ctx.lang = next;
    await ctx.answerCallbackQuery();
    await showProfile(ctx);
    if (prev !== next) {
      void adminLog.logLanguageChange(ctx.api, {
        user: {
          telegram_id: ctx.user.telegram_id,
          username: ctx.user.username ?? null,
          first_name: ctx.user.first_name ?? null,
          email: ctx.user.email ?? null,
        },
        oldLang: prev,
        newLang: next,
      });
    }
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
    void adminLog.logRegion(ctx.api, {
      user: {
        telegram_id: ctx.user.telegram_id,
        username: ctx.user.username ?? null,
        first_name: ctx.user.first_name ?? null,
        email: ctx.user.email ?? null,
      },
      mode: 'set',
      region: reg.code,
      timezone: reg.timezone,
    });
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
    void adminLog.logRegion(ctx.api, {
      user: {
        telegram_id: ctx.user.telegram_id,
        username: ctx.user.username ?? null,
        first_name: ctx.user.first_name ?? null,
        email: ctx.user.email ?? null,
      },
      mode: 'clear',
      region: null,
      timezone: null,
    });
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