import http from 'node:http';
import { buildBot } from './bot.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { logMailerStatus } from './services/mailer.js';
import { startAllTenantBots } from './tenants/manager.js';
import { ensureTenantsTable } from './tenants/store.js';
import {
  handleHealthRequest,
  handleResellerApiRequest,
} from './services/resellerApiHttp.js';
import { startSupplierStockSyncLoop } from './services/supplierAutoSync.js';

async function main() {
  // البوت الرئيسي
  const bot = await buildBot({ isTenant: false });
  try {
    const { refreshSettings } = await import('./services/settings.js');
    await refreshSettings();
  } catch (err) {
    logger.error({ err }, 'Failed to load initial settings cache');
  }
  logMailerStatus();
  startSupplierStockSyncLoop(bot.api);

  const startHttpServer = (telegramHandler?: http.RequestListener) => {
    const server = http.createServer((req, res) => {
      void (async () => {
        if (handleHealthRequest(req, res)) return;
        if (await handleResellerApiRequest(req, res, bot.api)) return;
        if (telegramHandler) {
          telegramHandler(req, res);
          return;
        }
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'not_found' }));
      })().catch((err) => {
        logger.error({ err }, 'HTTP request handler failed');
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        }
        res.end(JSON.stringify({ ok: false, error: 'internal_error' }));
      });
    });
    server.listen(env.PORT, '0.0.0.0', () => {
      logger.info({ port: env.PORT, mode: env.BOT_MODE }, 'HTTP server started');
    });
  };

  // تهيئة جدول المستأجرين
  await ensureTenantsTable();

  // تشغيل بوتات المستأجرين
  await startAllTenantBots();

  // فحص انتهاء الاشتراكات كل ساعة
  const { checkExpiredTenants } = await import('./tenants/manager.js');
  setInterval(() => { void checkExpiredTenants(); }, 60 * 60 * 1000);

  if (env.BOT_MODE === 'webhook') {
    if (!env.WEBHOOK_URL) {
      logger.fatal('BOT_MODE=webhook but WEBHOOK_URL is empty');
      process.exit(1);
    }
    const { webhookCallback } = await import('grammy');

    await bot.api.setWebhook(env.WEBHOOK_URL, {
      secret_token: env.WEBHOOK_SECRET || undefined,
    });

    const handler = webhookCallback(bot, 'http', {
      secretToken: env.WEBHOOK_SECRET || undefined,
    });
    startHttpServer(handler);
  } else {
    startHttpServer();
    await bot.api.deleteWebhook({ drop_pending_updates: true });

    logger.info('Starting main bot with long-polling…');
    await bot.start({
      onStart: (info) => logger.info({ username: info.username }, 'Main bot is online'),
    });
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error during startup');
  process.exit(1);
});

process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));