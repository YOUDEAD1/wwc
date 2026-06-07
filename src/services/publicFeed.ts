import type { Api } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { renderMdHtml } from './premium.js';

const FEED_CHAT = '@TigerStockChat';

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

async function send(api: Api, body: string, buttonText: string, url: string): Promise<void> {
  const kb = new InlineKeyboard().url(buttonText, url);
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
    '> 📝 *New Active Referral!*',
    '>',
    `> 📝 *Referrer:* ${args.referrerName}`,
    `> 📝 *Active Referrals:* ${args.totalReferrals}`,
    `> 📝 *Total earned from invites:* $${money(args.totalEarned)}`,
    remaining === 0
      ? '> 📝 *Reward milestone unlocked!*'
      : `> 📝 *${remaining} more to earn $0.50*`,
  ].join('\n');
  await send(api, body, '🎁 Refer & Earn', botUrl('refer'));
}

export async function notifyReferralAchievement(api: Api, args: {
  userId: number;
  amount: number;
}): Promise<void> {
  const body = [
    '> 🎉 *New Achievement*',
    '>',
    `> 👤 *User:* ${maskId(args.userId)}`,
    `> 💰 *Unlock:* ${money(args.amount)}$`,
    '> 👥 *Keep Inviting More To Earn More!*',
  ].join('\n');
  await send(api, body, '🎁 Refer & Earn', botUrl('refer'));
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
    '> 🎉 *New Purchase!*',
    '>',
    `> 🛍️ *Service:* ${args.productName}`,
    `> 👤 *By:* ${maskId(args.buyerId)}`,
    `> 🛍️ *Plan:* ${args.productName} [${args.paidVia}]`,
    `> 🔖 *Order No.:* ${args.orderPublicId}`,
    `> 🔢 *QTY:* ${args.qty}`,
    `> 📈 *Total Paid:* ${money(args.total)} USDT`,
  ].join('\n');
  await send(api, body, '🛍️ View Product', botUrl(`prod_${args.productId}`));
}

export async function notifyTopup(api: Api, args: {
  userId: number;
  amount: number;
  method: string;
}): Promise<void> {
  const body = [
    '> 🎉 *New Topup*',
    '>',
    `> 👤 *User:* ${maskId(args.userId)}`,
    `> 💵 *Amount:* ${money(args.amount)} USDT`,
    `> 💳 *Method:* ${args.method}`,
  ].join('\n');
  await send(api, body, '💳 Top-Up Wallet', botUrl('topup'));
}

export async function notifyWalletCredit(api: Api, args: {
  userId: number;
  amount: number;
  balanceAfter: number;
  reason: string;
}): Promise<void> {
  const body = [
    '> 🎉 *New Wallet Credit*',
    '>',
    `> 👤 *User:* ${maskId(args.userId)}`,
    `> 💵 *Amount:* +${money(args.amount)} USDT`,
    `> 💳 *Balance:* ${money(args.balanceAfter)} USDT`,
    `> 📝 *Reason:* ${args.reason}`,
  ].join('\n');
  await send(api, body, '⚙️ Open Settings', botUrl('settings'));
}
