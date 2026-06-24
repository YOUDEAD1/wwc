import type { Api } from 'grammy';
import {
  claimProductItems,
  countAvailableProductItems,
  decrementProductStock,
  findUserById,
  getProduct,
  getSupplierProductLinkByProduct,
  listPendingPreorderOrders,
  restorePreorderPending,
  setOrderDeliveredItems,
  tryStartPreorderFulfillment,
} from '../db/queries.js';
import { env } from '../env.js';
import { InlineKeyboard, inlineBtn } from '../keyboards/helpers.js';
import { t as translate } from '../i18n/index.js';
import { logger } from '../logger.js';
import * as adminLog from './adminLog.js';
import { sendInvoiceEmail } from './mailer.js';
import { buildOrderDeliveredChunks } from './orderRender.js';
import { publicOrderId } from './orderId.js';
import { maybeStartDeliveryFormFromApi } from './postPurchaseDelivery.js';
import { renderMdHtml } from './premium.js';
import { isSupplierMigrationError, trySupplierAutoOrder } from './supplierApi.js';
import { tryApiShopAutoOrder } from './apiShop.js';

export type PreorderFulfillResult = {
  fulfilled: number;
  checked: number;
  waiting: number;
};

function paidViaForPreorder(total: number): string {
  return total <= 0 ? 'Referral Pay' : 'Preorder auto delivery';
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
    logger.warn({ err, userId }, 'preorder: user HTML DM failed');
  }
}

export async function fulfillPendingPreordersForProduct(
  api: Api,
  productId: number,
  limit = 25,
): Promise<PreorderFulfillResult> {
  const pending = await listPendingPreorderOrders(productId, limit);
  let fulfilled = 0;
  let checked = 0;

  for (const order of pending) {
    checked += 1;
    const product = await getProduct(productId);
    if (!product || (!product.unlimited_stock && product.stock < order.qty)) break;

    const poolAvailable = await countAvailableProductItems(productId).catch((err) => {
      logger.warn({ err, productId }, 'preorder: countAvailableProductItems failed');
      return 0;
    });
    if (poolAvailable > 0 && poolAvailable < order.qty) break;

    const user = await findUserById(order.user_id);
    const lang = user?.language ?? env.DEFAULT_LANG;
    const t = (key: string, vars?: Record<string, string | number>) =>
      translate(lang, key, vars);
    const preorderPendingText = t('shop.buy.preorder_pending');
    const publicId = publicOrderId(order);

    const locked = await tryStartPreorderFulfillment(order.id);
    if (!locked) continue;

    try {
      const shouldClaimFromPool = poolAvailable >= order.qty;
      let deliveredItems: string[] = [];
      if (shouldClaimFromPool) {
        deliveredItems = await claimProductItems(productId, order.qty, order.id);
        if (deliveredItems.length < order.qty) {
          await restorePreorderPending(order.id, preorderPendingText);
          break;
        }
      } else {
        const apiProductIdMatch = product?.note?.match(/\[API_PRODUCT_ID:([^\]]+)\]/);
        const apiProductId = apiProductIdMatch ? apiProductIdMatch[1] : null;

        if (apiProductId) {
          const supplierOrder = await tryApiShopAutoOrder({
            localProductId: productId,
            qty: order.qty,
            localOrderId: order.id,
            buyerInfo: user?.username ? `@${user.username}` : `tg_${order.user_id}`,
            onFailure: (failure) =>
              adminLog.logSupplierOrderFailed(api, {
                user: {
                  telegram_id: order.user_id,
                  username: user?.username ?? null,
                  first_name: user?.first_name ?? null,
                  email: user?.email ?? null,
                },
                orderDbId: order.id,
                orderPublicId: publicId,
                productId,
                productName: order.product_name,
                qty: order.qty,
                total: Number(order.total),
                paidVia: paidViaForPreorder(Number(order.total)),
                balanceAfter: Number((user?.balance ?? 0).toFixed(3)),
                supplierName: 'API Shop',
                supplierProductId: apiProductId,
                reason: failure.error,
                lowBalance: failure.lowBalance,
              }).catch((err) => logger.warn({ err }, 'preorder: API Shop failure admin log failed')),
          });
          if (!supplierOrder || supplierOrder.items.length === 0) {
            await restorePreorderPending(order.id, preorderPendingText);
            break;
          }
          deliveredItems = supplierOrder.items;
        } else {
          const supplierLink = await getSupplierProductLinkByProduct(productId).catch((err) => {
            if (isSupplierMigrationError(err)) return null;
            logger.warn({ err, productId }, 'preorder: supplier link lookup failed');
            return null;
          });
          if (supplierLink?.auto_order) {
            const supplierOrder = await trySupplierAutoOrder({
              localProductId: productId,
              qty: order.qty,
              localOrderId: order.id,
              onFailure: (failure) =>
                adminLog.logSupplierOrderFailed(api, {
                  user: {
                    telegram_id: order.user_id,
                    username: user?.username ?? null,
                    first_name: user?.first_name ?? null,
                    email: user?.email ?? null,
                  },
                  orderDbId: order.id,
                  orderPublicId: publicId,
                  productId,
                  productName: order.product_name,
                  qty: order.qty,
                  total: Number(order.total),
                  paidVia: paidViaForPreorder(Number(order.total)),
                  balanceAfter: Number((user?.balance ?? 0).toFixed(3)),
                  supplierName: failure.supplierName,
                  supplierProductId: failure.supplierProductId,
                  reason: failure.error,
                  lowBalance: failure.lowBalance,
                }).catch((err) => logger.warn({ err }, 'preorder: supplier failure admin log failed')),
            });
            if (!supplierOrder || supplierOrder.items.length === 0) {
              await restorePreorderPending(order.id, preorderPendingText);
              break;
            }
            deliveredItems = supplierOrder.items;
          }
        }
      }

      if (!product.unlimited_stock) {
        await decrementProductStock(productId, order.qty);
      }

      const deliveredChunks = buildOrderDeliveredChunks(deliveredItems);
      const pendingText = t('shop.buy.delivery_pending');
      const firstChunkBlock = deliveredChunks[0]?.inlineBlock ?? `> ${pendingText}`;
      const deliveredItemsForDb =
        deliveredItems.length > 0 ? deliveredItems.join('\n') : pendingText;
      await setOrderDeliveredItems(order.id, deliveredItemsForDb);

      const deliveredKb = new InlineKeyboard();
      inlineBtn(deliveredKb, lang, 'using_method', `tut:${productId}`);
      deliveredKb.row();
      inlineBtn(deliveredKb, lang, 'send_note_txt', `order:txt:${order.id}`);

      const headerHasKeyboard = deliveredChunks.length <= 1;
      await safeSendHtml(
        api,
        order.user_id,
        renderMdHtml(
          t('shop.buy.order_auto_delivered', {
            order_id: publicId,
            name: order.product_name,
            qty: order.qty,
            total: Number(order.total).toFixed(2),
            items: firstChunkBlock,
          }),
        ),
        headerHasKeyboard ? { reply_markup: deliveredKb } : undefined,
      );

      for (let i = 1; i < deliveredChunks.length; i++) {
        const chunk = deliveredChunks[i];
        if (!chunk) continue;
        await safeSendHtml(
          api,
          order.user_id,
          renderMdHtml(chunk.inlineBlock),
          chunk.isLast ? { reply_markup: deliveredKb } : undefined,
        );
      }

      await maybeStartDeliveryFormFromApi({
        api,
        product,
        orderId: order.id,
        orderPublicId: publicId,
        buyerTelegramId: order.user_id,
        buyerLang: lang,
      }).catch((err) => {
        logger.warn(
          { err, orderId: order.id, productId },
          'preorder: delivery form start failed',
        );
      });

      void adminLog
        .logOrderCreated(api, {
          user: {
            telegram_id: order.user_id,
            username: user?.username ?? null,
            first_name: user?.first_name ?? null,
            email: user?.email ?? null,
          },
          orderDbId: order.id,
          orderPublicId: publicId,
          productId,
          productName: order.product_name,
          qty: order.qty,
          unitPrice: Number(order.unit_price),
          total: Number(order.total),
          paidVia: paidViaForPreorder(Number(order.total)),
          balanceAfter: Number((user?.balance ?? 0).toFixed(3)),
          lifecycle: 'auto_delivered',
        })
        .catch((err) => logger.warn({ err }, 'preorder: auto-delivery admin log failed'));

      if (user?.email) {
        void sendInvoiceEmail({
          email: user.email,
          firstName: user.first_name ?? null,
          username: user.username ?? null,
          orderPublicId: publicId,
          orderDate: order.created_at,
          productName: order.product_name,
          qty: order.qty,
          unitPrice: Number(order.unit_price),
          total: Number(order.total),
          discount: Number(order.discount ?? 0),
          paidVia: paidViaForPreorder(Number(order.total)),
          items: deliveredItems,
          invoiceLink: env.BOT_USERNAME
            ? `https://t.me/${env.BOT_USERNAME}?start=ord_${publicId}`
            : '',
        });
      }

      fulfilled += 1;
    } catch (err) {
      logger.error({ err, orderId: order.id, productId }, 'preorder fulfillment failed');
      await restorePreorderPending(order.id, preorderPendingText).catch((restoreErr) => {
        logger.warn(
          { err: restoreErr, orderId: order.id },
          'preorder: restore pending marker failed',
        );
      });
      break;
    }
  }

  return {
    fulfilled,
    checked,
    waiting: Math.max(0, pending.length - fulfilled),
  };
}
