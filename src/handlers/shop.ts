import type { Composer } from 'grammy';
import { InlineKeyboard, InputFile } from 'grammy';
import { PRODUCTS_PER_PAGE, QTY_MAX, QTY_MIN } from '../../config/index.js';
import {
  createOrder,
  decrementProductStock,
  getProduct,
  listActiveProducts,
} from '../db/queries.js';
import { charge } from '../services/wallet.js';
import {
  productKeyboard,
  qtyEditorKeyboard,
  shopProductsKeyboard,
} from '../keyboards/shop.js';
import { inlineBtn } from '../keyboards/helpers.js';
import type { AppCtx } from '../middleware/user.js';
import { renderMdHtml } from '../services/premium.js';
import { env } from '../env.js';
import { publicOrderId } from '../services/orderId.js';
import * as adminLog from '../services/adminLog.js';

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
  // Header is the single bold line `Available Products:` — page /
  // total counts live in the keyboard footer where they don't
  // clutter the body copy.
  const html = renderMdHtml(ctx.t('shop.home.header'));
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

/**
 * Build the deep-link URL that lands anyone who opens it back on
 * this product page inside the bot. The product keyboard wires
 * this URL straight into a Telegram `copy_text` button so tapping
 * it copies the link to the user's clipboard with a "Copied" toast
 * — no share dialog, no auto-forward to a chat. The receiver still
 * lands on the product page when they paste the link anywhere.
 */
function buildProductShareUrl(productId: number): string {
  return `https://t.me/${env.BOT_USERNAME}?start=prod_${productId}`;
}

async function showProduct(ctx: AppCtx, productId: number) {
  const p = await getProduct(productId);
  if (!p) {
    await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
    return;
  }
  const qty = ctx.session.qty[productId] ?? QTY_MIN;
  const shareUrl = buildProductShareUrl(p.id);
  await ctx.editMessageText(renderMdHtml(productPageText(ctx, p, qty)), {
    parse_mode: 'HTML',
    reply_markup: productKeyboard(ctx.lang, p, qty, shareUrl),
  });
}

/**
 * Render the futuristic inline qty-editor screen — the big counter
 * replacing the legacy "Type a quantity" prompt.
 */
async function showQtyEditor(ctx: AppCtx, productId: number) {
  const p = await getProduct(productId);
  if (!p) {
    await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
    return;
  }
  const qty = ctx.session.qty[productId] ?? QTY_MIN;
  const total = (p.price * qty).toFixed(2);
  const text = ctx.t('shop.qty.editor.title', {
    name: p.name,
    stock: p.stock,
    price: p.price,
    qty,
    total,
  });
  await ctx.editMessageText(renderMdHtml(text), {
    parse_mode: 'HTML',
    reply_markup: qtyEditorKeyboard(ctx.lang, p, qty),
  });
}

/**
 * Clamp a candidate qty to [QTY_MIN, min(QTY_MAX, stock)] — guards
 * against the user spamming +100 past the available stock.
 */
function clampQty(candidate: number, stock: number): number {
  const ceiling = Math.min(QTY_MAX, Math.max(QTY_MIN, stock));
  return Math.min(ceiling, Math.max(QTY_MIN, Math.trunc(candidate)));
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

  // Tap the qty digit → open the inline qty editor (the big counter
  // with ±1 / ±10 / ±100 / Max / Reset / Confirm / Contact Admin).
  // Replaces the legacy force-reply "Type a quantity (1–N) and send"
  // prompt so the entire flow stays in one message — no extra text
  // bubbles, no virtual keyboard required.
  bot.callbackQuery(/^qty:(\d+):custom$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showQtyEditor(ctx, Number(ctx.match[1]));
  });

  // Editor actions: ±N / max / reset / confirm / noop. Confirm and
  // Back both leave the editor — confirm renders the product page
  // so the user sees Buy Now ready to tap; Back is wired straight
  // to `prod:<id>` in the keyboard. `noop` is the qty-readout pill;
  // tapping it silently re-acks so the button doesn't appear hung.
  bot.callbackQuery(/^qtye:(\d+):(.+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const action = ctx.match[2];
    const p = await getProduct(id);
    if (!p) {
      await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
      return;
    }
    if (action === 'confirm') {
      await ctx.answerCallbackQuery();
      await showProduct(ctx, id);
      return;
    }
    if (action === 'noop') {
      // Tap on the qty readout pill — silent ack only; no edit.
      await ctx.answerCallbackQuery();
      return;
    }
    const cur = ctx.session.qty[id] ?? QTY_MIN;
    let candidate: number;
    if (action === 'max') {
      candidate = p.stock;
    } else if (action === 'reset') {
      candidate = QTY_MIN;
    } else {
      const delta = Number(action);
      if (!Number.isFinite(delta) || !Number.isInteger(delta)) {
        await ctx.answerCallbackQuery();
        return;
      }
      candidate = cur + delta;
    }
    const next = clampQty(candidate, p.stock);
    if (next === cur) {
      // Telegram errors out on `editMessageText` calls that don't
      // change anything; short-circuit so the user just gets a
      // silent ack on edge taps (e.g. -1 at 1, +1 at stock).
      await ctx.answerCallbackQuery();
      return;
    }
    ctx.session.qty[id] = next;
    await ctx.answerCallbackQuery();
    await showQtyEditor(ctx, id);
  });

  // ---- View Note ----
  // Replaces the popup-only behaviour with a full-screen detail view.
  // Body shows everything the user might need to know about the
  // product (name, price, stock, warranty, description, full note).
  // Buttons:
  //   - 📥 Save Note as TXT — sends the same body as a `.txt` file
  //     so the user has a downloadable copy.
  //   - Back → returns to the product page.
  bot.callbackQuery(/^note:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const p = await getProduct(id);
    if (!p) {
      await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
      return;
    }
    await ctx.answerCallbackQuery();
    const body = ctx.t('shop.note.full', {
      name: p.name,
      price: p.price,
      stock: p.stock,
      warranty: p.warranty ?? '—',
      description: p.description ?? '—',
      note: p.note && p.note.length > 0 ? p.note : ctx.t('shop.note.empty'),
    });
    const kb = new InlineKeyboard();
    inlineBtn(kb, ctx.lang, 'view_note_file', `note:txt:${p.id}`);
    kb.row();
    inlineBtn(kb, ctx.lang, 'back', `prod:${p.id}`);
    await ctx.editMessageText(renderMdHtml(body), {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
  });

  // Send the full product note as a downloadable `.txt` attachment.
  // Uses Telegram's native document viewer so the user can save it,
  // forward it to friends, etc. without any third-party hosting.
  bot.callbackQuery(/^note:txt:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const p = await getProduct(id);
    if (!p) {
      await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
      return;
    }
    await ctx.answerCallbackQuery();
    const lines = [
      `Product: ${p.name}`,
      `Price: ${p.price} USDT`,
      `Stock: ${p.stock}`,
      `Warranty: ${p.warranty ?? '—'}`,
      '',
      'Description:',
      p.description ?? '—',
      '',
      'Note:',
      p.note ?? '—',
      '',
      `— SafwanTiger Shop · ${new Date().toUTCString()}`,
    ].join('\n');
    const safeName = p.name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40) || 'product';
    const filename = `${safeName}_note.txt`;
    await ctx.replyWithDocument(
      new InputFile(Buffer.from(lines, 'utf8'), filename),
      {
        caption: `📄 ${p.name} — note`,
        parse_mode: 'HTML',
      },
    );
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
      // Notify admin with the deep-detail order block.
      void adminLog.logOrderCreated(ctx.api, {
        user: {
          telegram_id: ctx.user.telegram_id,
          username: ctx.user.username ?? null,
          first_name: ctx.user.first_name ?? null,
          email: ctx.user.email ?? null,
        },
        orderDbId: order.id,
        orderPublicId: publicOrderId(order),
        productId: p.id,
        productName: p.name,
        qty,
        unitPrice: p.price,
        total,
        paidVia: 'Wallet balance',
        balanceAfter: Number(newBalance.toFixed(3)),
      });
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

  // Tapping an out-of-stock product (either the row in the catalog
  // list or the disabled "Out of Stock" button on the product page)
  // pops up a localized "Please contact admin to restock" alert
  // instead of silently acking — gives the customer a clear next
  // step instead of a non-response. Must be registered BEFORE the
  // catch-all `noop:` handler below or the regex would swallow it.
  bot.callbackQuery('noop:oos', async (ctx) => {
    await ctx.answerCallbackQuery({
      text: ctx.t('shop.product.out_of_stock_popup'),
      show_alert: true,
    });
  });

  bot.callbackQuery(/^noop:/, async (ctx) => {
    await ctx.answerCallbackQuery();
  });
}
