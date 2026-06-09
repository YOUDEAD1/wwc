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
import { getEmoji } from './settings.js';

type FeedButton = {
  text: string;
  url: string;
  iconKey: string;
};

const CART_FALLBACK = '\u{1F6D2}';

export function publicFeedBotUrl(payload: string): string {
  return env.BOT_USERNAME ? `https://t.me/${env.BOT_USERNAME}?start=${payload}` : 'https://t.me/';
}

export function publicFeedChatId(): string | number | undefined {
  return env.PUBLIC_FEED_CHAT_ID;
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

async function send(api: Api, body: string, button?: FeedButton): Promise<void> {
  await sendRenderedHtml(api, renderMdHtml(body), button);
}

export async function notifyActiveReferral(api: Api, args: {
  referrerName: string;
  totalReferrals: number;
  activeReferrals?: number;
  totalEarned: number;
}): Promise<void> {
  const activeReferrals = args.activeReferrals ?? args.totalReferrals;
  const remaining =
    activeReferrals > 0 && activeReferrals % 10 === 0
      ? 0
      : 10 - (activeReferrals % 10);
  const body = [
    '> {feed_title} *New Active Referral!*',
    '>',
    `> {refer_user} *Referrer:* ${args.referrerName}`,
    `> {refer_active} *Active Referrals:* ${activeReferrals}`,
    `> {refer_coin} *Total earned from invites:* $${money(args.totalEarned)}`,
    remaining === 0
      ? '> {feed_title} *Reward milestone unlocked!*'
      : `> {refer_left} *${remaining} more to earn $0.50*`,
  ].join('\n');
  await send(api, body, {
    text: 'Refer & Earn',
    iconKey: 'refer_title',
    url: publicFeedBotUrl('refer'),
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
  const product = await getProduct(args.productId).catch(() => null);
  const glyph = product?.emoji?.trim() ?? '';
  const productIcon =
    product?.emoji_id
      ? `<tg-emoji emoji-id="${escapeAttr(product.emoji_id)}">${escapeAttr(glyph || CART_FALLBACK)}</tg-emoji> `
      : glyph && glyph !== CART_FALLBACK
        ? `${escapeAttr(glyph)} `
        : '';
  const name = escapeAttr(args.productName);
  const html = renderHtmlTemplate(
    `{broadcast_shop_now} <b>Someone just bought (${args.qty}&times; ${productIcon}${name})</b>`,
  );
  await sendRenderedHtml(api, html);
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
    url: publicFeedBotUrl('topup'),
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
  const glyph = args.productEmoji?.trim() ?? '';
  const productIcon =
    glyph && args.productEmojiId
      ? `<tg-emoji emoji-id="${escapeAttr(args.productEmojiId)}">${escapeAttr(glyph)}</tg-emoji> `
      : glyph && glyph !== CART_FALLBACK
        ? `${escapeAttr(glyph)} `
        : '';
  const name = `${productIcon}${escapeAttr(args.productName)}`;
  const html = renderHtmlTemplate(
    [
      `<blockquote>{feed_title} <b>${args.qtyAdded} new stock added for ${name}!</b>`,
      '',
      `{refer_active} <b>Available:</b> ${args.available} items`,
      `{prod_price_base} <b>Price:</b> ${money(args.price)} USDT`,
      '</blockquote>',
    ].join('\n'),
  );
  await sendRenderedHtml(api, html, {
    text: `Buy ${args.productName}`.slice(0, 64),
    iconKey: 'feed_buy_button',
    url: publicFeedBotUrl(`prod_${args.productId}`),
  });
}
