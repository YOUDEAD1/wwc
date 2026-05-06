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
 * On the rare race condition where stock dropped to zero between
 * deposit creation and verification, the function falls back to
 * crediting the user's wallet for the order total so the user is
 * never out of money — a refund-like behaviour rather than a hard
 * failure.
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
    case 'binance_pay':
      return `Binance Pay (${methodName})`;
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

  if (!product.unlimited_stock && product.stock < intent.qty) {
    const newBalance = await credit(
      deposit.user_id,
      Number(intent.total),
      `deposit:${deposit.id}:out_of_stock`,
      'deposit_credit',
    );
    logger.warn(
      {
        deposit: deposit.id,
        productId: intent.product_id,
        wanted: intent.qty,
        stock: product.stock,
        newBalance,
      },
      'fulfilOrderForDeposit: out of stock — refunded to wallet',
    );
    await safeNotify(
      api,
      deposit.user_id,
      `⚠️ Your direct-pay for *${intent.product_name}* could not be delivered (out of stock). The full amount of *$${intent.total.toFixed(2)}* was credited to your wallet instead.`,
    );
    return {
      ok: false,
      reason: 'out of stock — refunded to wallet',
      refundedToWallet: true,
    };
  }

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
  await decrementProductStock(intent.product_id, intent.qty);
  const claimed = await claimProductItems(
    intent.product_id,
    intent.qty,
    order.id,
  );
  const deliveredItemsForChat =
    claimed.length > 0
      ? claimed.map((it) => `> ${it}`).join('\n>\n')
      : '> Manual delivery — admin will follow up shortly.';
  const deliveredItemsForDb =
    claimed.length > 0 ? claimed.join('\n') : 'Manual delivery — admin will follow up shortly.';
  if (claimed.length > 0) {
    await setOrderDeliveredItems(order.id, deliveredItemsForDb);
  }

  const publicId = publicOrderId(order);
  const user = await findUserById(deposit.user_id);
  const lang = user?.language ?? env.DEFAULT_LANG;
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(lang, key, vars);

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

  // Step 2: Order Delivered card with the claimed items
  await safeSendHtml(
    api,
    deposit.user_id,
    renderMdHtml(
      t('shop.buy.order_delivered', {
        order_id: publicId,
        name: intent.product_name,
        qty: intent.qty,
        total: intent.total.toFixed(2),
        items: deliveredItemsForChat,
      }),
    ),
  );

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

async function safeSendHtml(api: Api, userId: number, html: string): Promise<void> {
  try {
    await api.sendMessage(userId, html, { parse_mode: 'HTML' });
  } catch (err) {
    logger.warn({ err, userId }, 'direct-pay: user HTML DM failed');
  }
}
