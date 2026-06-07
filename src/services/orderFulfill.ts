/**
 * Direct-pay order fulfilment.
 *
 * The Phase A wallet-top-up flow credits the user's wallet on
 * successful auto-verify. Phase B introduces *direct-pay-per-order*:
 * the user pays for a specific product directly with crypto and the
 * verifier delivers the order on success — without the wallet ever
 * being touched.
 *
 * `fulfilOrderForDeposit()` is the entry point. It runs the same
 * post-payment work the legacy `pay:wallet:<id>` callback runs in
 * `handlers/shop.ts` (create order, decrement stock, claim items,
 * deliver, send invoice, log to the admin channel) but driven from
 * a `Bot.api` instance so it works from both the user-side text
 * handler (verify-on-tx-hash-submit) and the admin re-verify
 * callback.
 *
 * When stock is gone between deposit creation and verification, the
 * function now creates a paid preorder/manual-delivery order instead
 * of refunding automatically. That keeps direct-pay behaviour aligned
 * with wallet/referral preorder checkout.
 */
import type { Api } from 'grammy';
import { logger } from '../logger.js';
import { env } from '../env.js';
import {
  createOrder,
  decrementProductStock,
  claimProductItems,
  setOrderDeliveredItems,
  getProduct,
  findUserById,
} from '../db/queries.js';
import { credit } from './wallet.js';
import { publicOrderId } from './orderId.js';
import { sendInvoiceEmail } from './mailer.js';
import * as adminLog from './adminLog.js';
import { renderMdHtml } from './premium.js';
import { buildOrderDeliveredChunks } from './orderRender.js';
import { InlineKeyboard, inlineBtn } from '../keyboards/helpers.js';
import { maybeStartDeliveryFormFromApi } from './postPurchaseDelivery.js';
import { t as translate } from '../i18n/index.js';
import type { DBDeposit, OrderIntent, PaymentProvider } from '../types.js';

/**
 * Map a payment provider to the user-facing "Paid Via" label that
 * the admin log + invoice email render. Mirrors the wording the
 * legacy wallet flow uses ("Wallet balance") so admins can tell at a
 * glance which path produced the order.
 */
function paidViaLabel(provider: PaymentProvider, methodName: string): string {
  switch (provider) {
    case 'usdt_trc20':
      return `USDT TRC20 (${methodName})`;
    case 'usdt_bep20':
      return `USDT BEP20 (${methodName})`;
    case 'usdt_ton':
      return `USDT TON (${methodName})`;
    case 'ltc':
      return `LTC (${methodName})`;
    default:
      return methodName;
  }
}

export type FulfilResult =
  | { ok: true; orderId: number; orderPublicId: string }
  | { ok: false; reason: string; refundedToWallet?: boolean };

/**
 * Fulfil a direct-pay deposit: create the order, deliver the items,
 * email the invoice (if the user has an email on file), and ping
 * the admin log channel.
 *
 * Caller is expected to have already marked the deposit `approved`
 * via the verifier; this function owns no DB state beyond order
 * creation and delivery.
 */
export async function fulfilOrderForDeposit(args: {
  api: Api;
  deposit: DBDeposit;
  intent: OrderIntent;
  provider: PaymentProvider;
  methodName: string;
}): Promise<FulfilResult> {
  const { api, deposit, intent, provider, methodName } = args;

  const product = await getProduct(intent.product_id);
  if (!product) {
    // The product was deleted between deposit creation and verify.
    // Refund to wallet so the user isn't out of money.
    const newBalance = await credit(
      deposit.user_id,
      Number(intent.total),
      `deposit:${deposit.id}:product_gone`,
      'deposit_credit',
    );
    logger.warn(
      { deposit: deposit.id, productId: intent.product_id, newBalance },
      'fulfilOrderForDeposit: product missing — refunded to wallet',
    );
    await safeNotify(
      api,
      deposit.user_id,
      `⚠️ Your direct-pay for *${intent.product_name}* could not be delivered (the product is no longer listed). The full amount of *$${intent.total.toFixed(2)}* was credited to your wallet instead.`,
    );
    return {
      ok: false,
      reason: 'product missing — refunded to wallet',
      refundedToWallet: true,
    };
  }

  const user = await findUserById(deposit.user_id);
  const lang = user?.language ?? env.DEFAULT_LANG;
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);
  const preorder = !product.unlimited_stock && product.stock < intent.qty;

  const order = await createOrder({
    user_id: deposit.user_id,
    product_id: intent.product_id,
    product_name: intent.product_name,
    qty: intent.qty,
    unit_price: intent.unit_price,
    total: intent.total,
    discount: intent.discount,
    promo_id: intent.promo_id,
    delivery: `Order #${intent.product_id}-${intent.qty}`,
  });
  if (!preorder) {
    await decrementProductStock(intent.product_id, intent.qty);
  }
  const claimed = preorder
    ? []
    : await claimProductItems(
        intent.product_id,
        intent.qty,
        order.id,
      );
  const publicId = publicOrderId(order);
  // Match the wallet-pay layout: split the items into 7-per-chunk
  // messages so the Order Delivered card never blows past Telegram's
  // 4096-char limit on bulk orders. The first chunk goes inside the
  // header card; subsequent chunks are sent as plain blockquote
  // messages right below it.
  const deliveredChunks = buildOrderDeliveredChunks(claimed);
  const pendingText = preorder
    ? t('shop.buy.preorder_pending')
    : t('shop.buy.delivery_pending');
  const firstChunkBlock =
    deliveredChunks[0]?.inlineBlock ??
    `> ${pendingText}`;
  const deliveredItemsForDb =
    claimed.length > 0 ? claimed.join('\n') : pendingText;
  // Always persist `delivered_items` — even the manual-delivery
  // placeholder — so the My Orders detail screen can render the
  // order without falling back to the legacy `delivery` blob.
  await setOrderDeliveredItems(order.id, deliveredItemsForDb);
  const deliveredKb = new InlineKeyboard();
  inlineBtn(deliveredKb, lang, 'using_method', `tut:${intent.product_id}`);
  deliveredKb.row();
  inlineBtn(deliveredKb, lang, 'send_note_txt', `order:txt:${order.id}`);

  // Step 1: Payment Verified card
  await safeSendHtml(
    api,
    deposit.user_id,
    renderMdHtml(
      t('shop.buy.payment_verified', {
        total: intent.total.toFixed(2),
      }),
    ),
  );

  // Step 2: Order Delivered card with the first chunk of items.
  const headerHasKeyboard = deliveredChunks.length <= 1;
  await safeSendHtml(
    api,
    deposit.user_id,
    renderMdHtml(
      t(preorder ? 'shop.buy.order_preordered' : 'shop.buy.order_delivered', {
        order_id: publicId,
        name: intent.product_name,
        qty: intent.qty,
        total: intent.total.toFixed(2),
        items: firstChunkBlock,
      }),
    ),
    headerHasKeyboard ? { reply_markup: deliveredKb } : undefined,
  );

  // Step 2b: send any remaining 7-link chunks as plain blockquote
  // follow-up messages. We push on through individual failures so a
  // single bad link doesn't keep the buyer from receiving the rest.
  for (let i = 1; i < deliveredChunks.length; i++) {
    const chunk = deliveredChunks[i];
    if (!chunk) continue;
    try {
      const opts = chunk.isLast
        ? { parse_mode: 'HTML' as const, reply_markup: deliveredKb }
        : { parse_mode: 'HTML' as const };
      await api.sendMessage(deposit.user_id, renderMdHtml(chunk.inlineBlock), opts);
    } catch (err) {
      logger.warn(
        {
          err,
          userId: deposit.user_id,
          orderId: order.id,
          chunkIndex: i,
          chunkSize: deliveredChunks.length,
        },
        'direct-pay: chunked items follow-up failed',
      );
    }
  }

  // Step 2c: Post-purchase delivery form — opens the per-product
  // "send your details" wizard when `delivery_form_enabled` is
  // turned on for this product. No-op for ordinary products.
  // Direct-pay has no live ctx so we drive the bot via raw Api;
  // see `maybeStartDeliveryFormFromApi` for the session-recovery
  // discussion.
  try {
    await maybeStartDeliveryFormFromApi({
      api,
      product,
      orderId: order.id,
      orderPublicId: publicId,
      buyerTelegramId: deposit.user_id,
      buyerLang: lang,
    });
  } catch (err) {
    logger.warn(
      { err, orderId: order.id, productId: product.id },
      'direct-pay: delivery form start failed',
    );
  }

  // Step 3: Email follow-up
  if (user?.email) {
    void sendInvoiceEmail({
      email: user.email,
      firstName: user.first_name ?? null,
      username: user.username ?? null,
      orderPublicId: publicId,
      orderDate: order.created_at,
      productName: intent.product_name,
      qty: intent.qty,
      unitPrice: intent.unit_price,
      total: intent.total,
      discount: intent.discount,
      paidVia: paidViaLabel(provider, methodName),
      items: claimed,
      invoiceLink: env.BOT_USERNAME
        ? `https://t.me/${env.BOT_USERNAME}?start=ord_${publicId}`
        : '',
    });
  }

  // Step 4: Admin log entry. `balanceAfter` is the user's current
  // wallet balance (unchanged — direct-pay never touches the wallet);
  // we pass it through so the admin block looks identical to the
  // wallet-pay variant.
  void adminLog
    .logOrderCreated(api, {
      user: {
        telegram_id: deposit.user_id,
        username: user?.username ?? null,
        first_name: user?.first_name ?? null,
        email: user?.email ?? null,
      },
      orderDbId: order.id,
      orderPublicId: publicId,
      productId: intent.product_id,
      productName: intent.product_name,
      qty: intent.qty,
      unitPrice: intent.unit_price,
      total: intent.total,
      paidVia: paidViaLabel(provider, methodName),
      balanceAfter: Number((user?.balance ?? 0).toFixed(3)),
    })
    .catch((err) => logger.warn({ err }, 'direct-pay: logOrderCreated failed'));

  return { ok: true, orderId: order.id, orderPublicId: publicId };
}

async function safeNotify(api: Api, userId: number, text: string): Promise<void> {
  try {
    await api.sendMessage(userId, text, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.warn({ err, userId }, 'direct-pay: user DM failed');
  }
}

async function safeSendHtml(
  api: Api,
  userId: number,
  html: string,
  opts?: Parameters<Api['sendMessage']>[2],
): Promise<void> {
  try {
    await api.sendMessage(userId, html, { parse_mode: 'HTML', ...(opts ?? {}) });
  } catch (err) {
    logger.warn({ err, userId }, 'direct-pay: user HTML DM failed');
  }
}
