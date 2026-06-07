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

const API_KEY_EMOJI_ID = '5287480366330816274';

function money(n: number): string {
  return Number(n).toFixed(2);
}

function mask(prefix: string | null): string {
  return prefix ? `${prefix}••••••••` : '—';
}

function premiumKeyButton(kb: InlineKeyboard, style: 'primary' | 'success' | 'danger' = 'primary'): void {
  kb.icon(API_KEY_EMOJI_ID);
  kb.style(style);
}

function panelKeyboard(status: ApiStatus): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (status.active) {
    kb.text('Regenerate Key', 'api:generate');
    premiumKeyButton(kb, 'primary');
    kb.row();
    kb.text('Disable API', 'api:disable');
    premiumKeyButton(kb, 'danger');
  } else {
    kb.text('Generate New API Key', 'api:generate');
    premiumKeyButton(kb, 'success');
  }
  kb.row();
  kb.text('View API Documentation', 'api:docs');
  premiumKeyButton(kb, 'primary');
  kb.row();
  kb.text('Refresh', 'api:open');
  premiumKeyButton(kb, 'primary');
  kb.row();
  kb.text('Back to Settings', 'profile:open');
  return kb;
}

function apiPanelText(status: ApiStatus, newKey?: string): string {
  const endpoint = apiBaseUrl();
  const lines = [
    '{api_key} *Reseller Product API*',
    '',
    'Connect your own bot, website, or reseller panel to this shop. Orders are delivered from live stock and paid from your wallet balance.',
    '',
    `${status.active ? '{notify_on}' : '{notify_off}'} *Status:* ${status.active ? 'Connected' : 'No active key'}`,
    `{profile_balance} *API Balance:* ${money(status.balance)} USDT`,
    `{stats_orders} *Total API Orders:* ${status.orders}`,
    `{stats_spent} *Recent Spend:* ${money(status.recentSpent)} USDT`,
    `{api_key} *Current Key:* \`${mask(status.keyPrefix)}\``,
    '',
    '*Available actions*',
    '{orders_title} Product list: `GET /api/products`',
    '{profile_balance} Balance check: `GET /api/balance`',
    '{deposits_wallet} Place order: `POST /api/order`',
    '',
    '*Endpoint URL*',
    `\`${endpoint}\``,
  ];
  if (newKey) {
    lines.push(
      '',
      '{api_key} *Your new API key*',
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
    '{api_key} *API Documentation*',
    '',
    '*Authentication*',
    'Send your key in one of these ways:',
    '{api_key} `Authorization: Bearer YOUR_KEY`',
    '{api_key} `x-api-key: YOUR_KEY`',
    '{api_key} `?api_key=YOUR_KEY`',
    '',
    '{orders_title} *Product List*',
    `GET \`${endpoint}/products\``,
    '',
    '{profile_balance} *Balance*',
    `GET \`${endpoint}/balance\``,
    '',
    '{deposits_wallet} *Place Order*',
    `POST \`${endpoint}/order\``,
    '',
    '*JSON body:*',
    '`{ "product_id": 123, "quantity": 1, "request_id": "my-order-001" }`',
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
    const kb = new InlineKeyboard();
    kb.text('API Panel', 'api:open');
    premiumKeyButton(kb, 'primary');
    kb.row();
    kb.text('Back to Settings', 'profile:open');
    await ctx.editMessageText(renderMdHtml(docsText()), {
      parse_mode: 'HTML',
      reply_markup: kb,
      link_preview_options: { is_disabled: true },
    });
  });
}
