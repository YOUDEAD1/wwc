/**
 * Tenant Worker — يشتغل كـ process منفصل لكل مستأجر
 * لا يحتاج HTTP server — polling فقط
 */
import { buildBot } from './bot.js';
import { logger } from './logger.js';
import { logMailerStatus } from './services/mailer.js';
import { refreshSettings } from './services/settings.js';
import { restoreLiveSupportSession } from './handlers/support.js';
import { startSupplierStockSyncLoop } from './services/supplierAutoSync.js';

async function main() {
  const tenantId = process.env.TENANT_ID ?? 'unknown';
  logger.info({ tenantId }, 'tenant worker starting');

  const bot = await buildBot({ isTenant: true });
  logMailerStatus();
  await refreshSettings();
  await restoreLiveSupportSession();
  startSupplierStockSyncLoop(bot.api);

  await bot.api.deleteWebhook({ drop_pending_updates: true });

  logger.info({ tenantId }, 'Starting tenant bot with long-polling…');
  await bot.start({
    onStart: (info) => logger.info({ username: info.username, tenantId }, 'Tenant bot is online'),
  });
}

main().catch((err) => {
  logger.fatal({ err, tenantId: process.env.TENANT_ID }, 'Tenant worker fatal error');
  process.exit(1);
});

process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));