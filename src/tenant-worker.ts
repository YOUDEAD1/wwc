import { workerHttp } from './platform/workerHttp.js';
import { readSetting, setSetting } from './db/queries.js';
import { syncApiShopProductsOnce } from './services/supplierAutoSync.js';
import { assertSchemaReady } from './services/checkout.js';
import { tenantWebhookSecret } from './tenants/security.js';
/**
 * Tenant Worker — يشتغل كـ process منفصل لكل مستأجر
 * لا يحتاج HTTP server — polling فقط
 */
import { buildBot } from './bot.js';
import { restoreLiveSupportSession } from './handlers/support.js';
import { logger } from './logger.js';
import { logMailerStatus } from './services/mailer.js';
import { getSettingValue, refreshSettings } from './services/settings.js';
import { startSupplierStockSyncLoop } from './services/supplierAutoSync.js';

async function main() {
  const tenantId = process.env.TENANT_ID ?? 'unknown';
  logger.info({ tenantId }, 'tenant worker starting');

  await assertSchemaReady();
  const bot = await buildBot({ isTenant: true });
  await bot.init();
  process.on('message', (message: any) => {
    if (message?.type === 'platform_config') {
      process.env.TENANT_PLAN = message.plan;
      process.env.TENANT_PAID_UNTIL = message.paidUntil ?? '';
    }
    if (message?.type === 'tenant_config' && message.subscriptionEnd)
      process.env.SUBSCRIPTION_END = message.subscriptionEnd;
  });
  logMailerStatus();
  await refreshSettings();
  await restoreLiveSupportSession();
  if (process.env.WWC_MANAGED === '1') {
    if (!getSettingValue('store.name')) {
      await setSetting('store.name', process.env.BOT_USERNAME);
      await refreshSettings();
    }
    const last = Number((await readSetting('wwc.last_source_sync')) ?? 0);
    if (Date.now() - last > 600000) {
      const result = await syncApiShopProductsOnce();
      if (!result.ok) throw new Error('NSS_CATALOG_INITIAL_SYNC_FAILED');
      await setSetting('wwc.last_source_sync', Date.now());
      const { rpc } = await import('./services/checkout.js');
      await rpc('wwc_shop_sessions_cleanup');
    }
  }
  startSupplierStockSyncLoop(bot.api);

  const isWebhook = process.env.BOT_MODE === 'webhook';
  if (isWebhook && process.env.PUBLIC_BASE_URL) {
    const webhookUrl = `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/webhook/tenant/${tenantId}`;
    if (process.env.WWC_MANAGED !== '1')
      await bot.api.setWebhook(webhookUrl, {
        secret_token: tenantWebhookSecret(process.env.BOT_TOKEN!),
        drop_pending_updates: false,
        allowed_updates: ['message', 'callback_query', 'chat_member'],
      });
    process.on('message', (msg: any) => {
      if (process.env.WWC_MANAGED === '1' && msg?.type === 'api_request')
        void workerHttp(bot.api, msg)
          .then((value) => process.send?.(value))
          .catch(() =>
            process.send?.({
              type: 'api_result',
              id: msg.id,
              status: 503,
              headers: { 'content-type': 'application/json' },
              body: '{\"error\":\"unavailable\"}',
            }),
          );
      if (msg && msg.type === 'telegram_update') {
        void bot
          .handleUpdate(msg.update)
          .then(() => process.send?.({ type: 'update_ack', id: msg.id, ok: true }))
          .catch((err) => {
            logger.error({ err, tenantId }, 'Tenant webhook failed');
            process.send?.({ type: 'update_ack', id: msg.id, ok: false });
          });
      }
    });
    process.send?.({ type: 'ready' });
    logger.info({ tenantId }, 'Tenant bot is online and listening for webhook updates via IPC');
  } else {
    await bot.api.deleteWebhook({ drop_pending_updates: false });
    logger.info({ tenantId }, 'Starting tenant bot with long-polling…');
    await bot.start({
      allowed_updates: ['message', 'callback_query', 'chat_member'],
      onStart: (info) => logger.info({ username: info.username, tenantId }, 'Tenant bot is online'),
    });
  }
}

main().catch((err) => {
  logger.fatal({ err, tenantId: process.env.TENANT_ID }, 'Tenant worker fatal error');
  process.exit(1);
});

process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
