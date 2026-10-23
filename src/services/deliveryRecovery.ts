import type { Api } from 'grammy';
import { logger } from '../logger.js';
import type { DBDeposit, DBOrder } from '../types.js';
import { rpc } from './checkout.js';
import { fulfilOrderForDeposit } from './orderFulfill.js';

export async function recoverPendingDeliveries(api: Api) {
  const orders = await rpc<DBOrder[]>('pending_checkout_deliveries');
  for (const order of orders) {
    try {
      await fulfilOrderForDeposit({
        api,
        deposit: { id: -order.id, user_id: order.user_id, amount: order.total } as DBDeposit,
        intent: {
          product_id: order.product_id!,
          product_name: order.product_name,
          qty: order.qty,
          unit_price: order.unit_price,
          total: order.total,
          discount: order.discount ?? 0,
          promo_id: order.promo_id,
        },
        provider: 'manual',
        methodName: 'Recovered checkout',
        approvedOrder: order,
      });
    } catch (err) {
      logger.warn({ orderId: order.id, err }, 'pending delivery recovery deferred');
    }
  }
}
