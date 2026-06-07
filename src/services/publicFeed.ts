import type { Api } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { renderMdHtml } from './premium.js';
import { getEmoji } from './settings.js';

const FEED_CHAT = '@TigerStockChat';

type FeedButton = {
  text: string;
  url: string;
  iconKey: string;
};

function botUrl(payload: string): string {
  return env.BOT_USERNAME ? `https://t.me/${env.BOT_USERNAME}?start=${payload}` : 'https://t.me/';
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

async function send(api: Api, body: string, button: FeedButton): Promise<void> {
  const kb = new InlineKeyboard().url(button.text, button.url);
  const iconId = premiumIconId(button.iconKey);
  if (iconId) kb.icon(iconId);
  kb.style('primary');
  try {
    await api.sendMessage(FEED_CHAT, renderMdHtml(body), {
      parse_mode: 'HTML',
      reply_markup: kb,
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    logger.warn({ err, chat: FEED_CHAT }, 'publicFeed send failed');
  }
}

export async function notifyActiveReferral(api: Api, args: {
  referrerName: string;
  totalReferrals: number;
  totalEarned: number;
}): Promise<void> {
  const remaining = Math.max(0, 10 - (args.totalReferrals % 10 || 10));
  const body = [
    '> {feed_title} *New Active Referral!*',
    '>',
    `> {refer_user} *Referrer:* ${args.referrerName}`,
    `> {refer_active} *Active Referrals:* ${args.totalReferrals}`,
    `> {refer_coin} *Total earned from invites:* $${money(args.totalEarned)}`,
    remaining === 0
      ? '> {feed_title} *Reward milestone unlocked!*'
      : `> {refer_left} *${remaining} more to earn $0.50*`,
  ].join('\n');
  await send(api, body, {
    text: 'Refer & Earn',
    iconKey: 'refer_title',
    url: botUrl('refer'),
  });
}

export async function notifyReferralAchievement(api: Api, args: {
  userId: number;
  amount: number;
}): Promise<void> {
  const body = [
    '> {feed_title} *New Achievement*',
    '>',
    `> {refer_user} *User:* ${maskId(args.userId)}`,
    `> {refer_coin} *Unlock:* ${money(args.amount)}$`,
    '> {refer_title} *Keep Inviting More To Earn More!*',
  ].join('\n');
  await send(api, body, {
    text: 'Refer & Earn',
    iconKey: 'refer_title',
    url: botUrl('refer'),
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
  const body = [
    '> {feed_title} *New Purchase!*',
    '>',
    `> {broadcast_shop_now} *Service:* ${args.productName}`,
    `> {refer_user} *By:* ${maskId(args.buyerId)}`,
    `> {broadcast_shop_now} *Plan:* ${args.productName} [${args.paidVia}]`,
    `> {orders_title} *Order No.:* ${args.orderPublicId}`,
    `> {prod_qty_selected} *QTY:* ${args.qty}`,
    `> {prod_total_amount} *Total Paid:* ${money(args.total)} USDT`,
  ].join('\n');
  await send(api, body, {
    text: 'View Product',
    iconKey: 'broadcast_shop_now',
    url: botUrl(`prod_${args.productId}`),
  });
}

export async function notifyTopup(api: Api, args: {
  userId: number;
  amount: number;
  method: string;
}): Promise<void> {
  const body = [
    '> {feed_title} *New Topup*',
    '>',
    `> {refer_user} *User:* ${maskId(args.userId)}`,
    `> {gift_usdt} *Amount:* ${money(args.amount)} USDT`,
    `> {paymethod_others} *Method:* ${args.method}`,
  ].join('\n');
  await send(api, body, {
    text: 'Top-Up Wallet',
    iconKey: 'deposits_wallet',
    url: botUrl('topup'),
  });
}

export async function notifyWalletCredit(api: Api, args: {
  userId: number;
  amount: number;
  balanceAfter: number;
  reason: string;
}): Promise<void> {
  const body = [
    '> {feed_title} *New Wallet Credit*',
    '>',
    `> {refer_user} *User:* ${maskId(args.userId)}`,
    `> {gift_usdt} *Amount:* +${money(args.amount)} USDT`,
    `> {prod_wallet} *Balance:* ${money(args.balanceAfter)} USDT`,
    `> {orders_note} *Reason:* ${args.reason}`,
  ].join('\n');
  await send(api, body, {
    text: 'Open Settings',
    iconKey: 'profile_header',
    url: botUrl('settings'),
  });
}
