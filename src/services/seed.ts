/**
 * One-time auto-seed for `payment_methods`.
 *
 * The bot used to ship with a handful of legacy manually-administered
 * payment methods. The new flow only needs two:
 *
 *   - Binance Pay (Pay-ID flow, auto-verified via `queryOrder` when
 *     API keys are configured, otherwise manual approval).
 *   - USDT (BEP-20) on BSC, auto-verified on-chain.
 *
 * On first startup after deploying this code we wipe the old rows
 * and insert the two defaults, then set a `settings` flag so we
 * never touch the table again. After that the admin can add /
 * delete / reorder methods freely from the admin UI without the
 * bot resurrecting deleted rows on the next restart.
 */
import { logger } from '../logger.js';
import {
  addPaymentMethod,
  deletePaymentMethod,
  listPaymentMethods,
  getAllSettings,
  setSetting,
} from '../db/queries.js';

const SEED_FLAG_KEY = 'payment_methods_seeded_v1';
const DEFAULT_BEP20_ADDRESS = '0xCf74990a332Ba2d02e718f16370a7236B56f010A';

export async function seedDefaultPaymentMethods(): Promise<void> {
  let settings;
  try {
    settings = await getAllSettings();
  } catch (err) {
    logger.warn({ err }, 'seed: could not read settings, skipping');
    return;
  }
  if (settings.get(SEED_FLAG_KEY)) {
    logger.debug('seed: payment_methods_seeded_v1 already set, skipping');
    return;
  }

  // Wipe legacy rows and insert the new defaults atomically (well,
  // as atomically as Supabase lets us — these are independent calls).
  let existing;
  try {
    existing = await listPaymentMethods();
  } catch (err) {
    logger.warn({ err }, 'seed: could not list payment methods, skipping');
    return;
  }

  if (existing.length > 0) {
    logger.info(
      { count: existing.length },
      'seed: clearing legacy payment methods before reseeding',
    );
    for (const m of existing) {
      try {
        await deletePaymentMethod(m.id);
      } catch (err) {
        logger.warn({ err, id: m.id }, 'seed: failed to delete legacy method');
      }
    }
  }

  logger.info('seed: inserting Binance Pay + USDT (BEP-20) defaults');
  try {
    await addPaymentMethod({
      name: 'Binance Pay',
      instructions:
        '1. Send any USDT amount to the Pay ID above.\n2. Paste your Order ID below.',
      min_amount: 1,
      provider: 'binance_pay',
    });
  } catch (err) {
    logger.warn({ err }, 'seed: failed to insert Binance Pay default');
  }

  try {
    await addPaymentMethod({
      name: 'USDT (BEP-20)',
      instructions:
        '1. Send any USDT amount to the address above.\n2. Paste your Transaction Hash (TXID) below.\n\n⚠️ AA Wallet users: paste the Bundle Hash from BscScan, not the AA TxHash.',
      min_amount: 1,
      provider: 'usdt_bep20',
      address: DEFAULT_BEP20_ADDRESS,
    });
  } catch (err) {
    logger.warn({ err }, 'seed: failed to insert USDT (BEP-20) default');
  }

  try {
    await setSetting(SEED_FLAG_KEY, true);
    logger.info('seed: defaults installed and flag set');
  } catch (err) {
    logger.error(
      { err },
      'seed: defaults installed but flag NOT set (will reseed on next boot!)',
    );
  }
}
