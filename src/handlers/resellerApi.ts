import type { Composer } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { AppCtx } from '../middleware/user.js';
import {
  apiBaseUrl,
  disableApiKey,
  generateApiKey,
  getApiStatus,
  type ApiStatus,
} from '../services/resellerApi.js';
import { renderMdHtml } from '../services/premium.js';

function money(n: number): string {
  return Number(n).toFixed(2);
}

function mask(prefix: string | null): string {
  return prefix ? `${prefix}••••••••` : '—';
}

function panelKeyboard(status: ApiStatus): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (status.active) {
    kb.text('🔄 Regenerate Key', 'api:generate');
    kb.row();
    kb.text('❌ Disable API', 'api:disable');
  } else {
    kb.text('🔗 Generate New API Key', 'api:generate');
  }
  kb.row();
  kb.text('📂 View API Documentation', 'api:docs');
  kb.row();
  kb.text('🔄 Refresh', 'api:open');
  kb.row();
  kb.text('⬅️ Main Menu', 'main:open');
  return kb;
}

function apiPanelText(status: ApiStatus, newKey?: string): string {
  const endpoint = apiBaseUrl();
  const lines = [
    '🔌 *Reseller Product API*',
    '',
    'Use this API to sell shop products from your own website or bot. Orders are delivered from this bot stock and paid from your wallet balance.',
    '',
    `🟢 *Status:* ${status.active ? 'Connected' : 'No active key'}`,
    `💰 *API Balance:* ${money(status.balance)} USDT`,
    `📊 *Total API Orders:* ${status.orders}`,
    `🕶 *Recent Spend:* ${money(status.recentSpent)} USDT`,
    `🔑 *Current Key:* \`${mask(status.keyPrefix)}\``,
    '',
    '*Available actions*',
    '• Product list: `GET /api/products`',
    '• Balance check: `GET /api/balance`',
    '• Place order: `POST /api/order`',
    '',
    '*Endpoint URL*',
    `\`${endpoint}\``,
  ];
  if (newKey) {
    lines.push(
      '',
      '🔐 *Your new API key*',
      `> ${newKey}`,
      '',
      '_Copy it now. For safety, the full key is shown only once._',
    );
  }
  return lines.join('\n');
}

function docsText(): string {
  const endpoint = apiBaseUrl();
  return [
    '📚 *API Documentation*',
    '',
    '*Authentication*',
    'Send your key in one of these ways:',
    '• `Authorization: Bearer YOUR_KEY`',
    '• `x-api-key: YOUR_KEY`',
    '• `?api_key=YOUR_KEY`',
    '',
    '*Product List*',
    `GET \`${endpoint}/products\``,
    '',
    '*Balance*',
    `GET \`${endpoint}/balance\``,
    '',
    '*Place Order*',
    `POST \`${endpoint}/order\``,
    '',
    '*JSON body:*',
    '```json',
    '{ "product_id": 123, "quantity": 1, "request_id": "my-order-001" }',
    '```',
    '',
    'The API returns delivered items in JSON. Wallet balance is deducted only when the order is completed.',
  ].join('\n');
}

async function showApiPanel(ctx: AppCtx, newKey?: string): Promise<void> {
  const status = await getApiStatus(ctx.user.telegram_id);
  const html = renderMdHtml(apiPanelText(status, newKey));
  const reply_markup = panelKeyboard(status);
  if (ctx.callbackQuery) {
    await ctx.editMessageText(html, {
      parse_mode: 'HTML',
      reply_markup,
      link_preview_options: { is_disabled: true },
    });
    return;
  }
  await ctx.reply(html, {
    parse_mode: 'HTML',
    reply_markup,
    link_preview_options: { is_disabled: true },
  });
}

export function registerResellerApi(bot: Composer<AppCtx>): void {
  bot.command(['api', 'apikey'], async (ctx) => {
    await showApiPanel(ctx);
  });

  bot.callbackQuery('api:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showApiPanel(ctx);
  });

  bot.callbackQuery('api:generate', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Generating API key...' });
    const generated = await generateApiKey(ctx.user.telegram_id);
    await showApiPanel(ctx, generated.key);
  });

  bot.callbackQuery('api:disable', async (ctx) => {
    await disableApiKey(ctx.user.telegram_id);
    await ctx.answerCallbackQuery({ text: 'API key disabled.' });
    await showApiPanel(ctx);
  });

  bot.callbackQuery('api:docs', async (ctx) => {
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text('🔌 API Panel', 'api:open')
      .row()
      .text('⬅️ Main Menu', 'main:open');
    await ctx.editMessageText(renderMdHtml(docsText()), {
      parse_mode: 'HTML',
      reply_markup: kb,
      link_preview_options: { is_disabled: true },
    });
  });
}

