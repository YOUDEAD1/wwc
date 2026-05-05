import http from 'node:http';
import { buildBot } from './bot.js';
import { env } from './env.js';
import { logger } from './logger.js';
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
      void handler(req, res);
    });
    server.listen(env.PORT, () => {
      logger.info({ port: env.PORT, url: env.WEBHOOK_URL }, 'Webhook server started');
    });
  } else {
    await bot.api.deleteWebhook({ drop_pending_updates: true });

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
