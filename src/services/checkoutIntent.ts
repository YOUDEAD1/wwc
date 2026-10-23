import { randomBytes } from 'node:crypto';
import type { AppCtx } from '../middleware/user.js';
export function createCheckoutIntent(ctx: AppCtx, product: number, qty: number, total: number) {
  const now = Date.now();
  const intents = (ctx.session.checkoutIntents ??= {});
  for (const [key, value] of Object.entries(intents)) if (value.expires < now) delete intents[key];
  if (Object.keys(intents).length >= 20) delete intents[Object.keys(intents)[0]!];
  const id = randomBytes(8).toString('hex');
  intents[id] = { product, qty, total, expires: now + 900000 };
  return id;
}
export function getCheckoutIntent(ctx: AppCtx, id: string | undefined, product: number) {
  if (!id) return;
  const intent = ctx.session.checkoutIntents?.[id];
  if (!intent || intent.expires < Date.now() || intent.product !== product)
    throw Error('Checkout confirmation expired. Please reopen the product.');
  return intent;
}
