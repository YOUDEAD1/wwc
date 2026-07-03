import type { Api } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { getProduct } from '../db/queries.js';
import {
  escapeAttr,
  renderHtmlTemplate,
  renderMdHtml,
  stripCustomEmojiTags,
} from './premium.js';
import {
  getEmoji,
  getPublicFeedChatIdOverride,
  getPublicFeedTpl,
  isPublicFeedEnabled,
  getReferralCost,
  getReferralAmount,
} from './settings.js';

type FeedButton = {
  text: string;
  url: string;
  iconKey: string;
};

const CART_FALLBACK = '\u{1F6D2}';
const TIGER_STOCK_CHAT = '@TigerStockChat';

export function publicFeedBotUrl(payload: string): string {
  const username = env.BOT_USERNAME.replace(/^@+/, '').trim();
  const start = encodeURIComponent(payload);
  return username ? `https://t.me/${username}?start=${start}` : `https://t.me/?start=${start}`;
}

export function publicFeedChatId(): number | string {
  const override = getPublicFeedChatIdOverride();
  if (override !== null) {
    if (/^-?\d+$/.test(override)) return Number(override);
    return override;
  }

  const custom = env.PUBLIC_FEED_CHAT_ID;
  if (custom === undefined) return '';
  if (custom === '') {
    if (process.env.IS_TENANT === 'true') return '';
    return TIGER_STOCK_CHAT;
  }
  return custom;
}

function maskId(id: number): string {
  const s = String(id);
  if (s.length <= 5) return s;
  return `${s.slice(0, 3)}***${s.slice(-2)}`;
}

function money(amount: number): string {
  return Number(amount).toFixed(amount % 1 === 0 ? 0 : 2);
}

function premiumIconId(key: string): string | undefined {
  const spec = getEmoji(key);
  return typeof spec === 'object' && spec.custom_emoji_id ? spec.custom_emoji_id : undefined;
}

function feedKeyboard(button?: FeedButton): InlineKeyboard | undefined {
  if (!button) return undefined;
  const kb = new InlineKeyboard().url(button.text, button.url);
  const iconId = premiumIconId(button.iconKey);
  if (iconId) kb.icon(iconId);
  kb.style('primary');
  return kb;
}

async function sendRenderedHtml(api: Api, html: string, button?: FeedButton): Promise<void> {
  const chat = publicFeedChatId();
  if (!chat) return;
  const reply_markup = feedKeyboard(button);
  try {
    await api.sendMessage(chat, html, {
      parse_mode: 'HTML',
      ...(reply_markup ? { reply_markup } : {}),
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    logger.warn({ err, chat }, 'publicFeed HTML send failed; retrying without custom emoji tags');
    try {
      await api.sendMessage(chat, stripCustomEmojiTags(html), {
        parse_mode: 'HTML',
        ...(reply_markup ? { reply_markup } : {}),
        link_preview_options: { is_disabled: true },
      });
    } catch (retryErr) {
      logger.warn({ err: retryErr, chat }, 'publicFeed send failed');
    }
  }
}

export async function notifyActiveReferral(api: Api, _args: {
  referrerName: string;
  totalReferrals: number;
  activeReferrals?: number;
  totalEarned: number;
}): Promise<void> {
  if (!isPublicFeedEnabled('referral')) return;

  const cost = getReferralCost();
  const amount = getReferralAmount();
  const reward = cost > 0 ? (amount / cost).toFixed(2) : '0.00';
  const referral_count = _args.activeReferrals ?? _args.totalReferrals;

  // Format using the template
  const rawTpl = getPublicFeedTpl('referral');
  const body = rawTpl
    .replace(/{masked_user}/g, escapeAttr(_args.referrerName))
    .replace(/{reward}/g, escapeAttr(reward))
    .replace(/{referral_count}/g, String(referral_count));

  const html = `<blockquote>\n${body}\n</blockquote>`;
  await sendRenderedHtml(api, renderHtmlTemplate(html), {
    text: 'Refer & Earn',
    iconKey: 'refer_title',
    url: publicFeedBotUrl('refer'),
  });
}

export async function notifyReferralAchievement(api: Api, args: {
  userId: number;
  amount: number;
}): Promise<void> {
  if (!isPublicFeedEnabled('referral')) return;
  const body = [
    '<blockquote>',
    '{feed_title} <b>New Achievement!</b>',
    '',
    `{refer_user} <b>User:</b> <b>${maskId(args.userId)}</b>`,
    `{refer_coin} <b>Unlock:</b> <b>$${money(args.amount)}</b>`,
    '{refer_title} <b>Keep Inviting More To Earn More!</b>',
    '</blockquote>',
  ].join('\n');
  await sendRenderedHtml(api, renderHtmlTemplate(body), {
    text: 'Refer & Earn',
    iconKey: 'refer_title',
    url: publicFeedBotUrl('refer'),
  });
}

export async function notifyPurchase(api: Api, args: {
  buyerId: number;
  productId: number;
  productName: string;
  orderPublicId: string;
  qty: number;
  total: number;
  paidVia: string;
}): Promise<void> {
  if (!isPublicFeedEnabled('purchase')) return;

  const { getUserOrderSummary } = await import('../db/queries.js');
  const summary = await getUserOrderSummary(args.buyerId).catch(() => ({ orders: 0 }));
  const total_orders = summary.orders;

  const rawTpl = getPublicFeedTpl('purchase');
  const body = rawTpl
    .replace(/{product_name}/g, escapeAttr(args.productName))
    .replace(/{masked_user}/g, maskId(args.buyerId))
    .replace(/{plan_name}/g, escapeAttr(args.productName + ' [' + args.paidVia + ']'))
    .replace(/{order_id}/g, escapeAttr(args.orderPublicId))
    .replace(/{quantity}/g, String(args.qty))
    .replace(/{total_orders}/g, String(total_orders));

  const html = `<blockquote>\n${body}\n</blockquote>`;
  await sendRenderedHtml(api, renderHtmlTemplate(html), {
    text: 'View Product',
    iconKey: 'feed_buy_button',
    url: publicFeedBotUrl(`prod_${args.productId}`),
  });
}

export async function notifyTopup(api: Api, args: {
  userId: number;
  amount: number;
  method: string;
}): Promise<void> {
  if (!isPublicFeedEnabled('topup')) return;

  const { getUserStats } = await import('../db/queries.js');
  const stats = await getUserStats(args.userId).catch(() => ({ deposits: 0 }));
  const total_deposits = stats.deposits;

  const rawTpl = getPublicFeedTpl('topup');
  const body = rawTpl
    .replace(/{masked_user}/g, maskId(args.userId))
    .replace(/{amount}/g, money(args.amount) + ' USDT')
    .replace(/{payment_method}/g, escapeAttr(args.method))
    .replace(/{total_deposits}/g, money(total_deposits) + ' USDT');

  const html = `<blockquote>\n${body}\n</blockquote>`;
  await sendRenderedHtml(api, renderHtmlTemplate(html), {
    text: 'Top-Up Wallet',
    iconKey: 'deposits_wallet',
    url: publicFeedBotUrl('topup'),
  });
}

export async function notifyWalletCredit(api: Api, args: {
  userId: number;
  amount: number;
  balanceAfter: number;
  reason: string;
}): Promise<void> {
  const html = renderHtmlTemplate([
    '<blockquote>',
    '{feed_title} <b>New Admin Wallet Credit!</b>',
    '',
    `{refer_user} <b>User:</b> <b>${maskId(args.userId)}</b>`,
    `{gift_usdt} <b>Amount:</b> <b>+${money(args.amount)} USDT</b>`,
    `{prod_wallet} <b>Wallet Balance:</b> <b>${money(args.balanceAfter)} USDT</b>`,
    `{orders_note} <b>Reason:</b> <b>${escapeAttr(args.reason)}</b>`,
    '</blockquote>',
  ].join('\n'));
  await sendRenderedHtml(api, html, {
    text: 'Open Wallet',
    iconKey: 'profile_header',
    url: publicFeedBotUrl('settings'),
  });
}

export async function notifyAnnouncement(api: Api, args: {
  text: string;
  format: 'md' | 'html';
  button?: { text: string; productId: number; iconKey?: string };
}): Promise<void> {
  const html =
    args.format === 'html'
      ? renderHtmlTemplate(args.text)
      : renderMdHtml(args.text);
  await sendRenderedHtml(
    api,
    html,
    args.button
      ? {
          text: args.button.text.slice(0, 64),
          iconKey: args.button.iconKey ?? 'broadcast_shop_now',
          url: publicFeedBotUrl(`prod_${args.button.productId}`),
        }
      : undefined,
  );
}

export async function notifyStockAdded(api: Api, args: {
  productId: number;
  productName: string;
  productEmoji?: string | null;
  productEmojiId?: string | null;
  qtyAdded: number;
  available: number;
  price: number;
}): Promise<void> {
  if (!isPublicFeedEnabled('stock')) return;

  const rawTpl = getPublicFeedTpl('stock');
  const body = rawTpl
    .replace(/{product_name}/g, escapeAttr(args.productName))
    .replace(/{added_count}/g, String(args.qtyAdded))
    .replace(/{stock}/g, String(args.available))
    .replace(/{price}/g, money(args.price) + ' USDT');

  const html = `<blockquote>\n${body}\n</blockquote>`;
  await sendRenderedHtml(api, renderHtmlTemplate(html), {
    text: `Buy ${args.productName}`.slice(0, 64),
    iconKey: 'feed_buy_button',
    url: publicFeedBotUrl(`prod_${args.productId}`),
  });
}
