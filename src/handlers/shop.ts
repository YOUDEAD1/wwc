import type { Composer } from 'grammy';
import { InlineKeyboard, InputFile } from 'grammy';
import { PRODUCTS_PER_PAGE, QTY_MAX, QTY_MIN } from '../../config/index.js';
import {
  createOrder,
  decrementProductStock,
  getProduct,
  listActiveProducts,
} from '../db/queries.js';
import {
  applyUserPriceToProduct,
  applyUserPriceToProducts,
} from '../services/pricing.js';
import { charge } from '../services/wallet.js';
import {
  paymentMethodKeyboard,
  productKeyboard,
  qtyKeypadKeyboard,
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
  const { rows: rawRows, total } = await listActiveProducts(page, PRODUCTS_PER_PAGE);
  // Layer per-user price overrides onto the catalog rows before we
  // build the keyboard so the price embedded in each button label
  // matches what the user will actually be charged.
  const rows = await applyUserPriceToProducts(ctx.user.telegram_id, rawRows);
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

/**
 * Render the new product detail body — product emoji + name on
 * line 1, then a blank line, then a stack of premium-emoji-prefixed
 * facts (Price Base / Available Stock / Warranty), a blank line,
 * then the live "Selected Qty / Total Amount / Wallet" trio that
 * updates whenever the user changes the qty.
 *
 * Each `{prod_*}` token in the locale strings resolves to a
 * `<tg-emoji>` tag at render time so premium subscribers see the
 * animated glyph. Bot-owner-supplied custom_emoji_id values live in
 * the EMOJI map in `config/index.ts`.
 */
function productPageText(
  ctx: AppCtx,
  p: NonNullable<Awaited<ReturnType<typeof getProduct>>>,
  qty: number,
) {
  const total = (p.price * qty).toFixed(2);
  const lines: string[] = [
    ctx.t('shop.product.line.name', { name: p.name, emoji: p.emoji ?? '' }),
  ];
  if (p.description) lines.push(p.description);
  lines.push(
    ctx.t('shop.product.line.price', { price: p.price }),
    ctx.t('shop.product.line.stock', { stock: p.stock }),
    ctx.t('shop.product.line.warranty', { warranty: p.warranty ?? '—' }),
    '',
    ctx.t('shop.product.line.qty', { qty }),
    ctx.t('shop.product.line.total', { total }),
    ctx.t('shop.product.line.balance', { balance: ctx.user.balance }),
  );
  return lines.join('\n');
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
  const raw = await getProduct(productId);
  if (!raw) {
    await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
    return;
  }
  const p = await applyUserPriceToProduct(ctx.user.telegram_id, raw);
  const qty = ctx.session.qty[productId] ?? QTY_MIN;
  const shareUrl = buildProductShareUrl(p.id);
  await ctx.editMessageText(renderMdHtml(productPageText(ctx, p, qty)), {
    parse_mode: 'HTML',
    reply_markup: productKeyboard(ctx.lang, p, qty, shareUrl),
  });
}

/**
 * Render the *Custom Quantity* keypad screen. Edits the current
 * product page in place so the user stays in one message; the
 * accumulating digit buffer (the "Current:" line) lives in
 * `ctx.session.qtyInput[productId]` so taps and direct-typed
 * numbers feed into the same string.
 *
 * The bot stores `ctx.session.userFlow = { type: 'qty_keypad', ... }`
 * while the keypad is open so the text-message middleware knows to
 * treat plain numbers as qty input (and to auto-delete the prompt
 * + the user's reply on a successful submission).
 */
async function showQtyKeypad(ctx: AppCtx, productId: number, currentBuf?: string) {
  const raw = await getProduct(productId);
  if (!raw) {
    await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
    return;
  }
  const p = await applyUserPriceToProduct(ctx.user.telegram_id, raw);
  const buf = currentBuf ?? ctx.session.qtyInput?.[productId] ?? '';
  const text = ctx.t('shop.qty.keypad.prompt', {
    name: p.name,
    stock: p.stock,
    current: buf.length > 0 ? buf : '—',
  });
  await ctx.editMessageText(renderMdHtml(text), {
    parse_mode: 'HTML',
    reply_markup: qtyKeypadKeyboard(ctx.lang, p),
  });
}

/**
 * Validate a candidate quantity against `[1, min(QTY_MAX, stock)]`.
 * Returns the clamped integer on success or `null` if the input is
 * non-numeric / out of range — caller surfaces the premium-emoji
 * error message and keeps the keypad open.
 */
function validateQty(candidate: string | number, stock: number): number | null {
  const n = typeof candidate === 'string' ? Number(candidate) : candidate;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  const ceiling = Math.min(QTY_MAX, Math.max(0, stock));
  if (n < QTY_MIN || n > ceiling) return null;
  return n;
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

  // Tap *Custom Quantity* on the product page → switches the same
  // message into the numeric-keypad screen. Resets the digit buffer
  // and arms the userFlow so plain-text replies are interpreted as
  // qty input (with auto-delete of the prompt + reply on success).
  bot.callbackQuery(/^qty:(\d+):custom$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    if (!ctx.session.qtyInput) ctx.session.qtyInput = {};
    ctx.session.qtyInput[id] = '';
    ctx.session.userFlow = {
      type: 'qty_keypad',
      step: 'await_qty',
      data: {
        productId: id,
        promptChatId: ctx.chat?.id ?? ctx.from!.id,
        promptMessageId: ctx.callbackQuery!.message?.message_id,
      },
    };
    await ctx.answerCallbackQuery();
    await showQtyKeypad(ctx, id, '');
  });

  // Numeric-keypad actions: digit / backspace / clear / confirm.
  // Digits are appended as strings so `1` + `1` becomes `"11"` (not
  // arithmetic 2). `Back` (cancel) is wired straight to `prod:<id>`
  // in the keyboard.
  bot.callbackQuery(/^qkp:(\d+):(d:[0-9]|back|clear|confirm)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const action = ctx.match[2]!;
    const raw = await getProduct(id);
    if (!raw) {
      await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
      return;
    }
    const p = await applyUserPriceToProduct(ctx.user.telegram_id, raw);
    if (!ctx.session.qtyInput) ctx.session.qtyInput = {};
    const prev = ctx.session.qtyInput[id] ?? '';
    let buf = prev;
    if (action.startsWith('d:')) {
      const digit = action.slice(2);
      // Cap at 4 digits — anything larger than 9999 is rejected by
      // QTY_MAX anyway, so don't let the buffer balloon.
      if (buf.length < 4) buf = (buf + digit).replace(/^0+(\d)/, '$1');
    } else if (action === 'back') {
      buf = buf.slice(0, -1);
    } else if (action === 'clear') {
      buf = '';
    } else if (action === 'confirm') {
      const next = validateQty(buf, p.stock);
      if (next === null) {
        await ctx.answerCallbackQuery({
          text: ctx.t('shop.qty.keypad.invalid', { max: Math.min(QTY_MAX, p.stock) }),
          show_alert: true,
        });
        return;
      }
      ctx.session.qty[id] = next;
      delete ctx.session.qtyInput[id];
      ctx.session.userFlow = undefined;
      await ctx.answerCallbackQuery();
      await showProduct(ctx, id);
      return;
    }
    ctx.session.qtyInput[id] = buf;
    await ctx.answerCallbackQuery();
    // Skip the edit when the buffer didn't change (e.g. backspace
    // on an already-empty buffer, digit beyond the 4-char cap) —
    // Telegram rejects no-op edits with "message is not modified".
    if (buf === prev) return;
    await showQtyKeypad(ctx, id, buf);
  });

  // While the *Custom Quantity* keypad is open, plain-text replies
  // are interpreted as the quantity. On success: auto-delete the
  // keypad prompt + the user's message, apply the qty, and re-open
  // the product page (matches the bot-owner spec). On failure: show
  // the premium-emoji invalid-quantity warning (auto-deleted after
  // a short delay so the chat stays tidy) and keep the keypad open.
  bot.on('message:text', async (ctx, next) => {
    const flow = ctx.session.userFlow;
    if (!flow || flow.type !== 'qty_keypad') return next();
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) {
      // /cancel etc — leave the keypad and let downstream commands
      // run normally.
      ctx.session.userFlow = undefined;
      delete ctx.session.qtyInput?.[flow.data.productId];
      return next();
    }
    const raw = await getProduct(flow.data.productId);
    if (!raw) {
      ctx.session.userFlow = undefined;
      return;
    }
    const p = await applyUserPriceToProduct(ctx.user.telegram_id, raw);
    // Strip non-digits so a stray space / punctuation doesn't
    // invalidate an otherwise-valid number ("11 " → "11").
    const digits = text.replace(/[^0-9]/g, '');
    const next_ = digits ? validateQty(digits, p.stock) : null;
    if (next_ === null) {
      // Premium-emoji invalid warning. Sent to the chat (as opposed
      // to a callback popup) because the user typed a message — a
      // popup wouldn't surface here.
      const warn = await ctx.reply(
        renderMdHtml(
          ctx.t('shop.qty.keypad.invalid', { max: Math.min(QTY_MAX, p.stock) }),
        ),
        { parse_mode: 'HTML' },
      );
      // Auto-cleanup: delete the user's bad reply now and the
      // warning bubble after ~5s so the screen stays calm.
      void ctx.deleteMessage().catch(() => undefined);
      setTimeout(() => {
        void ctx.api
          .deleteMessage(warn.chat.id, warn.message_id)
          .catch(() => undefined);
      }, 5_000);
      return;
    }
    // Success — apply the qty and tear down both messages.
    ctx.session.qty[flow.data.productId] = next_;
    delete ctx.session.qtyInput?.[flow.data.productId];
    ctx.session.userFlow = undefined;
    void ctx.deleteMessage().catch(() => undefined);
    if (flow.data.promptMessageId) {
      void ctx.api
        .deleteMessage(flow.data.promptChatId, flow.data.promptMessageId)
        .catch(() => undefined);
    }
    // Re-open the product page as a fresh message (the prompt was
    // just deleted, so we can't editMessageText into it).
    const shareUrl = buildProductShareUrl(p.id);
    await ctx.reply(renderMdHtml(productPageText(ctx, p, next_)), {
      parse_mode: 'HTML',
      reply_markup: productKeyboard(ctx.lang, p, next_, shareUrl),
    });
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
    const raw = await getProduct(id);
    if (!raw) {
      await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
      return;
    }
    const p = await applyUserPriceToProduct(ctx.user.telegram_id, raw);
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
    const raw = await getProduct(id);
    if (!raw) {
      await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
      return;
    }
    const p = await applyUserPriceToProduct(ctx.user.telegram_id, raw);
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

  // *Buy Now* on the product page no longer charges immediately —
  // it edits the message into a payment-method picker that lets the
  // user choose between paying with their wallet balance and topping
  // up first. The actual charge happens on `pay:wallet:<id>`.
  bot.callbackQuery(/^buy:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const raw = await getProduct(id);
    if (!raw) {
      await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
      return;
    }
    const p = await applyUserPriceToProduct(ctx.user.telegram_id, raw);
    if (p.stock <= 0) {
      await ctx.answerCallbackQuery({ text: ctx.t('shop.buy.no_stock'), show_alert: true });
      return;
    }
    const qty = ctx.session.qty[id] ?? QTY_MIN;
    const total = (p.price * qty).toFixed(2);
    const text = ctx.t('shop.pay.title', {
      name: p.name,
      qty,
      total,
      balance: ctx.user.balance,
    });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(renderMdHtml(text), {
      parse_mode: 'HTML',
      reply_markup: paymentMethodKeyboard(ctx.lang, p),
    });
  });

  // Wallet-payment branch of the new payment-method picker. Mirrors
  // the legacy `buy:<id>` charge logic — email gate, balance check,
  // order creation, wallet charge, stock decrement, admin log.
  bot.callbackQuery(/^pay:wallet:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const raw = await getProduct(id);
    if (!raw) {
      await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
      return;
    }
    // Use the per-user effective price for charge / order recording
    // so the price the user saw on the product page is the price
    // they're actually billed.
    const p = await applyUserPriceToProduct(ctx.user.telegram_id, raw);
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
