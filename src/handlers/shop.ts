import type { Composer } from 'grammy';
import { PRODUCTS_PER_PAGE, QTY_MAX, QTY_MIN } from '../../config/index.js';
import {
  createOrder,
  decrementProductStock,
  getProduct,
  listActiveProducts,
} from '../db/queries.js';
import { charge } from '../services/wallet.js';
import { productKeyboard, shopProductsKeyboard } from '../keyboards/shop.js';
import type { AppCtx } from '../middleware/user.js';
import { renderMdHtml } from '../services/premium.js';

/**
 * Top-level Shop home — paginated all-products list. The categories
 * step has been removed per UX request: tapping the Shop button
 * now drops the user directly onto this screen with the bold
 * `Available Products:` header and a Prev / Refresh / Next / Back
 * footer.
 */
async function showShopHome(ctx: AppCtx, page = 0) {
  const { rows, total } = await listActiveProducts(page, PRODUCTS_PER_PAGE);
  if (total === 0) {
    const empty = renderMdHtml(ctx.t('shop.empty_products'));
    if (ctx.callbackQuery) {
      await ctx.editMessageText(empty, { parse_mode: 'HTML' });
    } else {
      await ctx.reply(empty, { parse_mode: 'HTML' });
    }
    return;
  }
  const totalPages = Math.max(1, Math.ceil(total / PRODUCTS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const html = renderMdHtml(
    ctx.t('shop.home.header', {
      total,
      page: safePage + 1,
      pages: totalPages,
    }),
  );
  const kb = shopProductsKeyboard(ctx.lang, rows, safePage, totalPages);
  if (ctx.callbackQuery) {
    await ctx.editMessageText(html, { parse_mode: 'HTML', reply_markup: kb });
  } else {
    await ctx.reply(html, { parse_mode: 'HTML', reply_markup: kb });
  }
}

function productPageText(ctx: AppCtx, p: NonNullable<Awaited<ReturnType<typeof getProduct>>>, qty: number) {
  const total = (p.price * qty).toFixed(2);
  return [
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
}

async function showProduct(ctx: AppCtx, productId: number) {
  const p = await getProduct(productId);
  if (!p) {
    await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
    return;
  }
  const qty = ctx.session.qty[productId] ?? QTY_MIN;
  await ctx.editMessageText(renderMdHtml(productPageText(ctx, p, qty)), {
    parse_mode: 'HTML',
    reply_markup: productKeyboard(ctx.lang, p, qty),
  });
}

export function registerShop(bot: Composer<AppCtx>): void {
  // ----- Inline callbacks -----
  bot.callbackQuery('shop:home', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showShopHome(ctx);
  });

  // Paginated all-products list — `shop:p:<page>` is emitted by the
  // Prev / Refresh / Next buttons on the Shop home keyboard.
  bot.callbackQuery(/^shop:p:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showShopHome(ctx, Number(ctx.match[1]));
  });

  // Legacy category callbacks (`cat:<id>:<page>`) from older
  // messages still in users' chat histories — redirect to the new
  // all-products home so taps don't appear hung.
  bot.callbackQuery(/^cat:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showShopHome(ctx, 0);
  });

  bot.callbackQuery(/^prod:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showProduct(ctx, Number(ctx.match[1]));
  });

  bot.callbackQuery(/^qty:(\d+):([+-])$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const op = ctx.match[2];
    const cur = ctx.session.qty[id] ?? QTY_MIN;
    const next = Math.min(QTY_MAX, Math.max(QTY_MIN, cur + (op === '+' ? 1 : -1)));
    ctx.session.qty[id] = next;
    await ctx.answerCallbackQuery();
    await showProduct(ctx, id);
  });

  // Tap the qty digit → prompt the user to type any number 1..QTY_MAX.
  // We send the prompt with `force_reply: true` so the user's
  // keyboard pops up automatically focused on the reply box (mobile)
  // and keep the prompt's message id around so the text-handler can
  // delete it after capture.
  bot.callbackQuery(/^qty:(\d+):custom$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    await ctx.answerCallbackQuery();
    const prompt = await ctx.reply(ctx.t('shop.qty.prompt', { max: QTY_MAX }), {
      reply_markup: { force_reply: true, selective: true },
    });
    ctx.session.userFlow = {
      type: 'set_qty',
      step: 'value',
      data: { product_id: id, prompt_message_id: prompt.message_id },
    };
  });

  // Capture the next plain-text message as the custom quantity.
  bot.on('message:text', async (ctx, next) => {
    const flow = ctx.session.userFlow;
    if (!flow || flow.type !== 'set_qty') return next();
    const raw = ctx.message.text.trim();
    if (raw.startsWith('/')) {
      ctx.session.userFlow = undefined;
      return next();
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < QTY_MIN || n > QTY_MAX) {
      await ctx.reply(ctx.t('shop.qty.invalid', { max: QTY_MAX }));
      return;
    }
    const { product_id, prompt_message_id } = flow.data;
    ctx.session.qty[product_id] = n;
    ctx.session.userFlow = undefined;
    // Best-effort cleanup of the prompt and the user's reply so the
    // chat stays tidy. Failures are ignored — a stale prompt is
    // harmless.
    if (prompt_message_id !== undefined) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, prompt_message_id);
      } catch {
        /* ignore */
      }
    }
    try {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id);
    } catch {
      /* ignore */
    }
    // Re-render the product page with the new qty as a fresh message
    // (we don't have a callbackQuery here so editMessageText would
    // target the wrong message).
    const p = await getProduct(product_id);
    if (!p) {
      await ctx.reply(ctx.t('err.unknown_action'));
      return;
    }
    await ctx.reply(renderMdHtml(productPageText(ctx, p, n)), {
      parse_mode: 'HTML',
      reply_markup: productKeyboard(ctx.lang, p, n),
    });
  });

  bot.callbackQuery(/^note:(\d+)$/, async (ctx) => {
    const p = await getProduct(Number(ctx.match[1]));
    await ctx.answerCallbackQuery({
      text: p?.note ? p.note.slice(0, 190) : ctx.t('shop.note.empty'),
      show_alert: true,
    });
  });

  bot.callbackQuery(/^buy:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const p = await getProduct(id);
    if (!p) {
      await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
      return;
    }
    if (p.stock <= 0) {
      await ctx.answerCallbackQuery({ text: ctx.t('shop.buy.no_stock'), show_alert: true });
      return;
    }
    // Email gate — purchase requires a saved email so receipts/invoices
    // can be delivered. New users land here with `ctx.user.email` null.
    if (!ctx.user.email) {
      await ctx.answerCallbackQuery({
        text: ctx.t('shop.buy.email_required'),
        show_alert: true,
      });
      // Bounce them straight into the Set-Email flow.
      ctx.session.userFlow = { type: 'set_email', step: 'value', data: { mode: 'set' } };
      const text = [
        ctx.t('profile.email.set.title'),
        '',
        ctx.t('profile.email.set.body'),
      ].join('\n');
      await ctx.reply(renderMdHtml(text), { parse_mode: 'HTML' });
      return;
    }
    const qty = ctx.session.qty[id] ?? QTY_MIN;
    const total = Number((p.price * qty).toFixed(2));
    if (ctx.user.balance < total) {
      await ctx.answerCallbackQuery({
        text: ctx.t('shop.buy.insufficient', { need: total, have: ctx.user.balance }),
        show_alert: true,
      });
      return;
    }
    try {
      const order = await createOrder({
        user_id: ctx.from!.id,
        product_id: id,
        product_name: p.name,
        qty,
        unit_price: p.price,
        total,
        delivery: `Order #${id}-${qty} (mock delivery)`,
      });
      const newBalance = await charge(
        ctx.from!.id,
        total,
        ctx.user.balance,
        `order:${order.id}`,
      );
      ctx.user.balance = newBalance;
      await decrementProductStock(id, qty);
      delete ctx.session.qty[id];
      await ctx.answerCallbackQuery();
      await ctx.reply(
        renderMdHtml(
          ctx.t('shop.buy.success', {
            name: p.name,
            qty,
            total,
            delivery: order.delivery ?? '—',
          }),
        ),
        { parse_mode: 'HTML' },
      );
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === 'INSUFFICIENT_FUNDS') {
        await ctx.answerCallbackQuery({
          text: ctx.t('shop.buy.insufficient', { need: total, have: ctx.user.balance }),
          show_alert: true,
        });
        return;
      }
      throw e;
    }
  });

  bot.callbackQuery(/^noop:/, async (ctx) => {
    await ctx.answerCallbackQuery();
  });
}
