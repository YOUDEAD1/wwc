import type { Composer } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { PRODUCTS_PER_PAGE, QTY_MAX, QTY_MIN } from '../../config/index.js';
import {
  createOrder,
  decrementProductStock,
  getProduct,
  listActiveProducts,
  claimProductItems,
  setOrderDeliveredItems,
} from '../db/queries.js';
import {
  applyUserPriceToProduct,
  applyUserPriceToProducts,
} from '../services/pricing.js';
import {
  nextPromoTeaser,
  priceBreakdown,
  resolvePromo,
  type PromoMatch,
} from '../services/promo.js';
import type { DBPromo } from '../types.js';
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
import { logger } from '../logger.js';
import { sendInvoiceEmail } from '../services/mailer.js';

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
  promo: PromoMatch | null = null,
  teaser: DBPromo | null = null,
) {
  const { gross, discount, total } = priceBreakdown(p.price, qty, promo);
  const eligible = !!promo && discount > 0;
  // Buying-page body intentionally omits the description per the
  // bot-owner spec — the description now lives only on the View Note
  // screen so the buy page stays focused on the price / qty / total
  // trio.
  const stockLabel = p.unlimited_stock ? '∞' : String(p.stock);
  const lines: string[] = [
    ctx.t('shop.product.line.name', { name: p.name, emoji: p.emoji ?? '' }),
  ];
  lines.push(
    ctx.t('shop.product.line.price', { price: p.price }),
    ctx.t('shop.product.line.stock', { stock: stockLabel }),
    ctx.t('shop.product.line.warranty', { warranty: p.warranty ?? '—' }),
  );
  // Teaser line under Warranty.
  //   - Always shows when there is no active promo yet but an
  //     upcoming threshold exists (the original "Buy 10+ −$5 Off"
  //     case).
  //   - When a promo is *already* applying, we still surface the
  //     next-upcoming threshold IFF it offers a strictly better
  //     discount than the one currently applied. This is the
  //     multi-tier UX: at qty 10 with `10+ → −$5` active, the
  //     buyer should still see `🎁 Promo: Buy 25+ −$15 Off` so
  //     they know the next reachable rule. We never surface a
  //     "weaker" upcoming promo on top of an active one — that
  //     would just be noise.
  const teaserBeats = teaser
    ? Number(teaser.discount_amount) > discount
    : false;
  if (teaser && (!eligible || teaserBeats)) {
    lines.push(
      ctx.t('shop.product.line.promo.teaser', {
        min_qty: teaser.min_qty,
        discount: Number(teaser.discount_amount).toFixed(2),
      }),
    );
  }
  lines.push('', ctx.t('shop.product.line.qty', { qty }));
  // Total Amount: when a promo applies, render gross → effective as
  // a strikethrough so the buyer sees the saving inline. When no
  // promo applies, fall back to the plain total line.
  if (eligible) {
    lines.push(
      ctx.t('shop.product.line.total.discounted', {
        gross: gross.toFixed(2),
        total: total.toFixed(2),
      }),
    );
  } else {
    lines.push(ctx.t('shop.product.line.total', { total: total.toFixed(2) }));
  }
  lines.push(ctx.t('shop.product.line.balance', { balance: ctx.user.balance }));
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

/**
 * Build the localized "Promo: …" order-summary line (with trailing
 * newline) for the given promo match, or an empty string when no
 * promo is active. Centralized so the buy / pay-wallet handlers
 * can just splice it into the existing `shop.pay.title` template.
 */
function renderPromoLine(
  ctx: AppCtx,
  promo: PromoMatch | null,
  discount: number,
): string {
  if (!promo || discount <= 0) return '';
  const label =
    promo.promo.name?.trim() ||
    ctx.t('shop.product.line.promo.fallback_label', {
      min_qty: promo.promo.min_qty,
    });
  return (
    ctx.t('shop.product.line.promo', {
      label,
      discount: discount.toFixed(2),
    }) + '\n'
  );
}

async function showProduct(ctx: AppCtx, productId: number) {
  const raw = await getProduct(productId);
  if (!raw) {
    await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
    return;
  }
  const p = await applyUserPriceToProduct(ctx.user.telegram_id, raw);
  const qty = ctx.session.qty[productId] ?? QTY_MIN;
  const promo = await resolvePromo(ctx.user.telegram_id, p.id, qty, p.price);
  const teaser = await nextPromoTeaser(
    ctx.user.telegram_id,
    p.id,
    qty,
    promo?.discount ?? 0,
  );
  const shareUrl = buildProductShareUrl(p.id);
  await ctx.editMessageText(renderMdHtml(productPageText(ctx, p, qty, promo, teaser)), {
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
 * Body mirrors the product-page layout (name + Price Base /
 * Available Stock / Warranty / Selected Qty / Total Amount /
 * Wallet) so the user can see the running cost while they enter
 * the qty; the digit buffer is rendered into the "Selected Qty"
 * (and Total Amount via `productPageText`) plus a short usage
 * instruction line below the body.
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
  // Live preview qty: buffer-as-number while the user is typing,
  // else the saved qty (or QTY_MIN) so the page is never visually
  // empty before the first tap.
  const previewQty = buf.length > 0 ? Number(buf) : ctx.session.qty[productId] ?? QTY_MIN;
  const promo = await resolvePromo(ctx.user.telegram_id, p.id, previewQty, p.price);
  const teaser = await nextPromoTeaser(
    ctx.user.telegram_id,
    p.id,
    previewQty,
    promo?.discount ?? 0,
  );
  const body = productPageText(ctx, p, previewQty, promo, teaser);
  const instruction = ctx.t('shop.qty.keypad.instruction', {
    current: buf.length > 0 ? buf : '—',
  });
  await ctx.editMessageText(renderMdHtml(`${body}\n\n${instruction}`), {
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

  // Inline `➖` / `➕` stepper on the product page — each tap nudges
  // the qty by one and re-renders the same message in place. The
  // value is clamped to `[QTY_MIN, min(QTY_MAX, stock)]`; tapping
  // past either edge surfaces a small toast and leaves the qty as
  // it was so we never push a no-op `editMessageText`.
  bot.callbackQuery(/^qty:(\d+):(inc|dec)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const direction = ctx.match[2];
    const raw = await getProduct(id);
    if (!raw) {
      await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
      return;
    }
    const p = await applyUserPriceToProduct(ctx.user.telegram_id, raw);
    const ceiling = Math.min(QTY_MAX, Math.max(0, p.stock));
    const current = ctx.session.qty[id] ?? QTY_MIN;
    const candidate = direction === 'inc' ? current + 1 : current - 1;
    if (candidate < QTY_MIN || candidate > ceiling) {
      // Silent ack at the boundaries — pressing ➖ at qty 1 or ➕
      // at the stock ceiling is a soft cap, not an error worth a
      // toast.
      await ctx.answerCallbackQuery();
      return;
    }
    ctx.session.qty[id] = candidate;
    await ctx.answerCallbackQuery();
    await showProduct(ctx, id);
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
      // Cap at 4 digits and at `min(QTY_MAX, stock)` so the buffer
      // never represents a qty the user couldn't actually buy.
      // Trailing taps past the ceiling are silently dropped (the
      // ack still happens below, so Telegram doesn't show a spinner).
      const ceiling = Math.min(QTY_MAX, Math.max(0, p.stock));
      if (buf.length < 4) {
        const candidate = (buf + digit).replace(/^0+(\d)/, '$1');
        if (Number(candidate) <= ceiling) buf = candidate;
      }
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
    const promo = await resolvePromo(ctx.user.telegram_id, p.id, next_, p.price);
    const teaser = await nextPromoTeaser(
      ctx.user.telegram_id,
      p.id,
      next_,
      promo?.discount ?? 0,
    );
    await ctx.reply(
      renderMdHtml(productPageText(ctx, p, next_, promo, teaser)),
      {
        parse_mode: 'HTML',
        reply_markup: productKeyboard(ctx.lang, p, next_, shareUrl),
      },
    );
  });

  // ---- View Note ----
  // Premium full-screen note view. The body is a single header
  // (`{prod_view_note} View Note`) plus the product description and
  // any admin-typed note text, rendered in a quoted/code block for
  // visual focus. When the admin uploaded a `.txt` (or any document)
  // we resend it as a Telegram document immediately after editing
  // the message — matches the pic-2 reference UX.
  //
  // Buttons: just `Back`. The legacy `📥 Save Note as TXT` button is
  // gone per the bot-owner spec.
  bot.callbackQuery(/^note:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const raw = await getProduct(id);
    if (!raw) {
      await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
      return;
    }
    const p = await applyUserPriceToProduct(ctx.user.telegram_id, raw);
    await ctx.answerCallbackQuery();
    const noteText = (p.note ?? '').trim();
    const desc = (p.description ?? '').trim();
    const body = ctx.t('shop.note.full', {
      name: p.name,
      description: desc.length > 0 ? desc : ctx.t('shop.note.empty_description'),
      note: noteText.length > 0 ? noteText : ctx.t('shop.note.empty'),
    });
    const kb = new InlineKeyboard();
    inlineBtn(kb, ctx.lang, 'back', `prod:${p.id}`);
    await ctx.editMessageText(renderMdHtml(body), {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
    // When the admin uploaded a document for this product, forward
    // it to the user as a separate document message so Telegram
    // renders it with its native green file card (pic 2). The body
    // above already references the file in the locale string.
    if (p.note_file_id) {
      try {
        await ctx.replyWithDocument(p.note_file_id);
      } catch {
        // file_id can expire across bot tokens; surface a polite
        // fallback rather than crashing the callback.
      }
    }
  });

  // ---- Using Method tutorial ----
  // Surfaced as a `📘 Using Method` button under every Order
  // Delivered card (and also accessible as a deep-link `/start tut_<id>`
  // from outside chats). Renders the admin-configured tutorial body
  // plus an optional photo / video / document attachment + an
  // optional URL button. When nothing has been configured yet we
  // surface a polite placeholder so the button isn't a dead end.
  bot.callbackQuery(/^tut:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const raw = await getProduct(id);
    if (!raw) {
      await ctx.answerCallbackQuery({ text: ctx.t('err.unknown_action') });
      return;
    }
    await ctx.answerCallbackQuery();
    const text = (raw.tutorial_text ?? '').trim();
    const body =
      text.length > 0
        ? ctx.t('shop.tutorial.body', { name: raw.name, body: text })
        : ctx.t('shop.tutorial.empty', { name: raw.name });
    const kb = new InlineKeyboard();
    if (raw.tutorial_url) {
      kb.url(ctx.t('btn.tutorial_open_link'), raw.tutorial_url).row();
    }
    inlineBtn(kb, ctx.lang, 'back', `prod:${id}`);
    // When a media attachment is configured, send it FIRST as a
    // standalone message (Telegram caps caption length at 1024
    // chars; a separate text message removes that constraint and
    // keeps the layout consistent across long tutorials). The text
    // body lands second carrying the URL/Back keyboard.
    if (raw.tutorial_file_id && raw.tutorial_file_type) {
      try {
        if (raw.tutorial_file_type === 'photo') {
          await ctx.replyWithPhoto(raw.tutorial_file_id);
        } else if (raw.tutorial_file_type === 'video') {
          await ctx.replyWithVideo(raw.tutorial_file_id);
        } else {
          await ctx.replyWithDocument(raw.tutorial_file_id);
        }
      } catch {
        // file_id can expire across bot tokens; degrade gracefully.
      }
    }
    await ctx.reply(renderMdHtml(body), { parse_mode: 'HTML', reply_markup: kb });
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
    if (!p.unlimited_stock && p.stock <= 0) {
      await ctx.answerCallbackQuery({ text: ctx.t('shop.buy.no_stock'), show_alert: true });
      return;
    }
    const qty = ctx.session.qty[id] ?? QTY_MIN;
    const promo = await resolvePromo(ctx.user.telegram_id, p.id, qty, p.price);
    const { discount, total } = priceBreakdown(p.price, qty, promo);
    const text = ctx.t('shop.pay.title', {
      name: p.name,
      qty,
      total: total.toFixed(2),
      balance: ctx.user.balance,
      promo_line: renderPromoLine(ctx, promo, discount),
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
    if (!p.unlimited_stock && p.stock <= 0) {
      await ctx.answerCallbackQuery({ text: ctx.t('shop.buy.no_stock'), show_alert: true });
      return;
    }
    // Email is no longer a hard gate — the bot-owner spec relaxed
    // checkout so users without a saved email can still buy. The
    // 12-hour nag (see `services/emailNag.ts`) handles the soft
    // reminder without blocking the purchase flow.
    const qty = ctx.session.qty[id] ?? QTY_MIN;
    // Resolve the promo *server-side* — never trust the client.
    // The product page may have rendered a promo for a different
    // qty since the user tapped Buy Now; we always recompute here.
    const promo = await resolvePromo(ctx.user.telegram_id, p.id, qty, p.price);
    const breakdown = priceBreakdown(p.price, qty, promo);
    const total = breakdown.total;
    const discount = breakdown.discount;
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
        discount,
        promo_id: promo?.promo.id ?? null,
        delivery: `Order #${id}-${qty}`,
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
      // Pull the actual delivery payload off the per-product items
      // pool. When the pool is empty (or short), fall back to a
      // "manual delivery" placeholder; the admin gets pinged via
      // logOrderCreated either way.
      const claimed = await claimProductItems(p.id, qty, order.id);
      // Items are joined with BLANK LINES between them so multiple
      // links / accounts each render on their own row with breathing
      // space — matches the bot-owner spec ("link 1\n\nlink 2\n\n
      // acc 1\n\nacc 2"). The DB-stored copy keeps single-line
      // separation so existing /myorders rendering still works.
      const deliveredItemsForChat =
        claimed.length > 0
          ? claimed.join('\n\n')
          : ctx.t('shop.buy.delivery_pending');
      const deliveredItemsForDb =
        claimed.length > 0
          ? claimed.join('\n')
          : ctx.t('shop.buy.delivery_pending');
      if (claimed.length > 0) {
        await setOrderDeliveredItems(order.id, deliveredItemsForDb);
      }
      await ctx.answerCallbackQuery();
      const publicId = publicOrderId(order);
      // ---- Step 1: Payment Verified card (auto-deletes after 15s) ----
      // We capture the message_id and schedule a delete via setTimeout
      // so the chat stays clean: by the time the user finishes reading
      // "Order Delivered!" the verified card has slid away.
      const verifiedMsg = await ctx.reply(
        renderMdHtml(
          ctx.t('shop.buy.payment_verified', {
            total: total.toFixed(2),
          }),
        ),
        { parse_mode: 'HTML' },
      );
      const verifiedChatId = verifiedMsg.chat.id;
      const verifiedMessageId = verifiedMsg.message_id;
      setTimeout(() => {
        // Fire-and-forget; if the user already deleted it manually
        // or 48h have passed, Telegram will reject — we just swallow.
        void ctx.api.deleteMessage(verifiedChatId, verifiedMessageId).catch((err) => {
          logger.debug(
            { err, chatId: verifiedChatId, messageId: verifiedMessageId },
            'auto-delete of payment_verified message failed (likely already gone)',
          );
        });
      }, 15_000);
      // ---- Step 2: Order Delivered card -----------------------
      // The keyboard always carries the per-product Using Method
      // button. When the buyer has an email on file we ALSO surface
      // a "View Invoice" deep-link so they can re-open this order's
      // detail screen at any time.
      const deliveredKb = new InlineKeyboard();
      inlineBtn(deliveredKb, ctx.lang, 'using_method', `tut:${p.id}`);
      const invoiceLink = env.BOT_USERNAME
        ? `https://t.me/${env.BOT_USERNAME}?start=ord_${publicId}`
        : '';
      if (ctx.user.email && invoiceLink) {
        deliveredKb.row().url(ctx.t('btn.view_invoice'), invoiceLink);
      }
      await ctx.reply(
        renderMdHtml(
          ctx.t('shop.buy.order_delivered', {
            order_id: publicId,
            name: p.name,
            qty,
            total: total.toFixed(2),
            items: deliveredItemsForChat,
          }),
        ),
        { parse_mode: 'HTML', reply_markup: deliveredKb },
      );
      // ---- Step 3: Email follow-up ----------------------------
      // Two branches per the bot-owner spec:
      //   a) No email → polite prompt with a `Set Email` deep link
      //      that opens Settings → Email Settings → Set Email.
      //   b) Has email → "Product Details and invoice sent" card +
      //      fire-and-forget the polished invoice email.
      if (!ctx.user.email) {
        const noEmailKb = new InlineKeyboard();
        inlineBtn(noEmailKb, ctx.lang, 'set_email_now', 'profile:email:set');
        await ctx.reply(
          renderMdHtml(ctx.t('shop.buy.add_email_prompt')),
          { parse_mode: 'HTML', reply_markup: noEmailKb },
        );
      } else {
        const invoiceKb = new InlineKeyboard();
        if (invoiceLink) {
          invoiceKb.url(ctx.t('btn.view_invoice'), invoiceLink);
        }
        await ctx.reply(
          renderMdHtml(
            ctx.t('shop.buy.invoice_sent', {
              email: ctx.user.email,
              link: invoiceLink || '—',
            }),
          ),
          {
            parse_mode: 'HTML',
            reply_markup: invoiceKb,
            link_preview_options: { is_disabled: true },
          },
        );
        // Fire-and-forget the professional invoice. Failure modes
        // (transport down, bad address) are logged inside mailer.ts
        // and never surface to the buyer — they already have the
        // delivery card with the items in-chat.
        void sendInvoiceEmail({
          email: ctx.user.email,
          firstName: ctx.user.first_name ?? null,
          username: ctx.user.username ?? null,
          orderPublicId: publicId,
          orderDate: order.created_at,
          productName: p.name,
          qty,
          unitPrice: p.price,
          total,
          discount,
          paidVia: 'Wallet balance',
          items: claimed,
          invoiceLink,
        });
      }
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
      // Anything else (DB column missing, RLS, network) MUST still
      // dismiss the loading spinner — otherwise the Wallet Pay button
      // sits in the "loading" state forever, which is exactly what
      // the bot owner reported. We surface a generic alert and log
      // the underlying error so the admin can debug from the logs.
      logger.error({ err: e, product_id: id, user: ctx.user.telegram_id }, 'pay:wallet failed');
      try {
        await ctx.answerCallbackQuery({
          text: ctx.t('shop.buy.failed'),
          show_alert: true,
        });
      } catch {
        // Fall through — Telegram sometimes rejects answerCallbackQuery
        // when the callback is too old (>15 min). Nothing we can do.
      }
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
