import type { Composer } from 'grammy';
import type { AppCtx } from '../middleware/user.js';
import { mainMenuKeyboard } from '../keyboards/mainMenu.js';
import { renderMdHtml } from '../services/premium.js';
import { getProduct } from '../db/queries.js';
import { productKeyboard } from '../keyboards/shop.js';
import { QTY_MIN } from '../../config/index.js';
import { env } from '../env.js';
import * as adminLog from '../services/adminLog.js';

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
  const title = ctx.t('welcome.title');
  const balance = ctx.t('welcome.balance', { balance: Number(ctx.user.balance).toFixed(2) });
  const body = `{welcome_banner} *${title}*\n\n{welcome_balance} ${balance}`;
  return renderMdHtml(body, {
    welcome_banner: 'welcome_banner',
    welcome_balance: 'welcome_balance',
  });
}

async function showMainMenu(ctx: AppCtx, opts: { fresh?: boolean } = {}): Promise<void> {
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
  const p = await getProduct(id);
  if (!p) return false;
  const qty = ctx.session.qty[p.id] ?? QTY_MIN;
  const total = (p.price * qty).toFixed(2);
  const body = [
    ctx.t('shop.product.line.name', { name: p.name }),
    p.description ? p.description : '',
    ctx.t('shop.product.line.price', { price: p.price }),
    ctx.t('shop.product.line.stock', { stock: p.stock }),
    ctx.t('shop.product.line.warranty', { warranty: p.warranty ?? '—' }),
    ctx.t('shop.product.line.qty', { qty }),
    ctx.t('shop.product.line.total', { total }),
    ctx.t('shop.product.line.balance', { balance: ctx.user.balance }),
  ]
    .filter(Boolean)
    .join('\n');
  const target = `https://t.me/${env.BOT_USERNAME}?start=prod_${p.id}`;
  const shareUrl =
    `https://t.me/share/url?url=${encodeURIComponent(target)}` +
    `&text=${encodeURIComponent(`${p.name} — SafwanTiger Shop`)}`;
  await ctx.reply(renderMdHtml(body), {
    parse_mode: 'HTML',
    reply_markup: productKeyboard(ctx.lang, p, qty, shareUrl),
  });
  return true;
}

export function registerStart(bot: Composer<AppCtx>): void {
  bot.command('start', async (ctx) => {
    await clearOldReplyKeyboard(ctx);
    // First-start admin log — fires only on the very first /start so
    // the admin sees a clean "new user joined" entry. The sentinel
    // is set by getOrCreateUser when the row was just inserted.
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
    if (await handleProductDeepLink(ctx)) return;
    await showMainMenu(ctx, { fresh: true });
  });

  bot.command('menu', async (ctx) => {
    await clearOldReplyKeyboard(ctx);
    await showMainMenu(ctx, { fresh: true });
  });

  // "⬅️ Main Menu" inline button used across screens.
  bot.callbackQuery('main:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    // Reset any in-flight user flow when returning to the main menu so
    // a stale prompt (e.g. set_email) can't capture later messages.
    ctx.session.userFlow = undefined;
    await showMainMenu(ctx);
  });

  // Fallback for the channel button when admin hasn't set the URL yet.
  // (When the URL is set, mainMenuKeyboard renders a direct URL button
  // and Telegram never sends us this callback.)
  bot.callbackQuery('channel:open', async (ctx) => {
    await ctx.answerCallbackQuery({ text: ctx.t('channel.not_set'), show_alert: true });
  });
}
