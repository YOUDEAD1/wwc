import http from 'node:http';
import { buildBot } from './bot.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { handleBinanceWebhook } from './server/binanceWebhook.js';
import { binanceEnabled } from './services/binance.js';
import { logMailerStatus } from './services/mailer.js';

async function main() {
  const bot = await buildBot();
  logMailerStatus();

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
    const server = http.createServer((req, res) => {
      void (async () => {
        if (await handleBinanceWebhook(bot, req, res)) return;
        await handler(req, res);
      })();
    });
    server.listen(env.PORT, () => {
      logger.info(
        { port: env.PORT, url: env.WEBHOOK_URL, binance: binanceEnabled() },
        'Webhook server started',
      );
    });
  } else {
    await bot.api.deleteWebhook({ drop_pending_updates: true });

    // In polling mode we still want a tiny HTTP server so external
    // services (Binance Pay) can reach us. Skip it entirely if no
    // listeners are configured.
    if (binanceEnabled()) {
      const server = http.createServer((req, res) => {
        void (async () => {
          if (await handleBinanceWebhook(bot, req, res)) return;
          if (req.url === '/health') {
            res.statusCode = 200;
            res.end('ok');
            return;
          }
          res.statusCode = 404;
          res.end('not found');
        })();
      });
      server.listen(env.PORT, () => {
        logger.info({ port: env.PORT }, 'Auxiliary HTTP server (Binance webhooks) started');
      });
    }

    logger.info('Starting bot with long-polling…');
    await bot.start({
      onStart: (info) => logger.info({ username: info.username }, 'Bot is online'),
    });
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error during startup');
  process.exit(1);
});

process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
