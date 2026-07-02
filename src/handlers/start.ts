import type { Composer } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { formatPriceWithCurrency } from '../../config/currencies.js';
import type { AppCtx } from '../middleware/user.js';
import { mainMenuKeyboard } from '../keyboards/mainMenu.js';
import { renderMdHtml } from '../services/premium.js';
import { getOrder, getProduct, confirmPendingReferral, cancelPendingReferral } from '../db/queries.js';
import { applyUserPriceToProduct } from '../services/pricing.js';
import { productKeyboard } from '../keyboards/shop.js';
import { QTY_MIN } from '../../config/index.js';
import { env } from '../env.js';
import { parsePublicOrderId, publicOrderId } from '../services/orderId.js';
import { formatReceivedItemsBlock } from '../services/orderRender.js';
import * as adminLog from '../services/adminLog.js';
import { clearAiSession } from './support.js';
import { inlineBtn } from '../keyboards/helpers.js';
import { enforceSubscription } from '../services/forceSub.js';
import { showProfile, showReferScreen } from './profile.js';
import { showTopupMenu } from './topup.js';
import { getStoreName } from '../services/settings.js';

/**
 * Silently dismiss any leftover persistent reply keyboard from older
 * versions of the bot. We send a near-invisible message with
 * `remove_keyboard: true`, then immediately delete it. The keyboard
 * removal sticks even after the message is gone. Once-per-session.
 */
async function clearOldReplyKeyboard(ctx: AppCtx): Promise<void> {
  if (ctx.session.kbCleared) return;
  ctx.session.kbCleared = true;
  if (!ctx.chat) return;
  try {
    const m = await ctx.api.sendMessage(ctx.chat.id, '\u2063', {
      reply_markup: { remove_keyboard: true },
    });
    try {
      await ctx.api.deleteMessage(ctx.chat.id, m.message_id);
    } catch {
      /* deletion is best-effort */
    }
  } catch {
    /* sending is best-effort */
  }
}

/**
 * Build the welcome screen as HTML, wrapping every configured
 * premium emoji in `<tg-emoji>` tags so premium subscribers see the
 * styled glyph and everyone else sees the unicode fallback.
 */
function buildWelcomeHtml(ctx: AppCtx): string {
  const title = ctx.t('welcome.title', { storeName: getStoreName() });
  const balance = ctx.t('welcome.balance', { balance: Number(ctx.user.balance).toFixed(2) });
  const body = `{welcome_banner} *${title}*\n\n{welcome_balance} ${balance}`;
  return renderMdHtml(body, {
    welcome_banner: 'welcome_banner',
    welcome_balance: 'welcome_balance',
  });
}

export async function showMainMenu(
  ctx: AppCtx,
  opts: { fresh?: boolean } = {},
): Promise<void> {
  const html = buildWelcomeHtml(ctx);
  const reply_markup = mainMenuKeyboard(ctx.lang);

  // If we got here via callback (e.g. "⬅️ Main Menu" button) edit in place.
  if (!opts.fresh && ctx.callbackQuery) {
    try {
      await ctx.editMessageText(html, { parse_mode: 'HTML', reply_markup });
      return;
    } catch {
      // editing failed (e.g. message too old) → fall through to send
    }
  }

  await ctx.reply(html, { parse_mode: 'HTML', reply_markup });
}

/**
 * Inspect the /start payload for a `prod_<id>` deep link emitted by
 * the Copy/Share button on the product page. When present, render
 * the product page directly so the friend who tapped the share link
 * lands exactly where the sharer wanted them. Returns true when the
 * deep link was handled and the caller should NOT show the main menu.
 */
async function handleProductDeepLink(ctx: AppCtx): Promise<boolean> {
  const text = ctx.message?.text ?? '';
  const m = text.match(/^\/start(?:@\S+)?\s+prod_(\d+)/i);
  if (!m) return false;
  const id = Number(m[1]);
  if (!Number.isFinite(id) || id <= 0) return false;
  const raw = await getProduct(id);
  if (!raw) return false;
  const p = await applyUserPriceToProduct(ctx.user.telegram_id, raw);
  const qty = ctx.session.qty[p.id] ?? QTY_MIN;
  const total = formatPriceWithCurrency(p.price * qty, ctx.user.currency);
  const productEmoji = p.emoji === '🛒' ? '' : (p.emoji ?? '');
  const body = [
    ctx.t('shop.product.line.name', { name: p.name, emoji: productEmoji }),
    ctx.t('shop.product.line.price', { price: formatPriceWithCurrency(p.price, ctx.user.currency) }),
    ctx.t('shop.product.line.stock', { stock: p.stock }),
    ctx.t('shop.product.line.warranty', { warranty: p.warranty ?? '—' }),
    ctx.t('shop.product.line.qty', { qty }),
    ctx.t('shop.product.line.total', { total }),
    ctx.t('shop.product.line.balance', { balance: formatPriceWithCurrency(ctx.user.balance, ctx.user.currency) }),
  ]
    .filter(Boolean)
    .join('\n');
  // Plain deep-link URL — fed straight into the keyboard's
  // `copy_text` button so a tap copies it to the user's clipboard
  // (no share-to-chat dialog, no automatic forward — see PR #57).
  const shareUrl = `https://t.me/${env.BOT_USERNAME}?start=prod_${p.id}`;
  await ctx.reply(renderMdHtml(body), {
    parse_mode: 'HTML',
    reply_markup: productKeyboard(ctx.lang, p, qty, shareUrl),
  });
  return true;
}

/**
 * Handle `/start ord_<publicId>` deep links — these are emitted by
 * the post-purchase invoice email "Re-open in Telegram" button and
 * by the in-chat "View Invoice" buttons under the Order Delivered
 * card. We resolve the public id back to a DB row, double-check
 * ownership, and render a compact order summary so the buyer lands
 * directly on their invoice instead of bouncing through Settings →
 * My Orders → Find by ID.
 */
async function handleInvoiceDeepLink(ctx: AppCtx): Promise<boolean> {
  const text = ctx.message?.text ?? '';
  const m = text.match(/^\/start(?:@\S+)?\s+ord_([0-9A-Z]+)/i);
  if (!m) return false;
  const dbId = parsePublicOrderId(`ORD${m[1]}`);
  if (!dbId) return false;
  const order = await getOrder(dbId);
  if (!order || order.user_id !== ctx.user.telegram_id) return false;
  const pubId = publicOrderId(order);
  const status =
    order.status === 'paid'
      ? ctx.t('orders.status.active')
      : order.status === 'refunded'
        ? ctx.t('orders.status.refunded')
        : ctx.t('orders.status.cancelled');
  const total = Number(order.total).toFixed(order.total % 1 === 0 ? 0 : 2);
  const lines = [
    ctx.t('orders.detail.title'),
    '',
    ctx.t('orders.detail.id', { id: pubId }),
    ctx.t('orders.detail.product', { name: order.product_name }),
    ctx.t('orders.detail.qty', { qty: order.qty }),
    ctx.t('orders.detail.total', { total }),
    ctx.t('orders.detail.status', { status }),
  ];
  // Prefer the per-item delivered pool so each link renders as its
  // own quoted pill; fall back to the legacy single-line delivery
  // text for older orders that pre-date `delivered_items`.
  const itemsBlock = formatReceivedItemsBlock(order.delivered_items);
  if (itemsBlock) {
    lines.push('', ctx.t('orders.detail.received', { received: itemsBlock }));
  } else if (order.delivery) {
    const urlMatch = order.delivery.match(/https?:\/\/\S+/);
    const deliveryText = urlMatch ? urlMatch[0] : order.delivery;
    lines.push('', ctx.t('orders.detail.received', { received: deliveryText }));
  }
  const kb = new InlineKeyboard();
  inlineBtn(kb, ctx.lang, 'back', 'main:open');
  await ctx.reply(renderMdHtml(lines.join('\n')), {
    parse_mode: 'HTML',
    reply_markup: kb,
    link_preview_options: { is_disabled: true },
  });
  return true;
}

async function handleReferDeepLink(ctx: AppCtx): Promise<boolean> {
  const text = ctx.message?.text ?? '';
  if (!/^\/start(?:@\S+)?\s+refer\b/i.test(text)) return false;
  await showReferScreen(ctx, { forceReply: true });
  return true;
}

async function handleSettingsDeepLink(ctx: AppCtx): Promise<boolean> {
  const text = ctx.message?.text ?? '';
  if (!/^\/start(?:@\S+)?\s+settings\b/i.test(text)) return false;
  await showProfile(ctx, { forceReply: true });
  return true;
}

async function handleTopupDeepLink(ctx: AppCtx): Promise<boolean> {
  const text = ctx.message?.text ?? '';
  if (!/^\/start(?:@\S+)?\s+topup\b/i.test(text)) return false;
  await showTopupMenu(ctx, false);
  return true;
}

export function registerStart(bot: Composer<AppCtx>): void {
  // Callback setting language on startup
  bot.callbackQuery(/^startlang:(en|ar|vi)$/, async (ctx) => {
    const selectedLang = ctx.match[1] as any;
    ctx.session.langSelected = true;

    const { setUserLanguage } = await import('../db/queries.js');
    await setUserLanguage(ctx.user.telegram_id, selectedLang);
    ctx.user.language = selectedLang;
    ctx.lang = selectedLang;

    const { t: translate } = await import('../i18n/index.js');
    ctx.t = (key, vars) => translate(selectedLang, key, vars);

    await ctx.answerCallbackQuery();

    try {
      await ctx.deleteMessage();
    } catch { /* ignore */ }

    // ===== تحقق الاشتراك الإجباري =====
    const subCheck = await enforceSubscription(ctx.api, ctx.user.telegram_id);
    if (!subCheck.pass) {
      const kb = new InlineKeyboard();
      let idx = 1;
      for (const ch of subCheck.channels) {
        const channelLink = ch.startsWith('@')
          ? `https://t.me/${ch.slice(1)}`
          : `https://t.me/c/${ch.replace('-100', '')}`;
        kb.url(`📢 اشترك في القناة ${idx++}`, channelLink).row();
      }
      kb.text('✅ اشتركت، تحقق الآن', 'forcesub:check');
      await ctx.reply(
        renderMdHtml(subCheck.message),
        { parse_mode: 'HTML', reply_markup: kb },
      );
      return;
    }

    const flagged = ctx.user as typeof ctx.user & { __just_created?: boolean };
    if (flagged.__just_created) {
      void adminLog.logFirstStart(ctx.api, {
        user: {
          telegram_id: ctx.user.telegram_id,
          username: ctx.user.username ?? null,
          first_name: ctx.user.first_name ?? null,
          email: ctx.user.email ?? null,
        },
        referralCode: ctx.user.ref_code ?? null,
        referredBy: ctx.user.referred_by ?? null,
      });
    }
    // تأكيد الإحالة المعلّقة إذا اشترك
    await confirmPendingReferral(ctx.user.telegram_id);

    if (await handleReferDeepLink(ctx)) return;
    if (await handleSettingsDeepLink(ctx)) return;
    if (await handleTopupDeepLink(ctx)) return;
    if (await handleProductDeepLink(ctx)) return;
    if (await handleInvoiceDeepLink(ctx)) return;
    await showMainMenu(ctx, { fresh: true });
  });

  bot.command('start', async (ctx) => {
    await clearOldReplyKeyboard(ctx);
    clearAiSession(ctx.from?.id);

    // If they haven't explicitly selected their language yet, prompt them first
    if (!ctx.session.langSelected) {
      const kb = new InlineKeyboard()
        .text('🇺🇸 English', 'startlang:en').row()
        .text('🇸🇦 العربية', 'startlang:ar').row()
        .text('🇻🇳 Tiếng Việt', 'startlang:vi');
      await ctx.reply(
        '🌐 *Please choose your language / الرجاء اختيار لغتك / Vui lòng chọn ngôn ngữ:*\n\n' +
        'Choose a language to continue.',
        { parse_mode: 'Markdown', reply_markup: kb }
      );
      return;
    }

    // ===== تحقق الاشتراك الإجباري =====
    const subCheck = await enforceSubscription(ctx.api, ctx.user.telegram_id);
    if (!subCheck.pass) {
      const kb = new InlineKeyboard();
      let idx = 1;
      for (const ch of subCheck.channels) {
        const channelLink = ch.startsWith('@')
          ? `https://t.me/${ch.slice(1)}`
          : `https://t.me/c/${ch.replace('-100', '')}`;
        kb.url(`📢 اشترك في القناة ${idx++}`, channelLink).row();
      }
      kb.text('✅ اشتركت، تحقق الآن', 'forcesub:check');
      await ctx.reply(
        renderMdHtml(subCheck.message),
        { parse_mode: 'HTML', reply_markup: kb },
      );
      return;
    }
    // ===================================

    const flagged = ctx.user as typeof ctx.user & { __just_created?: boolean };
    if (flagged.__just_created) {
      void adminLog.logFirstStart(ctx.api, {
        user: {
          telegram_id: ctx.user.telegram_id,
          username: ctx.user.username ?? null,
          first_name: ctx.user.first_name ?? null,
          email: ctx.user.email ?? null,
        },
        referralCode: ctx.user.ref_code ?? null,
        referredBy: ctx.user.referred_by ?? null,
      });
    }
    // تأكيد الإحالة المعلّقة إذا اشترك
    await confirmPendingReferral(ctx.user.telegram_id);

    if (await handleReferDeepLink(ctx)) return;
    if (await handleSettingsDeepLink(ctx)) return;
    if (await handleTopupDeepLink(ctx)) return;
    if (await handleProductDeepLink(ctx)) return;
    if (await handleInvoiceDeepLink(ctx)) return;
    await showMainMenu(ctx, { fresh: true });
  });

  // زر "اشتركت، تحقق الآن"
  bot.callbackQuery('forcesub:check', async (ctx) => {
    const subCheck = await enforceSubscription(ctx.api, ctx.user.telegram_id);
    if (!subCheck.pass) {
      const kb = new InlineKeyboard();
      let idx = 1;
      for (const ch of subCheck.channels) {
        const channelLink = ch.startsWith('@')
          ? `https://t.me/${ch.slice(1)}`
          : `https://t.me/c/${ch.replace('-100', '')}`;
        kb.url(`📢 اشترك في القناة ${idx++}`, channelLink).row();
      }
      kb.text('✅ اشتركت، تحقق الآن', 'forcesub:check');

      try {
        await ctx.editMessageText(
          renderMdHtml(subCheck.message),
          { parse_mode: 'HTML', reply_markup: kb }
        );
      } catch {
        // ignore identical content error
      }

      await ctx.answerCallbackQuery({
        text: '❌ لم تشترك في جميع القنوات بعد! يرجى الاشتراك في القنوات المتبقية أولاً.',
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    // اشترك — أكّد الإحالة المعلّقة إن وجدت
    await confirmPendingReferral(ctx.user.telegram_id);
    // أدخله البوت
    await ctx.editMessageText(
      renderMdHtml('✅ *تم التحقق من اشتراكك!* مرحباً بك 🎉'),
      { parse_mode: 'HTML' },
    );
    await showMainMenu(ctx, { fresh: true });
  });

  bot.command('menu', async (ctx) => {
    await clearOldReplyKeyboard(ctx);
    clearAiSession(ctx.from?.id);

    // تحقق الاشتراك عند /menu أيضاً
    const subCheck = await enforceSubscription(ctx.api, ctx.user.telegram_id);
    if (!subCheck.pass) {
      const kb = new InlineKeyboard();
      let idx = 1;
      for (const ch of subCheck.channels) {
        const channelLink = ch.startsWith('@')
          ? `https://t.me/${ch.slice(1)}`
          : `https://t.me/c/${ch.replace('-100', '')}`;
        kb.url(`📢 اشترك في القناة ${idx++}`, channelLink).row();
      }
      kb.text('✅ اشتركت، تحقق الآن', 'forcesub:check');
      await ctx.reply(
        renderMdHtml(subCheck.message),
        { parse_mode: 'HTML', reply_markup: kb },
      );
      return;
    }
    await showMainMenu(ctx, { fresh: true });
  });

  bot.callbackQuery('main:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.session.userFlow = undefined;
    clearAiSession(ctx.from?.id);
    await showMainMenu(ctx);
  });

  bot.callbackQuery('channel:open', async (ctx) => {
    await ctx.answerCallbackQuery({ text: ctx.t('channel.not_set'), show_alert: true });
  });
}
