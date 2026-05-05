/**
 * Central "everything the admin needs to know" notification service.
 *
 * Every customer-facing action (orders, top-ups, email/region
 * changes, referrals, gift redemptions, language switches, support
 * sessions, PDF sends, etc.) routes through this module so admin
 * gets a single, consistent, parseable log feed in their DM.
 *
 * Format mirrors the deep-detail style requested by the shop owner:
 *
 *   [TAG] Event Title
 *
 *   📅 Logged At: 03 May 2026, 14:59 GMT+5:30
 *   🆔 <Resource> ID# :: ORDP8EQGT6AY
 *   Internal DB ID: 56
 *
 *   👤 User
 *   🆔 Telegram ID: 8004955979
 *   👤 User link: tg://user?id=8004955979
 *   🏷 Username: @SafwanTiger
 *
 *   <event-specific section>
 *
 * All sends are best-effort. A failed admin notification must NEVER
 * break a user-facing flow — every public function wraps its body in
 * try/catch and only logs at `warn` on failure.
 */
import type { Api, InputFile } from 'grammy';
import { env } from '../env.js';
import { logger } from '../logger.js';

/**
 * Shared user shape every event payload includes. Keep this small
 * so call sites never have to know about more than the basics.
 */
export type LogUser = {
  telegram_id: number;
  username: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

/**
 * Wall-clock formatter — IST (GMT+5:30) is the shop's home tz, so
 * matches the example log the user pasted (`03 May 2026, 14:59
 * GMT+5:30`). Kept as a constant here rather than reading env so
 * the log feed never silently shifts.
 */
const ADMIN_LOG_TZ = 'Asia/Kolkata';
const ADMIN_LOG_TZ_LABEL = 'GMT+5:30';

function formatLoggedAt(date: Date = new Date()): string {
  // 03 May 2026, 14:59
  const dt = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: ADMIN_LOG_TZ,
  })
    .format(date)
    // Intl uses ", " between date and time which is what we want.
    .replace(/,\s*/, ', ');
  return `${dt} ${ADMIN_LOG_TZ_LABEL}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function userBlock(u: LogUser): string[] {
  const lines: string[] = [];
  lines.push('👤 <b>User</b>');
  lines.push(`🆔 Telegram ID: <code>${u.telegram_id}</code>`);
  // Safer than tg://user — opens reliably in Telegram apps.
  lines.push(
    `👤 User link: <a href="tg://user?id=${u.telegram_id}">open profile</a>`,
  );
  lines.push(`🏷 Username: @${escapeHtml(u.username ?? '—')}`);
  if (u.first_name)
    lines.push(`📛 Name: ${escapeHtml(`${u.first_name}${u.last_name ? ' ' + u.last_name : ''}`)}`);
  if (u.email) lines.push(`📧 Email: <code>${escapeHtml(u.email)}</code>`);
  return lines;
}

/**
 * Compose the canonical [TAG]-prefixed admin log block. `headerLines`
 * is the per-event block above the user section (Tag, ID, Internal
 * DB ID, etc.); `bodyLines` is the per-event block below it.
 */
function compose(args: {
  tag: string;
  title: string;
  headerLines?: string[];
  user: LogUser;
  bodyLines?: string[];
}): string {
  const { tag, title, headerLines = [], user, bodyLines = [] } = args;
  const out: string[] = [];
  out.push(`<b>[${tag}]</b> ${escapeHtml(title)}`);
  out.push('');
  out.push(`Tag: <code>${tag}</code>`);
  out.push(`📅 Logged At: ${formatLoggedAt()}`);
  for (const l of headerLines) out.push(l);
  out.push('');
  out.push(...userBlock(user));
  if (bodyLines.length > 0) {
    out.push('');
    out.push(...bodyLines);
  }
  return out.join('\n');
}

/**
 * Routing channels for the deep-detail log feed.
 *
 * - `main`   → `LOG_CHAT_ID`        (everything except orders)
 * - `orders` → `ORDER_LOG_CHAT_ID`  (only `logOrderCreated`)
 *
 * Either env var may be opt-out (resolved to `undefined` by the env
 * schema), in which case we walk the fallback chain in
 * `chatChain()` to pick the next-best destination — orders fall
 * through to the main channel, and the main channel falls through
 * to the admin DM. That ensures deep-detail notifications never
 * silently disappear even if a channel is mis-configured.
 */
type LogChannel = 'main' | 'orders';

type ChatId = number | string;

function chatChain(channel: LogChannel): ChatId[] {
  const seen = new Set<ChatId>();
  const chain: ChatId[] = [];
  const push = (chat: ChatId | undefined): void => {
    if (chat === undefined) return;
    if (seen.has(chat)) return;
    seen.add(chat);
    chain.push(chat);
  };
  if (channel === 'orders') {
    push(env.ORDER_LOG_CHAT_ID);
    push(env.LOG_CHAT_ID);
  } else {
    push(env.LOG_CHAT_ID);
  }
  push(env.ADMIN_USER_ID);
  return chain;
}

async function send(
  api: Api,
  body: string,
  channel: LogChannel = 'main',
): Promise<void> {
  const chain = chatChain(channel);
  for (let i = 0; i < chain.length; i++) {
    const chat = chain[i]!;
    try {
      await api.sendMessage(chat, body, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
      return;
    } catch (err) {
      logger.warn(
        { err, chat, channel, attempt: i + 1, total: chain.length },
        'adminLog: sendMessage failed',
      );
    }
  }
}

async function sendDocument(
  api: Api,
  file: InputFile,
  caption: string,
  channel: LogChannel = 'main',
): Promise<void> {
  const chain = chatChain(channel);
  for (let i = 0; i < chain.length; i++) {
    const chat = chain[i]!;
    try {
      await api.sendDocument(chat, file, {
        caption,
        parse_mode: 'HTML',
      });
      return;
    } catch (err) {
      logger.warn(
        { err, chat, channel, attempt: i + 1, total: chain.length },
        'adminLog: sendDocument failed',
      );
    }
  }
}

// ---------------------------------------------------------------------------
//  Public API — one function per event tag.
// ---------------------------------------------------------------------------

export async function logFirstStart(api: Api, args: {
  user: LogUser;
  referralCode: string | null;
  referredBy: number | null;
}): Promise<void> {
  const body = compose({
    tag: 'START',
    title: 'New User Joined',
    user: args.user,
    bodyLines: [
      `🔗 Their referral code: <code>${args.referralCode ?? '—'}</code>`,
      `🤝 Referred by: ${args.referredBy ? `<code>${args.referredBy}</code>` : '—'}`,
    ],
  });
  await send(api, body);
}

export async function logOrderCreated(api: Api, args: {
  user: LogUser;
  orderDbId: number;
  orderPublicId: string;
  productId: number;
  productName: string;
  qty: number;
  unitPrice: number;
  total: number;
  paidVia: string;
  balanceAfter: number;
}): Promise<void> {
  const body = compose({
    tag: 'ORDER',
    title: 'Order Delivered',
    user: args.user,
    headerLines: [
      `🆔 Order ID# :: <code>${args.orderPublicId}</code>`,
      `Internal DB ID: ${args.orderDbId}`,
    ],
    bodyLines: [
      '📦 <b>Order</b>',
      `🆔 Product ID: ${args.productId}`,
      `Product: ${escapeHtml(args.productName)}`,
      `🔢 Quantity: ${args.qty} unit${args.qty === 1 ? '' : 's'}`,
      `Unit Price: ${args.unitPrice} USDT`,
      `💰 Total: ${args.total} USDT`,
      `Paid Via: ${escapeHtml(args.paidVia)}`,
      '',
      '👛 <b>Wallet</b>',
      `💳 Balance After: ${args.balanceAfter} USDT`,
    ],
  });
  // Orders go to the dedicated orders channel (`ORDER_LOG_CHAT_ID`),
  // falling back to `LOG_CHAT_ID` and finally the admin DM. Every
  // other event still goes straight to `LOG_CHAT_ID`.
  await send(api, body, 'orders');
}



export async function logTopupResolved(api: Api, args: {
  user: LogUser;
  depositDbId: number;
  method: string;
  amount: number;
  status: 'approved' | 'rejected';
  balanceAfter: number | null;
  resolvedBy: number;
}): Promise<void> {
  const body = compose({
    tag: 'TOPUP',
    title: args.status === 'approved' ? 'Top-up Approved' : 'Top-up Rejected',
    user: args.user,
    headerLines: [
      `🆔 Deposit DB ID: ${args.depositDbId}`,
    ],
    bodyLines: [
      '💸 <b>Top-up</b>',
      `Method: ${escapeHtml(args.method)}`,
      `Amount: ${args.amount} USDT`,
      `Status: <b>${args.status}</b>`,
      ...(args.balanceAfter !== null
        ? ['', '👛 <b>Wallet</b>', `💳 Balance After: ${args.balanceAfter} USDT`]
        : []),
      `Resolved By Admin: <code>${args.resolvedBy}</code>`,
    ],
  });
  await send(api, body);
}

export async function logBalanceChange(api: Api, args: {
  user: LogUser;
  delta: number;
  balanceAfter: number;
  reason: string;
  by: 'admin' | 'gift_code' | 'order' | 'topup' | 'refund' | 'referral';
}): Promise<void> {
  const sign = args.delta >= 0 ? '+' : '';
  const body = compose({
    tag: 'BALANCE',
    title: args.delta >= 0 ? 'Wallet Credited' : 'Wallet Debited',
    user: args.user,
    bodyLines: [
      '👛 <b>Wallet</b>',
      `Δ Change: ${sign}${args.delta} USDT`,
      `💳 Balance After: ${args.balanceAfter} USDT`,
      `Source: ${args.by}`,
      `Reason: ${escapeHtml(args.reason)}`,
    ],
  });
  await send(api, body);
}

export async function logEmail(api: Api, args: {
  user: LogUser;
  mode: 'set' | 'change' | 'delete';
  oldEmail: string | null;
  newEmail: string | null;
}): Promise<void> {
  const body = compose({
    tag: 'EMAIL',
    title:
      args.mode === 'set'
        ? 'Email Set'
        : args.mode === 'change'
          ? 'Email Changed'
          : 'Email Deleted',
    user: args.user,
    bodyLines: [
      '📧 <b>Invoice Email</b>',
      `Mode: ${args.mode}`,
      `From: ${args.oldEmail ? `<code>${escapeHtml(args.oldEmail)}</code>` : '—'}`,
      `To: ${args.newEmail ? `<code>${escapeHtml(args.newEmail)}</code>` : '—'}`,
    ],
  });
  await send(api, body);
}

export async function logRegion(api: Api, args: {
  user: LogUser;
  mode: 'set' | 'clear';
  region: string | null;
  timezone: string | null;
}): Promise<void> {
  const body = compose({
    tag: 'REGION',
    title: args.mode === 'set' ? 'Region Set' : 'Region Cleared',
    user: args.user,
    bodyLines: [
      '🗺 <b>Region</b>',
      `Region: ${args.region ? escapeHtml(args.region) : '—'}`,
      `Timezone: ${args.timezone ? escapeHtml(args.timezone) : '—'}`,
    ],
  });
  await send(api, body);
}

export async function logRefer(api: Api, args: {
  user: LogUser;
  refCode: string;
  referralLink: string;
  totalReferrals: number;
}): Promise<void> {
  const body = compose({
    tag: 'REFER',
    title: 'Referral Link Copied / Shared',
    user: args.user,
    bodyLines: [
      '🎁 <b>Referral</b>',
      `Code: <code>${escapeHtml(args.refCode)}</code>`,
      `Link: ${escapeHtml(args.referralLink)}`,
      `Total referrals so far: ${args.totalReferrals}`,
    ],
  });
  await send(api, body);
}

export async function logGiftRedeem(api: Api, args: {
  user: LogUser;
  code: string;
  amount: number;
  balanceAfter: number;
}): Promise<void> {
  const body = compose({
    tag: 'GIFT',
    title: 'Gift Code Redeemed',
    user: args.user,
    bodyLines: [
      '🎟 <b>Gift Code</b>',
      `Code: <code>${escapeHtml(args.code)}</code>`,
      `Amount: ${args.amount} USDT`,
      '',
      '👛 <b>Wallet</b>',
      `💳 Balance After: ${args.balanceAfter} USDT`,
    ],
  });
  await send(api, body);
}

export async function logLanguageChange(api: Api, args: {
  user: LogUser;
  oldLang: string | null;
  newLang: string;
}): Promise<void> {
  const body = compose({
    tag: 'LANG',
    title: 'Language Changed',
    user: args.user,
    bodyLines: [
      `From: ${args.oldLang ?? '—'}`,
      `To: ${args.newLang}`,
    ],
  });
  await send(api, body);
}

export async function logNotificationToggle(api: Api, args: {
  user: LogUser;
  channel: 'stock' | 'announcements' | 'wallet' | 'email_reports';
  enabled: boolean;
}): Promise<void> {
  const body = compose({
    tag: 'NOTIF',
    title: `${args.enabled ? 'Enabled' : 'Disabled'} ${args.channel} notifications`,
    user: args.user,
    bodyLines: [
      `Channel: <b>${args.channel}</b>`,
      `New state: <b>${args.enabled ? 'ON' : 'OFF'}</b>`,
    ],
  });
  await send(api, body);
}

export async function logSupportStart(api: Api, args: {
  user: LogUser;
  userTopicId: number | undefined;
  adminTopicId: number | undefined;
}): Promise<void> {
  const body = compose({
    tag: 'SUPPORT',
    title: 'Live Support Started',
    user: args.user,
    bodyLines: [
      '🆘 <b>Live Support</b>',
      `User-side topic id: ${args.userTopicId ?? '—'}`,
      `Admin-side topic id: ${args.adminTopicId ?? '—'}`,
    ],
  });
  await send(api, body);
}

export async function logSupportEnd(api: Api, args: {
  user: LogUser;
  endedBy: 'user' | 'admin';
  durationSeconds: number;
  messageCount: number;
}): Promise<void> {
  const body = compose({
    tag: 'SUPPORT',
    title: `Live Support Ended (by ${args.endedBy})`,
    user: args.user,
    bodyLines: [
      '🆘 <b>Live Support</b>',
      `Duration: ${Math.floor(args.durationSeconds / 60)}m ${args.durationSeconds % 60}s`,
      `Total messages exchanged: ${args.messageCount}`,
    ],
  });
  await send(api, body);
}

export async function logPdfSent(api: Api, args: {
  user: LogUser;
  kind: 'orders' | 'deposits' | 'stats' | 'support';
  destinationEmail: string;
  rowCount: number;
}): Promise<void> {
  const body = compose({
    tag: 'PDF',
    title: `${args.kind} PDF generated & emailed`,
    user: args.user,
    bodyLines: [
      '📄 <b>PDF Report</b>',
      `Kind: <b>${args.kind}</b>`,
      `📧 Destination email: <code>${escapeHtml(args.destinationEmail)}</code>`,
      `Rows in report: ${args.rowCount}`,
    ],
  });
  await send(api, body);
}

/**
 * Notify the admin every time the Kiwi AI provider call fails so
 * the operator can spot a misconfigured key, wrong model id, hit
 * quota, etc. without needing access to Render / Railway logs. The
 * user only ever sees the short retry message — the full upstream
 * error body and provider identity stays in the admin feed.
 */
export async function logAiError(api: Api, args: {
  user: LogUser;
  provider: string;
  model: string;
  status?: number | string;
  errorMessage: string;
  question: string;
}): Promise<void> {
  const status = args.status === undefined ? '—' : String(args.status);
  const trimmedQ = args.question.length > 200
    ? args.question.slice(0, 200) + '…'
    : args.question;
  const trimmedErr = args.errorMessage.length > 800
    ? args.errorMessage.slice(0, 800) + '…'
    : args.errorMessage;
  const body = compose({
    tag: 'AI',
    title: 'Kiwi AI provider call failed',
    user: args.user,
    bodyLines: [
      '🤖 <b>AI Failure</b>',
      `Provider: <code>${escapeHtml(args.provider)}</code>`,
      `Model: <code>${escapeHtml(args.model)}</code>`,
      `Status: <code>${escapeHtml(status)}</code>`,
      `Question: ${escapeHtml(trimmedQ)}`,
      `Error: <code>${escapeHtml(trimmedErr)}</code>`,
    ],
  });
  await send(api, body);
}

export async function logSupportTranscript(api: Api, args: {
  user: LogUser;
  durationSeconds: number;
  messageCount: number;
  pdf: InputFile;
}): Promise<void> {
  const caption = compose({
    tag: 'SUPPORT',
    title: 'Live Support — Full Transcript (PDF)',
    user: args.user,
    bodyLines: [
      '📄 <b>Transcript</b>',
      `Duration: ${Math.floor(args.durationSeconds / 60)}m ${args.durationSeconds % 60}s`,
      `Total messages: ${args.messageCount}`,
    ],
  });
  await sendDocument(api, args.pdf, caption);
}
