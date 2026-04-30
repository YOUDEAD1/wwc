import type { Composer } from 'grammy';
import { PRODUCTS_PER_PAGE, QTY_MAX, QTY_MIN } from '../../config/index.js';
import {
  createOrder,
  decrementProductStock,
  getCategory,
  getProduct,
  listCategories,
  listProducts,
} from '../db/queries.js';
import * as cache from '../services/cache.js';
import { charge } from '../services/wallet.js';
import {
  categoriesKeyboard,
  productKeyboard,
  productsKeyboard,
  shopHomeBackKeyboard,
} from '../keyboards/shop.js';
import type { AppCtx } from '../middleware/user.js';
import { renderMdHtml } from '../services/premium.js';

async function showCategories(ctx: AppCtx) {
  let cats = cache.get<Awaited<ReturnType<typeof listCategories>>>('cats');
  if (!cats) {
    cats = await listCategories();
    cache.set('cats', cats, 60_000);
  }
  if (cats.length === 0) {
    await ctx.reply(ctx.t('shop.empty_categories'));
    return;
  }
  const html = renderMdHtml(ctx.t('shop.choose_category'));
  const kb = categoriesKeyboard(ctx.lang, cats);
  if (ctx.callbackQuery) {
    await ctx.editMessageText(html, { parse_mode: 'HTML', reply_markup: kb });
  } else {
    await ctx.reply(html, { parse_mode: 'HTML', reply_markup: kb });
  }
}

async function showCategoryPage(ctx: AppCtx, categoryId: number, page: number) {
  const cat = await getCategory(categoryId);
  if (!cat) {
    await ctx.reply(ctx.t('err.unknown_action'));
    return;
  }
  const { rows, total } = await listProducts(categoryId, page, PRODUCTS_PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(total / PRODUCTS_PER_PAGE));
  if (rows.length === 0) {
    await ctx.editMessageText(ctx.t('shop.empty_products'), {
      reply_markup: shopHomeBackKeyboard(ctx.lang),
    });
    return;
  }
  const header = ctx.t('shop.page.header', { category: cat.name, page: page + 1 });
  await ctx.editMessageText(renderMdHtml(header), {
    parse_mode: 'HTML',
    reply_markup: productsKeyboard(ctx.lang, categoryId, rows, page, totalPages),
  });
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
    await showCategories(ctx);
  });

  bot.callbackQuery(/^cat:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, idStr, pageStr] = ctx.match;
    await showCategoryPage(ctx, Number(idStr), Number(pageStr));
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
      const newBalance = await charge(ctx.from!.id, total, ctx.user.balance);
      ctx.user.balance = newBalance;
      await decrementProductStock(id, qty);
      const order = await createOrder({
        user_id: ctx.from!.id,
        product_id: id,
        product_name: p.name,
        qty,
        unit_price: p.price,
        total,
        delivery: `Order #${id}-${qty} (mock delivery)`,
      });
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
