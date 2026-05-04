/**
 * Admin dashboard — fully button-driven.
 *
 * Entry: /admin (admin only). Everything else happens via inline
 * buttons + multi-step text input collected through `session.adminFlow`.
 */
import { Composer, InlineKeyboard, InputFile, type MiddlewareFn } from 'grammy';
import {
  addCategory,
  addPaymentMethod,
  addProduct,
  adjustBalance,
  recordLedger,
  deleteCategory,
  deletePaymentMethod,
  deleteProduct,
  demoteAdmin,
  findAdjacentProduct,
  findUserById,
  findUserByUsername,
  getDailyRevenue,
  getDeposit,
  getProductSales,
  getStats,
  getUserOrderSummary,
  isAdmin,
  listAllCategories,
  listAllProducts,
  listPaymentMethods,
  listPendingDeposits,
  listRecentUsers,
  listUsersForAnnouncement,
  promoteAdmin,
  banUser,
  unbanUser,
  listUserPriceOverrides,
  listAllPriceOverrides,
  setUserProductPrice,
  clearUserProductPrice,
  clearAllUserPriceOverrides,
  getProduct,
  setDepositAmount,
  setDepositStatus,
  setProductActive,
  swapProductOrder,
  createGiftCode,
  deleteGiftCode,
  listGiftCodes,
  countGiftCodeRedemptions,
  addPromo,
  listPromos,
  listAllPromos,
  getPromo,
  getPromoImpact,
  updatePromo,
  deletePromo,
  updateProduct,
  addProductItems,
  countAvailableProductItems,
  listAvailableProductItems,
  clearProductItems,
} from '../../db/queries.js';
import * as cache from '../../services/cache.js';
import { credit } from '../../services/wallet.js';
import {
  setColor,
  setEmoji,
  setText,
  refreshSettings,
  setChannelUrl,
  clearChannelUrl,
  getChannelUrl,
  getEmoji,
  getButtonColor,
  getButtonIcon,
  setButtonIcon,
  clearButtonIcon,
  setBotTutorialField,
  getBotTutorial,
  type BotTutorial,
  getColorPrefix,
  setColorPrefix,
  clearColorPrefix,
  getCategoryColor,
  setCategoryColor,
  getCategoryDefaultColor,
  setCategoryDefaultColor,
} from '../../services/settings.js';
import { renderMdHtml } from '../../services/premium.js';
import { t as translate } from '../../i18n/index.js';
import * as adminLog from '../../services/adminLog.js';
import { describeMailerStatus, sendWelcomeEmail } from '../../services/mailer.js';
import type { ColorMode } from '../../../config/index.js';
import { BUTTON_KEYS, COLOR_PREFIX, EMOJI, colorModeToStyle } from '../../../config/index.js';
import type { AppCtx } from '../../middleware/user.js';
import { logger } from '../../logger.js';
import type { DBUser, DBPromo } from '../../types.js';

export const adminBot = new Composer<AppCtx>();

/**
 * Gate that ONLY blocks explicit admin invocations (commands and
 * `adm:` callback queries) for non-admins. Other updates pass through
 * untouched so non-admin users never see the "⛔ Admin only" reply
 * for ordinary chat messages.
 */
const requireAdmin: MiddlewareFn<AppCtx> = async (ctx, next) => {
  if (!ctx.from || !(await isAdmin(ctx.from.id))) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: '⛔ Admin only.', show_alert: true });
    } else {
      await ctx.reply('⛔ Admin only.');
    }
    return;
  }
  return next();
};

// Apply requireAdmin only to admin entry points.
adminBot.callbackQuery(/^adm:/, requireAdmin, async (_ctx, next) => next());
adminBot.command(
  ['admin', 'settext', 'setcolor', 'setemoji', 'clearcache', 'reload', 'mailerstatus', 'testemail', 'promo'],
  requireAdmin,
  async (_ctx, next) => next(),
);

const PER_PAGE = 8;
const ROOT_TEXT = '🛠 *Admin Panel*\n\nTap a section to manage it.';

function rootMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📦 Products', 'adm:prod')
    .text('🗂 Categories', 'adm:cat')
    .row()
    .text('💳 Payment Methods', 'adm:pay')
    .text('💰 Top-Up Requests', 'adm:dep')
    .row()
    .text('👥 Users', 'adm:usr:0')
    .text('📣 Broadcast', 'adm:ann')
    .row()
    .text('🎨 Customize', 'adm:cust')
    .text('⚙️ Bot Settings', 'adm:bot')
    .row()
    .text('🤖 AI Setup', 'adm:ai')
    .text('📊 Stats', 'adm:stats')
    .row()
    .text('🎁 Gift Codes', 'adm:gift')
    .text('💎 Custom Prices', 'adm:price')
    .row()
    .text('💸 Promos', 'adm:promo')
    .row()
    .text('🏠 Main Menu', 'adm:close');
}

const backRow = (kb: InlineKeyboard) => kb.row().text('⬅️ Back', 'adm:root');

/** Tiny HTML-entity escape for use inside `parse_mode: 'HTML'` strings. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

async function showRoot(ctx: AppCtx, asReply = false): Promise<void> {
  ctx.session.adminFlow = undefined;
  if (asReply || !ctx.callbackQuery) {
    await ctx.reply(ROOT_TEXT, { parse_mode: 'Markdown', reply_markup: rootMenu() });
  } else {
    await ctx.editMessageText(ROOT_TEXT, { parse_mode: 'Markdown', reply_markup: rootMenu() });
  }
}

adminBot.command('admin', (ctx) => showRoot(ctx, true));

adminBot.callbackQuery('adm:root', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showRoot(ctx);
});

adminBot.callbackQuery('adm:close', async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    await ctx.deleteMessage();
  } catch {
    /* ignore */
  }
  // Re-fire /start so the admin lands on the regular Main Menu — that's
  // the expected behaviour of the new "🏠 Main Menu" button on the
  // panel root, replacing the old "❌ Close".
  await ctx.api.sendMessage(ctx.chat?.id ?? ctx.from!.id, '/start');
});

// ---------- Bot Settings ----------
// One-stop hub for bot-wide toggles + URLs the admin can edit at
// runtime: channel link, email PDF URL, admin contact link, plus the
// reload settings shortcut. We deliberately keep this lean for now —
// each item edits a single key in the `settings` table.
adminBot.callbackQuery('adm:bot', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = undefined;
  const kb = new InlineKeyboard()
    .text('🔗 Set Channel URL', 'adm:cust:channel')
    .row()
    .text('📄 Set Email PDF URL', 'adm:bot:emailpdf')
    .row()
    .text('💬 Set Admin Contact URL', 'adm:bot:contact')
    .row()
    .text('📘 Edit Bot Tutorial', 'adm:bot:tut')
    .row()
    .text('🔁 Reload Settings', 'adm:reload');
  backRow(kb);
  await ctx.editMessageText('⚙️ *Bot Settings*\n\nGeneral configuration knobs.', {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
});

// Bot Tutorial editor — surfaces the same fields as the legacy
// `/setbottutorial` slash command, but as one-tap buttons that arm
// adminFlow capture for the next message.
async function showBotTutorialEditor(ctx: AppCtx): Promise<void> {
  const t = await getBotTutorial();
  const lines = [
    '📘 *Bot Tutorial*',
    '',
    `*Text:* ${t.text ? '`set`' : '_unset_'}`,
    `*File:* ${t.file_id ? '`' + (t.file_type ?? 'file') + '`' : '_unset_'}`,
    `*URL:* ${t.url ? '`' + t.url + '`' : '_unset_'}`,
    '',
    '_Tap a button to edit. The bot will capture your next message of the appropriate kind._',
  ];
  const kb = new InlineKeyboard()
    .text('📝 Set Text', 'adm:bot:tut:settxt')
    .text('🧹 Clear Text', 'adm:bot:tut:clrtxt')
    .row()
    .text('🎞 Set File', 'adm:bot:tut:setfile')
    .text('🧹 Clear File', 'adm:bot:tut:clrfile')
    .row()
    .text('🔗 Set URL', 'adm:bot:tut:seturl')
    .text('🧹 Clear URL', 'adm:bot:tut:clrurl')
    .row();
  backRow(kb);
  await ctx.editMessageText(lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

adminBot.callbackQuery('adm:bot:tut', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = undefined;
  await showBotTutorialEditor(ctx);
});

adminBot.callbackQuery('adm:bot:tut:settxt', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = { type: 'edit_bot_tutorial_text', step: 'text', data: {} };
  await ctx.reply('📝 Send the *Bot Tutorial* text now.', { parse_mode: 'Markdown' });
});

adminBot.callbackQuery('adm:bot:tut:setfile', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = { type: 'edit_bot_tutorial_file', step: 'file', data: {} };
  await ctx.reply(
    '🎞 Send a photo, video, or document — it will be re-sent inside the Bot Tutorial.',
    { parse_mode: 'Markdown' },
  );
});

adminBot.callbackQuery('adm:bot:tut:seturl', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = { type: 'edit_bot_tutorial_url', step: 'url', data: {} };
  await ctx.reply('🔗 Send the tutorial *URL* (`http://` or `https://`).', {
    parse_mode: 'Markdown',
  });
});

adminBot.callbackQuery('adm:bot:tut:clrtxt', async (ctx) => {
  await setBotTutorialField('text', null, ctx.from!.id);
  await ctx.answerCallbackQuery({ text: 'Cleared' });
  await showBotTutorialEditor(ctx);
});

adminBot.callbackQuery('adm:bot:tut:clrfile', async (ctx) => {
  await setBotTutorialField('file_id', null, ctx.from!.id);
  await setBotTutorialField('file_type', null, ctx.from!.id);
  await ctx.answerCallbackQuery({ text: 'Cleared' });
  await showBotTutorialEditor(ctx);
});

adminBot.callbackQuery('adm:bot:tut:clrurl', async (ctx) => {
  await setBotTutorialField('url', null, ctx.from!.id);
  await ctx.answerCallbackQuery({ text: 'Cleared' });
  await showBotTutorialEditor(ctx);
});

adminBot.callbackQuery('adm:bot:emailpdf', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = { type: 'set_text', step: 'value', data: { key: 'email.pdf_url' } };
  await ctx.editMessageText(
    '📄 *Set Email PDF URL*\n\nSend a public URL to a PDF (or `-` to clear). The Why Email "Know More" button becomes a URL button when this is set.',
    { parse_mode: 'Markdown', reply_markup: backRow(new InlineKeyboard()) },
  );
});

adminBot.callbackQuery('adm:bot:contact', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = { type: 'set_text', step: 'value', data: { key: 'admin.contact_url' } };
  await ctx.editMessageText(
    '💬 *Set Admin Contact URL*\n\nSend a t.me URL the "Buy Code" / contact-admin buttons should open.',
    { parse_mode: 'Markdown', reply_markup: backRow(new InlineKeyboard()) },
  );
});

// ---------- AI Setup ----------
adminBot.callbackQuery('adm:ai', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = undefined;
  const kb = new InlineKeyboard()
    .text('🔑 Set AI API Key', 'adm:ai:key')
    .row()
    .text('💬 Set AI Prompt', 'adm:ai:prompt');
  backRow(kb);
  await ctx.editMessageText(
    [
      '🤖 *AI Setup*',
      '',
      'Configure the assistant used by the AI Support flow.',
      '',
      'Provider is auto-detected from the API-key shape:',
      '• `AIza…` → Google AI Studio (Gemini)',
      '• `sk-…`  → OpenAI Chat Completions',
      '',
      '_The key you paste here overrides `OPENAI_API_KEY` from the deployment env._',
    ].join('\n'),
    { parse_mode: 'Markdown', reply_markup: kb },
  );
});

adminBot.callbackQuery('adm:ai:key', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = { type: 'set_text', step: 'value', data: { key: 'ai.api_key' } };
  await ctx.editMessageText('🔑 *Set AI API Key*\n\nSend the key (or `-` to clear).', {
    parse_mode: 'Markdown',
    reply_markup: backRow(new InlineKeyboard()),
  });
});

adminBot.callbackQuery('adm:ai:prompt', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = { type: 'set_text', step: 'value', data: { key: 'ai.system_prompt' } };
  await ctx.editMessageText(
    '💬 *Set AI Prompt*\n\nSend the system prompt (or `-` to clear).',
    { parse_mode: 'Markdown', reply_markup: backRow(new InlineKeyboard()) },
  );
});

// ---------- Gift Codes ----------
adminBot.callbackQuery('adm:gift', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = undefined;
  const kb = new InlineKeyboard()
    .text('➕ Create Code', 'adm:gift:add')
    .text('📋 List & Manage', 'adm:gift:list');
  backRow(kb);
  await ctx.editMessageText(
    '🎁 *Gift Codes*\n\nIssue or manage one-time/limited gift codes that users can redeem from Settings → Redeem Gift Code.',
    { parse_mode: 'Markdown', reply_markup: kb },
  );
});

adminBot.callbackQuery('adm:gift:add', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = { type: 'add_gift', step: 'code', data: {} };
  // Use HTML so the (3–40 chars, A–Z 0–9 _ -) hint renders verbatim —
  // an unmatched `_` under Markdown V1 used to make Telegram reject
  // editMessageText, leaving the screen stuck on the previous menu.
  await ctx.editMessageText(
    '🎁 <b>Create Gift Code</b>\n\nSend the code — 3 to 40 chars (letters, digits, <code>_</code> or <code>-</code>). Or <code>/cancel</code>.',
    { parse_mode: 'HTML', reply_markup: backRow(new InlineKeyboard()) },
  );
});

adminBot.callbackQuery('adm:gift:list', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showGiftCodeList(ctx);
});

async function showGiftCodeList(ctx: AppCtx): Promise<void> {
  const codes = await listGiftCodes();
  if (codes.length === 0) {
    await ctx.editMessageText('No gift codes yet.', {
      reply_markup: backRow(new InlineKeyboard()),
    });
    return;
  }
  const lines = ['🎁 *Gift Codes*', ''];
  const kb = new InlineKeyboard();
  for (const c of codes) {
    const used = await countGiftCodeRedemptions(c.code);
    const cap = c.max_redemptions != null ? `/${c.max_redemptions}` : '';
    const exp = c.expires_at
      ? ` · exp ${new Date(c.expires_at).toISOString().slice(0, 10)}`
      : '';
    lines.push(`\`${c.code}\` · ${c.amount} USDT · used ${used}${cap}${exp}`);
    kb.text(`🗑 ${c.code}`.slice(0, 60), `adm:gift:del:${c.code}`).row();
  }
  backRow(kb);
  await ctx.editMessageText(lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

adminBot.callbackQuery(/^adm:gift:del:(.+)$/, async (ctx) => {
  const code = ctx.match[1] ?? '';
  if (code) await deleteGiftCode(code);
  await ctx.answerCallbackQuery({ text: `Deleted ${code}` });
  await showGiftCodeList(ctx);
});

// ---------- Stats ----------
//
// Renders the deep stats dashboard:
//   1. Top-line counters (users, products, orders, revenue, ...)
//   2. Top 5 sellers by revenue
//   3. Per-product breakdown (units, revenue, stock left, last sale)
//   4. Daily revenue trend for the last 7 days (incl. zero-rev days)
//
// Telegram caps message text at 4096 chars; very large catalogs
// would otherwise truncate mid-row, so we cap the per-product list
// at the first ~30 products and truncate the entire body to 3950
// chars as a final guard.
function escapeMd(s: string): string {
  // Markdown v1 only treats `_*\`[` specially. We keep this minimal
  // because the rest of the admin UI also uses Markdown v1.
  return s.replace(/([_*`[\]])/g, '\\$1');
}

adminBot.callbackQuery('adm:stats', async (ctx) => {
  await ctx.answerCallbackQuery();
  const [s, productSales, daily] = await Promise.all([
    getStats(),
    getProductSales(50),
    getDailyRevenue(7),
  ]);
  const lines: string[] = [];
  lines.push('📊 *Stats*');
  lines.push('');
  lines.push(`👥 Users: *${s.users}*`);
  lines.push(`📦 Active products: *${s.active_products}*`);
  lines.push(`🗂 Active categories: *${s.active_categories}*`);
  lines.push(`🧾 Total orders: *${s.orders}*`);
  lines.push(`💰 Total revenue: *$${s.revenue.toFixed(2)}*`);
  lines.push(`💳 Pending deposits: *${s.pending_deposits}*`);

  if (productSales.length > 0) {
    lines.push('');
    lines.push('🏆 *Top Sellers (by revenue)*');
    productSales.slice(0, 5).forEach((r, i) => {
      const medal = ['🥇', '🥈', '🥉', '4.', '5.'][i] ?? `${i + 1}.`;
      lines.push(
        `${medal} ${escapeMd(r.product_name)} — *${r.units_sold}* units · *$${r.revenue.toFixed(
          2,
        )}*`,
      );
    });
  }

  if (productSales.length > 0) {
    lines.push('');
    lines.push('📈 *All Products — Sales Breakdown*');
    const cap = 30;
    productSales.slice(0, cap).forEach((r) => {
      const stockStr =
        r.stock_left !== null ? `stock *${r.stock_left}*` : '_deleted_';
      const lastStr = r.last_sold_at
        ? ` · last *${r.last_sold_at.slice(0, 10)}*`
        : '';
      lines.push(
        `• ${escapeMd(r.product_name)}: *${r.units_sold}*u · *$${r.revenue.toFixed(
          2,
        )}* · ${stockStr}${lastStr}`,
      );
    });
    if (productSales.length > cap) {
      lines.push(`_…and ${productSales.length - cap} more (download PDF for full list)_`);
    }
  }

  lines.push('');
  lines.push('📅 *Last 7 Days*');
  for (const d of daily) {
    lines.push(`\`${d.date}\` — *$${d.revenue.toFixed(2)}* (${d.orders} orders)`);
  }
  // Weekly summary at the foot of the trend section.
  const weekRev = daily.reduce((acc, d) => acc + d.revenue, 0);
  const weekOrders = daily.reduce((acc, d) => acc + d.orders, 0);
  lines.push(
    `_7-day total:_ *$${weekRev.toFixed(2)}* across *${weekOrders}* orders`,
  );

  let text = lines.join('\n');
  if (text.length > 3950) text = text.slice(0, 3900) + '\n\n_…(truncated)_';
  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: backRow(new InlineKeyboard()),
  });
});

// ---------- Reload / Clear cache ----------
adminBot.callbackQuery('adm:reload', async (ctx) => {
  await refreshSettings();
  cache.clearAll();
  await ctx.answerCallbackQuery({ text: '🔁 Settings reloaded.' });
  await showRoot(ctx);
});

adminBot.callbackQuery('adm:clr', async (ctx) => {
  cache.clearAll();
  await ctx.answerCallbackQuery({ text: '🧹 Cache cleared.' });
  await showRoot(ctx);
});

// ---------- Categories ----------
adminBot.callbackQuery('adm:cat', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = undefined;
  const kb = new InlineKeyboard()
    .text('➕ Add Category', 'adm:cat:add')
    .text('📋 List & Manage', 'adm:cat:list');
  backRow(kb);
  await ctx.editMessageText('🗂 *Categories*', { parse_mode: 'Markdown', reply_markup: kb });
});

adminBot.callbackQuery('adm:cat:add', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = { type: 'add_category', step: 'name', data: {} };
  await ctx.editMessageText(
    '🗂 *Add Category*\n\nSend the category *name* (or `/cancel`).',
    { parse_mode: 'Markdown', reply_markup: backRow(new InlineKeyboard()) },
  );
});

adminBot.callbackQuery('adm:cat:list', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showCategoryList(ctx);
});

async function showCategoryList(ctx: AppCtx): Promise<void> {
  const cats = await listAllCategories();
  if (cats.length === 0) {
    await ctx.editMessageText('No categories yet.', {
      reply_markup: backRow(new InlineKeyboard()),
    });
    return;
  }
  const lines = ['🗂 *Categories*', ''];
  const kb = new InlineKeyboard();
  for (const c of cats) {
    lines.push(`#${c.id}  ${c.emoji ?? '📁'} ${c.name}${c.active ? '' : '  _(hidden)_'}`);
    kb.text(`🗑 #${c.id} ${c.name}`.slice(0, 60), `adm:cat:del:${c.id}`);
    const style = colorModeToStyle(getCategoryColor(c.id));
    if (style !== undefined) kb.style(style);
    kb.row();
  }
  backRow(kb);
  await ctx.editMessageText(lines.join('\n'), { parse_mode: 'Markdown', reply_markup: kb });
}

adminBot.callbackQuery(/^adm:cat:del:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  await deleteCategory(id);
  cache.del('cats');
  await ctx.answerCallbackQuery({ text: `Deleted #${id}` });
  await showCategoryList(ctx);
});

// ---------- Products ----------
adminBot.callbackQuery('adm:prod', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = undefined;
  const kb = new InlineKeyboard()
    .text('➕ Add Product', 'adm:prod:add')
    .text('📋 List & Manage', 'adm:prod:list:0');
  backRow(kb);
  await ctx.editMessageText('📦 *Products*', { parse_mode: 'Markdown', reply_markup: kb });
});

adminBot.callbackQuery('adm:prod:add', async (ctx) => {
  await ctx.answerCallbackQuery();
  const cats = await listAllCategories();
  if (cats.length === 0) {
    await ctx.editMessageText('⚠️ No categories yet. Add a category first.', {
      reply_markup: backRow(new InlineKeyboard()),
    });
    return;
  }
  const kb = new InlineKeyboard();
  cats.forEach((c, i) => {
    kb.text(`${c.emoji ?? '📁'} ${c.name}`, `adm:prod:add:cat:${c.id}`);
    // Apply the per-category Bot API 9.4 button style configured via
    // /admin → Customize → Set Color → 📂 Product Categories. Falls
    // back to the category-default color, then to undefined ('none')
    // so the button stays unstyled when nothing has been picked.
    const style = colorModeToStyle(getCategoryColor(c.id));
    if (style !== undefined) kb.style(style);
    if (i % 2 === 1) kb.row();
  });
  backRow(kb);
  await ctx.editMessageText('📦 *Add Product*\n\nPick a category:', {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
});

adminBot.callbackQuery(/^adm:prod:add:cat:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const category_id = Number(ctx.match[1]);
  ctx.session.adminFlow = { type: 'add_product', step: 'name', data: { category_id } };
  await ctx.editMessageText(
    `📦 *Add Product* (cat #${category_id})\n\nSend the product *name* (or \`/cancel\`).`,
    { parse_mode: 'Markdown', reply_markup: backRow(new InlineKeyboard()) },
  );
});

adminBot.callbackQuery(/^adm:prod:list:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showProductList(ctx, Number(ctx.match[1]));
});

async function showProductList(ctx: AppCtx, page: number): Promise<void> {
  const { rows, total } = await listAllProducts(page, PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (rows.length === 0) {
    await ctx.editMessageText('No products yet.', {
      reply_markup: backRow(new InlineKeyboard()),
    });
    return;
  }
  const lines = [
    `📦 *Products* — page ${page + 1}/${totalPages}`,
    '',
    '_Tap ↑ / ↓ to reorder. Reordering works across page boundaries._',
    '',
  ];
  const kb = new InlineKeyboard();
  for (const p of rows) {
    const flag = p.active ? '🟢' : '⚪️';
    lines.push(`${flag} #${p.id}  ${p.name} — $${p.price}  (stock ${p.stock})`);
    kb.text(`↑ #${p.id}`, `adm:prod:up:${p.id}:${page}`)
      .text(`↓ #${p.id}`, `adm:prod:dn:${p.id}:${page}`)
      .text(`✏️ Edit #${p.id}`, `adm:prod:edit:${p.id}:${page}`)
      .row();
    kb.text(p.active ? `👁 Hide #${p.id}` : `👁 Show #${p.id}`, `adm:prod:tog:${p.id}:${page}`)
      .text(`🗑 #${p.id}`, `adm:prod:del:${p.id}:${page}`)
      .row();
  }
  if (page > 0) kb.text('◀️ Prev', `adm:prod:list:${page - 1}`);
  if (page + 1 < totalPages) kb.text('Next ▶️', `adm:prod:list:${page + 1}`);
  backRow(kb);
  await ctx.editMessageText(lines.join('\n'), { parse_mode: 'Markdown', reply_markup: kb });
}

adminBot.callbackQuery(/^adm:prod:del:(\d+):(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  await deleteProduct(id);
  cache.del('cats');
  await ctx.answerCallbackQuery({ text: `Deleted product #${id}` });
  await showProductList(ctx, Number(ctx.match[2]));
});

adminBot.callbackQuery(/^adm:prod:tog:(\d+):(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  const { rows } = await listAllProducts(0, 1000);
  const p = rows.find((x) => x.id === id);
  if (p) await setProductActive(id, !p.active);
  await ctx.answerCallbackQuery({ text: 'Visibility toggled' });
  await showProductList(ctx, Number(ctx.match[2]));
});

// Move a product up / down in the admin sort order. Works across
// page boundaries — swapping with a row on a different page just
// changes the (sort_order, id) tuple so the affected rows shift
// when the list is re-rendered. The swap is silently a no-op when
// the product is already at the boundary (top of page 0 going up,
// or last row of the last page going down).
adminBot.callbackQuery(/^adm:prod:(up|dn):(\d+):(\d+)$/, async (ctx) => {
  const direction: 'up' | 'down' = ctx.match[1] === 'up' ? 'up' : 'down';
  const id = Number(ctx.match[2]);
  const page = Number(ctx.match[3]);
  const cur = await listAllProducts(0, 1000).then(({ rows }) =>
    rows.find((r) => r.id === id),
  );
  if (!cur) {
    await ctx.answerCallbackQuery({ text: 'Product no longer exists' });
    await showProductList(ctx, page);
    return;
  }
  const neighbour = await findAdjacentProduct(id, direction);
  if (!neighbour) {
    await ctx.answerCallbackQuery({
      text: direction === 'up' ? 'Already at top' : 'Already at bottom',
    });
    return;
  }
  await swapProductOrder(
    { id: cur.id, sort_order: cur.sort_order },
    { id: neighbour.id, sort_order: neighbour.sort_order },
  );
  cache.del('cats');
  await ctx.answerCallbackQuery({
    text: direction === 'up' ? '↑ Moved up' : '↓ Moved down',
  });
  await showProductList(ctx, page);
});

// ---------- Per-product inline editor ----------
//
// Surfaced from the product list as `✏️ Edit #N`. Renders a card
// with every per-product asset (premium emoji, note, view-note file,
// tutorial, items pool, unlimited-stock toggle, base price/stock/name)
// as a button so the admin never has to copy slash commands.
//
// Each button either mutates the row directly (toggles, clears) or
// arms a one-shot adminFlow that captures the next message and
// applies the patch — e.g. tap "Set Premium Emoji", send a 🎬 premium
// emoji message in chat, the bot reads `custom_emoji_id` and saves it.
async function showProductEditor(
  ctx: AppCtx,
  product_id: number,
  page: number,
): Promise<void> {
  const p = await getProduct(product_id);
  if (!p) {
    await ctx.editMessageText('⚠️ Product not found.', {
      reply_markup: backRow(new InlineKeyboard()),
    });
    return;
  }
  const itemsCount = await countAvailableProductItems(product_id);
  const stockCell = p.unlimited_stock ? '∞' : String(p.stock);
  const lines = [
    `✏️ *Edit Product #${p.id}*`,
    '',
    `*Name:* ${p.name}`,
    `*Price:* ${Number(p.price).toFixed(2)} USDT`,
    `*Stock:* ${stockCell}`,
    `*Premium Emoji:* ${p.emoji_id ? '`set`' : '_unset_'}`,
    `*Note Text:* ${p.note ? '`set`' : '_unset_'}`,
    `*Tutorial Text:* ${p.tutorial_text ? '`set`' : '_unset_'}`,
    `*Tutorial File:* ${p.tutorial_file_id ? '`' + p.tutorial_file_type + '`' : '_unset_'}`,
    `*Tutorial URL:* ${p.tutorial_url ? '`' + p.tutorial_url + '`' : '_unset_'}`,
    `*Items pool:* ${itemsCount} unconsumed`,
    '',
    '_Tap a button to edit. For "Set Premium Emoji" / "Set Tutorial File", the bot will capture your next message of the appropriate kind._',
  ];
  const kb = new InlineKeyboard();
  kb.text('🎬 Set Premium Emoji', `adm:prod:emoji:set:${p.id}:${page}`)
    .text('🧹 Clear Emoji', `adm:prod:emoji:clr:${p.id}:${page}`)
    .row();
  kb.text('📝 Set Note Text', `adm:prod:note:settxt:${p.id}:${page}`)
    .text('🧹 Clear Note', `adm:prod:note:clr:${p.id}:${page}`)
    .row();
  kb.text('📘 Tutorial Text', `adm:prod:tut:settxt:${p.id}:${page}`)
    .text('🎞 Tutorial File', `adm:prod:tut:setfile:${p.id}:${page}`)
    .row();
  // Per-field clear row matches the Bot Tutorial editor: bot-owner
  // explicitly asked for a "Clear File" alongside "Set File" so the
  // attachment can be removed without nuking the rest of the
  // tutorial. `Clear Tutorial` (everything) stays as a separate row
  // for the all-at-once nuke path.
  kb.text('🧹 Clear File', `adm:prod:tut:clrfile:${p.id}:${page}`)
    .text('🔗 Tutorial URL', `adm:prod:tut:seturl:${p.id}:${page}`)
    .row();
  kb.text('🧹 Clear Tutorial', `adm:prod:tut:clr:${p.id}:${page}`).row();
  kb.text(`📦 Add Items (pool: ${itemsCount})`, `adm:prod:items:add:${p.id}:${page}`)
    .text('🧹 Clear Pool', `adm:prod:items:clr:${p.id}:${page}`)
    .row();
  // Stock Inspection — bot-owner asked for a way to audit remaining
  // accounts / links / codes per product. Disabled when the pool is
  // empty so the admin doesn't tap into a dead end (we still ack the
  // tap with a popup explaining the empty state).
  kb.text(
    `🔎 View Stock Items (${itemsCount})`,
    `adm:prod:items:view:${p.id}:${page}:0`,
  ).row();
  kb.text(
    p.unlimited_stock ? '♾ Unlimited: ON' : '♾ Unlimited: OFF',
    `adm:prod:unl:tog:${p.id}:${page}`,
  ).row();
  kb.text('💰 Edit Price', `adm:prod:price:set:${p.id}:${page}`)
    .text('🔢 Edit Stock', `adm:prod:stock:set:${p.id}:${page}`)
    .text('🅰️ Edit Name', `adm:prod:name:set:${p.id}:${page}`)
    .row();
  kb.text('⬅️ Back to list', `adm:prod:list:${page}`);
  await ctx.editMessageText(lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

adminBot.callbackQuery(/^adm:prod:edit:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showProductEditor(ctx, Number(ctx.match[1]), Number(ctx.match[2]));
});

// --- Premium emoji ---
adminBot.callbackQuery(/^adm:prod:emoji:set:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const product_id = Number(ctx.match[1]);
  const page = Number(ctx.match[2]);
  ctx.session.adminFlow = {
    type: 'edit_product_emoji',
    step: 'premium',
    data: { product_id, page },
  };
  await ctx.reply(
    '🎬 Send a single *premium* emoji as your next message — the bot will read its `custom_emoji_id` and save it.',
    { parse_mode: 'Markdown' },
  );
});

adminBot.callbackQuery(/^adm:prod:emoji:clr:(\d+):(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  await updateProduct(id, { emoji_id: null });
  await ctx.answerCallbackQuery({ text: 'Cleared' });
  await showProductEditor(ctx, id, Number(ctx.match[2]));
});

// --- Note text ---
adminBot.callbackQuery(/^adm:prod:note:settxt:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const product_id = Number(ctx.match[1]);
  const page = Number(ctx.match[2]);
  ctx.session.adminFlow = {
    type: 'edit_product_note_text',
    step: 'text',
    data: { product_id, page },
  };
  await ctx.reply(
    '📝 Send the *View Note* text now (any premium emojis you include are preserved). Send `/cancel` to abort.',
    { parse_mode: 'Markdown' },
  );
});

adminBot.callbackQuery(/^adm:prod:note:clr:(\d+):(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  await updateProduct(id, { note: null });
  await ctx.answerCallbackQuery({ text: 'Cleared' });
  await showProductEditor(ctx, id, Number(ctx.match[2]));
});

// --- Tutorial text/file/url ---
adminBot.callbackQuery(/^adm:prod:tut:settxt:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const product_id = Number(ctx.match[1]);
  const page = Number(ctx.match[2]);
  ctx.session.adminFlow = {
    type: 'edit_product_tutorial_text',
    step: 'text',
    data: { product_id, page },
  };
  await ctx.reply(
    '📘 Send the *Using Method* tutorial text. Premium emojis preserved. Send `/cancel` to abort.',
    { parse_mode: 'Markdown' },
  );
});

adminBot.callbackQuery(/^adm:prod:tut:setfile:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const product_id = Number(ctx.match[1]);
  const page = Number(ctx.match[2]);
  ctx.session.adminFlow = {
    type: 'edit_product_tutorial_file',
    step: 'file',
    data: { product_id, page },
  };
  await ctx.reply(
    '🎞 Send a photo, video, or document as your next message — it becomes the tutorial attachment.',
    { parse_mode: 'Markdown' },
  );
});

adminBot.callbackQuery(/^adm:prod:tut:seturl:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const product_id = Number(ctx.match[1]);
  const page = Number(ctx.match[2]);
  ctx.session.adminFlow = {
    type: 'edit_product_tutorial_url',
    step: 'url',
    data: { product_id, page },
  };
  await ctx.reply(
    '🔗 Send the tutorial *URL* as your next message (must start with `http://` or `https://`).',
    { parse_mode: 'Markdown' },
  );
});

adminBot.callbackQuery(/^adm:prod:tut:clr:(\d+):(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  await updateProduct(id, {
    tutorial_text: null,
    tutorial_file_id: null,
    tutorial_file_type: null,
    tutorial_url: null,
  });
  await ctx.answerCallbackQuery({ text: 'Tutorial cleared' });
  await showProductEditor(ctx, id, Number(ctx.match[2]));
});

// Clear ONLY the per-product tutorial file attachment. Mirrors the
// Bot Tutorial editor's `adm:bot:tut:clrfile`. Bot-owner asked for
// this so the admin can swap the Using Method file without re-typing
// the tutorial body or re-pasting the URL.
adminBot.callbackQuery(/^adm:prod:tut:clrfile:(\d+):(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  await updateProduct(id, {
    tutorial_file_id: null,
    tutorial_file_type: null,
  });
  await ctx.answerCallbackQuery({ text: 'Tutorial file cleared' });
  await showProductEditor(ctx, id, Number(ctx.match[2]));
});

// --- Items pool ---
adminBot.callbackQuery(/^adm:prod:items:add:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const product_id = Number(ctx.match[1]);
  const page = Number(ctx.match[2]);
  ctx.session.adminFlow = {
    type: 'edit_product_items',
    step: 'items',
    data: { product_id, page },
  };
  await ctx.reply(
    '📦 Send the deliverables as your next message — *one per line*.\n\nExample:\n```\nemail1@example.com|password123\nemail2@example.com|password456\nhttps://account-link/...\n```',
    { parse_mode: 'Markdown' },
  );
});

adminBot.callbackQuery(/^adm:prod:items:clr:(\d+):(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  await clearProductItems(id);
  await ctx.answerCallbackQuery({ text: 'Pool cleared' });
  await showProductEditor(ctx, id, Number(ctx.match[2]));
});

// --- Stock Inspection screen ---
// Shows the unconsumed items in the per-product pool, paginated 20
// at a time. Each row is rendered inside a Markdown blockquote so
// long account/credential strings stay visually separated; payloads
// are escaped with backticks so a stray `*` / `_` / `[` in a
// password doesn't break parsing.
const STOCK_PAGE_SIZE = 20;
async function showStockInspectionPage(
  ctx: AppCtx,
  product_id: number,
  productPage: number,
  itemsPage: number,
): Promise<void> {
  const product = await getProduct(product_id);
  if (!product) {
    await ctx.answerCallbackQuery({ text: 'Product not found', show_alert: true });
    return;
  }
  const items = await listAvailableProductItems(product_id, 1000);
  const total = items.length;
  if (total === 0) {
    await ctx.answerCallbackQuery({ text: 'Pool is empty.', show_alert: true });
    return;
  }
  const pageCount = Math.max(1, Math.ceil(total / STOCK_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(itemsPage, pageCount - 1));
  const slice = items.slice(
    safePage * STOCK_PAGE_SIZE,
    safePage * STOCK_PAGE_SIZE + STOCK_PAGE_SIZE,
  );
  const lines: string[] = [
    `🔎 *Stock Inspection — ${product.name}*`,
    '',
    `*Remaining items:* \`${total}\``,
    `*Page:* \`${safePage + 1} / ${pageCount}\``,
    '',
    'Items below are listed in the order the next purchase will pull from (top = next).',
    '',
  ];
  slice.forEach((row, idx) => {
    const globalIdx = safePage * STOCK_PAGE_SIZE + idx + 1;
    // Truncate very long payloads (e.g. wall-of-text proxy creds) so
    // the admin's screen never explodes; the full payload remains in
    // the DB and is delivered to buyers as-is.
    const trimmed =
      row.payload.length > 220
        ? `${row.payload.slice(0, 220)}…`
        : row.payload;
    // Backtick-escape any backticks inside the payload so it stays
    // inside a Markdown inline-code span.
    const safe = trimmed.replace(/`/g, "'");
    lines.push(`> *${globalIdx}.* \`${safe}\``);
  });
  const kb = new InlineKeyboard();
  if (pageCount > 1) {
    if (safePage > 0) {
      kb.text(
        '⬅️ Prev',
        `adm:prod:items:view:${product_id}:${productPage}:${safePage - 1}`,
      );
    }
    kb.text('🔄', `adm:prod:items:view:${product_id}:${productPage}:${safePage}`);
    if (safePage < pageCount - 1) {
      kb.text(
        'Next ➡️',
        `adm:prod:items:view:${product_id}:${productPage}:${safePage + 1}`,
      );
    }
    kb.row();
  }
  kb.text('⬅️ Back', `adm:prod:edit:${product_id}:${productPage}`);
  await ctx.editMessageText(lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

adminBot.callbackQuery(
  /^adm:prod:items:view:(\d+):(\d+):(\d+)$/,
  async (ctx) => {
    await ctx.answerCallbackQuery();
    await showStockInspectionPage(
      ctx,
      Number(ctx.match[1]),
      Number(ctx.match[2]),
      Number(ctx.match[3]),
    );
  },
);

// --- Unlimited toggle ---
adminBot.callbackQuery(/^adm:prod:unl:tog:(\d+):(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  const p = await getProduct(id);
  if (!p) {
    await ctx.answerCallbackQuery({ text: 'Not found' });
    return;
  }
  await updateProduct(id, { unlimited_stock: !p.unlimited_stock });
  await ctx.answerCallbackQuery({
    text: !p.unlimited_stock ? '♾ Unlimited ON' : 'Unlimited OFF',
  });
  await showProductEditor(ctx, id, Number(ctx.match[2]));
});

// --- Edit base name/price/stock ---
adminBot.callbackQuery(/^adm:prod:price:set:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const product_id = Number(ctx.match[1]);
  const page = Number(ctx.match[2]);
  ctx.session.adminFlow = {
    type: 'edit_product_price',
    step: 'price',
    data: { product_id, page },
  };
  await ctx.reply('💰 Send the new *price* (number, e.g. `9.99`).', { parse_mode: 'Markdown' });
});

adminBot.callbackQuery(/^adm:prod:stock:set:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const product_id = Number(ctx.match[1]);
  const page = Number(ctx.match[2]);
  ctx.session.adminFlow = {
    type: 'edit_product_stock',
    step: 'stock',
    data: { product_id, page },
  };
  await ctx.reply('🔢 Send the new *stock* (integer ≥ 0).', { parse_mode: 'Markdown' });
});

adminBot.callbackQuery(/^adm:prod:name:set:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const product_id = Number(ctx.match[1]);
  const page = Number(ctx.match[2]);
  ctx.session.adminFlow = {
    type: 'edit_product_name',
    step: 'name',
    data: { product_id, page },
  };
  await ctx.reply('🅰️ Send the new product *name*.', { parse_mode: 'Markdown' });
});

// ---------- Payment methods ----------
adminBot.callbackQuery('adm:pay', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = undefined;
  const kb = new InlineKeyboard()
    .text('➕ Add Payment Method', 'adm:pay:add')
    .text('📋 List & Manage', 'adm:pay:list')
    .row()
    .text('💎 Add Binance Pay (auto)', 'adm:pay:add_binance');
  backRow(kb);
  await ctx.editMessageText(
    '💳 *Payment Methods*\n\n_Use_ *Add Binance Pay* _to enable Pay ID top-ups. Users send USDT to your hard-coded Pay ID and submit the Order ID; you verify on the Binance dashboard and approve from the_ Deposits _tab._',
    { parse_mode: 'Markdown', reply_markup: kb },
  );
});

adminBot.callbackQuery('adm:pay:add_binance', async (ctx) => {
  await ctx.answerCallbackQuery();

  // Don't add a duplicate Binance Pay row if one already exists.
  const existing = (await listPaymentMethods()).find((p) => p.provider === 'binance_pay');
  const m =
    existing ??
    (await addPaymentMethod({
      name: 'Binance Pay',
      instructions: 'Send USDT to the Pay ID and submit the Order ID for admin verification.',
      min_amount: 1,
      provider: 'binance_pay',
    }));

  const { BINANCE_PAY_ID, BINANCE_PAY_NAME } = await import('../../services/binance.js');
  const kb = new InlineKeyboard().text('⬅️ Back', 'adm:pay');
  await ctx.editMessageText(
    [
      existing
        ? `✅ *Binance Pay already configured* (id ${m.id})`
        : `✅ *Binance Pay added* (id ${m.id})`,
      '',
      `Pay ID: \`${BINANCE_PAY_ID}\` (${BINANCE_PAY_NAME})`,
      '',
      'Users will see this Pay ID + a unique 6-digit note code under *Topup → Binance Pay*. They paste their Binance Order ID back, then you verify the transfer on https://merchant.binance.com / your Binance Pay app and approve from the *Deposits* tab.',
    ].join('\n'),
    { parse_mode: 'Markdown', reply_markup: kb },
  );
});

adminBot.callbackQuery('adm:pay:add', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = { type: 'add_payment', step: 'name', data: {} };
  await ctx.editMessageText(
    '💳 *Add Payment Method*\n\nSend the method *name* (e.g. `USDT (TRC20)`) or `/cancel`.',
    { parse_mode: 'Markdown', reply_markup: backRow(new InlineKeyboard()) },
  );
});

adminBot.callbackQuery('adm:pay:list', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPaymentList(ctx);
});

async function showPaymentList(ctx: AppCtx): Promise<void> {
  const methods = await listPaymentMethods();
  if (methods.length === 0) {
    await ctx.editMessageText('No payment methods yet.', {
      reply_markup: backRow(new InlineKeyboard()),
    });
    return;
  }
  const lines = ['💳 *Payment Methods*', ''];
  const kb = new InlineKeyboard();
  for (const m of methods) {
    lines.push(`#${m.id}  ${m.name}  (min $${m.min_amount})`);
    kb.text(`🗑 #${m.id} ${m.name}`.slice(0, 60), `adm:pay:del:${m.id}`).row();
  }
  backRow(kb);
  await ctx.editMessageText(lines.join('\n'), { parse_mode: 'Markdown', reply_markup: kb });
}

adminBot.callbackQuery(/^adm:pay:del:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  await deletePaymentMethod(id);
  await ctx.answerCallbackQuery({ text: `Deleted #${id}` });
  await showPaymentList(ctx);
});

// ---------- Deposits ----------
adminBot.callbackQuery('adm:dep', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showDepositList(ctx);
});

async function showDepositList(ctx: AppCtx): Promise<void> {
  const deps = await listPendingDeposits();
  if (deps.length === 0) {
    await ctx.editMessageText('No pending deposits.', {
      reply_markup: backRow(new InlineKeyboard()),
    });
    return;
  }
  const lines = ['💰 *Pending Deposits*', ''];
  const kb = new InlineKeyboard();
  for (const d of deps) {
    const amountStr =
      Number(d.amount) <= 0.01
        ? `_(amount not set)_`
        : `$${d.amount}`;
    const refLine = d.reference ? `\n     note code: \`${d.reference}\`` : '';
    const noteLine = d.note ? `\n     ${d.note}` : '';
    lines.push(
      `#${d.id}  user \`${d.user_id}\`  ${d.method}  ${amountStr}` + refLine + noteLine,
    );
    kb.text(`💲 Set Amount #${d.id}`, `adm:dep:amt:${d.id}`).row();
    kb.text(`✅ Approve #${d.id}`, `adm:dep:ok:${d.id}`)
      .text(`❌ Reject #${d.id}`, `adm:dep:no:${d.id}`)
      .row();
  }
  backRow(kb);
  await ctx.editMessageText(lines.join('\n'), { parse_mode: 'Markdown', reply_markup: kb });
}

adminBot.callbackQuery(/^adm:dep:amt:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  const dep = await getDeposit(id);
  if (!dep || dep.status !== 'pending') {
    await ctx.answerCallbackQuery({ text: 'Deposit no longer pending.' });
    await showDepositList(ctx);
    return;
  }
  ctx.session.adminFlow = {
    type: 'set_deposit_amount',
    step: 'amount',
    data: { deposit_id: id },
  };
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    [
      `💲 *Set amount for deposit #${id}*`,
      '',
      `User: \`${dep.user_id}\``,
      `Method: ${dep.method}`,
      dep.reference ? `Note code: \`${dep.reference}\`` : '',
      dep.note ? dep.note : '',
      '',
      'Send the *USDT amount you verified on the Binance dashboard* (e.g. `5.12`). The deposit row will be updated, but you still need to tap *Approve* to credit the user.',
    ]
      .filter(Boolean)
      .join('\n'),
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('⬅️ Back', 'adm:dep'),
    },
  );
});

adminBot.callbackQuery(/^adm:dep:ok:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  const dep = await getDeposit(id);
  if (!dep || dep.status !== 'pending') {
    await ctx.answerCallbackQuery({ text: 'Deposit no longer pending.' });
    await showDepositList(ctx);
    return;
  }
  if (Number(dep.amount) <= 0.01) {
    await ctx.answerCallbackQuery({
      text: 'Set the verified amount first via 💲 Set Amount.',
      show_alert: true,
    });
    return;
  }
  await setDepositStatus(id, 'approved');
  const newBal = await credit(
    dep.user_id,
    Number(dep.amount),
    dep.reference ?? `deposit:${dep.id}`,
    'deposit_credit',
  );
  await ctx.answerCallbackQuery({ text: `Approved. Balance: $${newBal}` });
  try {
    await ctx.api.sendMessage(
      dep.user_id,
      `✅ Your deposit *#${id}* of *$${dep.amount}* has been credited.\nNew balance: *$${newBal}*`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    logger.warn({ err }, 'Could not DM depositor');
  }
  void adminLog.logTopupResolved(ctx.api, {
    user: {
      telegram_id: dep.user_id,
      username: null,
      first_name: null,
      email: null,
    },
    depositDbId: dep.id,
    method: dep.method,
    amount: Number(dep.amount),
    status: 'approved',
    balanceAfter: Number(Number(newBal).toFixed(3)),
    resolvedBy: ctx.from!.id,
  });
  await showDepositList(ctx);
});

adminBot.callbackQuery(/^adm:dep:no:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  const dep = await getDeposit(id);
  if (!dep || dep.status !== 'pending') {
    await ctx.answerCallbackQuery({ text: 'Deposit no longer pending.' });
    await showDepositList(ctx);
    return;
  }
  await setDepositStatus(id, 'rejected');
  await ctx.answerCallbackQuery({ text: `Rejected #${id}` });
  try {
    await ctx.api.sendMessage(
      dep.user_id,
      `❌ Your deposit *#${id}* of *$${dep.amount}* was rejected. Please contact support.`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    logger.warn({ err }, 'Could not DM depositor');
  }
  void adminLog.logTopupResolved(ctx.api, {
    user: {
      telegram_id: dep.user_id,
      username: null,
      first_name: null,
      email: null,
    },
    depositDbId: dep.id,
    method: dep.method,
    amount: Number(dep.amount),
    status: 'rejected',
    balanceAfter: null,
    resolvedBy: ctx.from!.id,
  });
  await showDepositList(ctx);
});

// ---------- Customize ----------
adminBot.callbackQuery('adm:cust', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = undefined;
  const channelUrl = getChannelUrl();
  const kb = new InlineKeyboard()
    .text('📝 Edit Text', 'adm:cust:text')
    .text('🎨 Set Color', 'adm:cust:color:pick')
    .row()
    .text('🎯 Custom Color Glyphs', 'adm:cust:colorglyph')
    .row()
    .text('😀 Set Emoji', 'adm:cust:emoji')
    .text('🎯 Set Button Icon', 'adm:cust:btnicon')
    .row()
    .text('🔗 Set Channel URL', 'adm:cust:channel')
    .text('🔁 Reload Settings', 'adm:reload');
  backRow(kb);
  const channelLine = channelUrl
    ? `\n\nChannel URL: \`${channelUrl}\``
    : '\n\n_No channel URL set yet._';
  await ctx.editMessageText(
    `✏️ *Customize*\n\nEdit any text, button color, emoji, or the channel link used by the bot.${channelLine}`,
    { parse_mode: 'Markdown', reply_markup: kb },
  );
});

adminBot.callbackQuery('adm:cust:channel', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = { type: 'set_channel', step: 'value', data: {} };
  const kb = new InlineKeyboard()
    .text('🗑 Remove channel', 'adm:cust:channel:clear')
    .row()
    .text('⬅️ Back', 'adm:cust');
  await ctx.editMessageText(
    '🔗 *Set Channel URL*\n\nSend the channel link (e.g. `https://t.me/yourchannel`).' +
      '\n\nOr `/cancel`.',
    { parse_mode: 'Markdown', reply_markup: kb },
  );
});

adminBot.callbackQuery('adm:cust:channel:clear', async (ctx) => {
  await clearChannelUrl(ctx.from!.id);
  ctx.session.adminFlow = undefined;
  await ctx.answerCallbackQuery({ text: 'Channel link removed.' });
  await showRoot(ctx);
});

adminBot.callbackQuery('adm:cust:text', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = { type: 'set_text', step: 'key', data: {} };
  await ctx.editMessageText(
    '📝 *Edit Text*\n\nSend the *i18n key* you want to override' +
      ' (e.g. `welcome.title`, `btn.shop`, `shop.choose_category`).' +
      '\n\nOr `/cancel`.',
    { parse_mode: 'Markdown', reply_markup: backRow(new InlineKeyboard()) },
  );
});

// ----- Emoji picker (button-driven, A → Z) -----
//
// Lists every emoji key (the EMOJI map + every BUTTON_KEYS entry as
// `btn.<key>`) sorted alphabetically. Each row is a single button:
//   "<unicode> <key> — <state>"  where state is one of:
//   - "premium" (a custom_emoji_id is set)
//   - "<unicode>" (only the unicode fallback is set)
//   - "not set" (no override)
// Tapping any row enters the per-key set-emoji flow.
const EMOJI_PER_PAGE = 8;

function allEmojiKeys(): string[] {
  const set = new Set<string>(Object.keys(EMOJI));
  for (const k of Object.keys(BUTTON_KEYS)) set.add(`btn.${k}`);
  return [...set].sort();
}

function emojiStateLabel(key: string): string {
  // Read raw cached override AND the compile-time default to give the
  // admin a clear picture: "🐯 + premium" / "🐯 (default)" / "not set".
  const spec = getEmoji(key);
  if (typeof spec === 'object' && spec.custom_emoji_id) {
    return `${spec.unicode} ${key} — premium`;
  }
  if (typeof spec === 'string' && spec !== key) {
    return `${spec} ${key}`;
  }
  return `· ${key} — not set`;
}

function emojiPickerKb(page: number): InlineKeyboard {
  const keys = allEmojiKeys();
  const totalPages = Math.max(1, Math.ceil(keys.length / EMOJI_PER_PAGE));
  const start = page * EMOJI_PER_PAGE;
  const slice = keys.slice(start, start + EMOJI_PER_PAGE);
  const kb = new InlineKeyboard();
  for (const k of slice) {
    kb.text(emojiStateLabel(k).slice(0, 60), `adm:emoji:pick:${k}`).row();
  }
  if (totalPages > 1) {
    if (page > 0) kb.text('◀️ Prev', `adm:cust:emoji:${page - 1}`);
    kb.text(`${page + 1}/${totalPages}`, 'adm:noop');
    if (page + 1 < totalPages) kb.text('Next ▶️', `adm:cust:emoji:${page + 1}`);
    kb.row();
  }
  kb.text('⬅️ Back', 'adm:cust');
  return kb;
}

async function showEmojiPicker(ctx: AppCtx, page: number): Promise<void> {
  const text =
    '😀 *Set Emoji*\n\n' +
    'Tap any key to update its emoji. You can either send a plain unicode emoji ' +
    '(e.g. `🐯`) — or send a *premium emoji message* directly and the bot will ' +
    'auto-extract its `custom_emoji_id` for you.';
  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: emojiPickerKb(page),
  });
}

adminBot.callbackQuery('adm:cust:emoji', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = undefined;
  await showEmojiPicker(ctx, 0);
});

adminBot.callbackQuery(/^adm:cust:emoji:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showEmojiPicker(ctx, Number(ctx.match[1]));
});

adminBot.callbackQuery(/^adm:emoji:pick:(.+)$/, async (ctx) => {
  const key = ctx.match[1]!;
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = { type: 'set_emoji', step: 'value', data: { key } };
  const cur = getEmoji(key);
  const curLine =
    typeof cur === 'object' && cur.custom_emoji_id
      ? `Current: ${cur.unicode}  *premium id* \`${cur.custom_emoji_id}\``
      : typeof cur === 'string' && cur !== key
        ? `Current: ${cur}`
        : 'Current: _not set_';
  await ctx.editMessageText(
    `😀 *Set Emoji* — \`${key}\`\n\n` +
      `${curLine}\n\n` +
      'Send any of:\n' +
      '• A plain unicode emoji — e.g. `🐯`\n' +
      '• A *premium* emoji message — the bot reads its `custom_emoji_id`\n' +
      '• Or the raw form: `<unicode> [custom_emoji_id]`\n\n' +
      'Or `/cancel`.',
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('⬅️ Back', 'adm:cust:emoji'),
    },
  );
});

// ----- Color picker (button-driven, blue / green / red / yellow / none) -----
//
// Lists every BUTTON_KEYS entry with its current color marker, paginated.
// Tapping a key opens a 5-button color chooser.
const COLOR_PER_PAGE = 8;

function buttonKeyList(): string[] {
  return Object.keys(BUTTON_KEYS).sort();
}

function buttonColorLabel(key: keyof typeof BUTTON_KEYS): string {
  // COLOR_PREFIX values are now empty (the old 🟦🟩🟥🟨 squares were
  // removed). Show the bare button key + its assigned colour name.
  const c = getButtonColor(key);
  return `${key} — ${c}`;
}

function colorPickerKb(page: number): InlineKeyboard {
  const keys = buttonKeyList();
  const totalPages = Math.max(1, Math.ceil(keys.length / COLOR_PER_PAGE));
  const start = page * COLOR_PER_PAGE;
  const slice = keys.slice(start, start + COLOR_PER_PAGE);
  const kb = new InlineKeyboard();
  // Top entry: dedicated picker for product-category buttons. Lives
  // under its own list because categories are dynamic (admin-added)
  // and shouldn't pollute the static button-key roster.
  if (page === 0) {
    kb.text('📂 Product Categories ▶️', 'adm:catcolor:list').row();
  }
  for (const k of slice) {
    kb.text(
      buttonColorLabel(k as keyof typeof BUTTON_KEYS).slice(0, 60),
      `adm:color:pick:${k}`,
    ).row();
  }
  if (totalPages > 1) {
    if (page > 0) kb.text('◀️ Prev', `adm:cust:color:${page - 1}`);
    kb.text(`${page + 1}/${totalPages}`, 'adm:noop');
    if (page + 1 < totalPages) kb.text('Next ▶️', `adm:cust:color:${page + 1}`);
    kb.row();
  }
  kb.text('⬅️ Back', 'adm:cust');
  return kb;
}

async function showColorPicker(ctx: AppCtx, page: number): Promise<void> {
  await ctx.editMessageText(
    '🎨 *Set Color*\n\n' +
      'Pick a tint hint for an inline button (blue / green / red / ' +
      'yellow / none). Tap a button key to change its color.',
    { parse_mode: 'Markdown', reply_markup: colorPickerKb(page) },
  );
}

adminBot.callbackQuery('adm:cust:color:pick', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = undefined;
  await showColorPicker(ctx, 0);
});

adminBot.callbackQuery(/^adm:cust:color:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showColorPicker(ctx, Number(ctx.match[1]));
});

adminBot.callbackQuery(/^adm:color:pick:(.+)$/, async (ctx) => {
  const key = ctx.match[1]!;
  await ctx.answerCallbackQuery();
  const kb = new InlineKeyboard();
  for (const c of Object.keys(COLOR_PREFIX) as ColorMode[]) {
    kb.text(c, `adm:color:set:${key}:${c}`);
  }
  kb.row().text('⬅️ Back', 'adm:cust:color:pick');
  await ctx.editMessageText(`🎨 *Set Color* — \`${key}\`\n\nPick a color:`, {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
});

adminBot.callbackQuery(/^adm:color:set:([^:]+):([^:]+)$/, async (ctx) => {
  const key = ctx.match[1]!;
  const color = ctx.match[2] as ColorMode;
  if (!(color in COLOR_PREFIX)) {
    await ctx.answerCallbackQuery({ text: 'Bad color' });
    return;
  }
  await setColor(key, color, ctx.from!.id);
  await ctx.answerCallbackQuery({ text: `Set ${key} → ${color}` });
  await showColorPicker(ctx, 0);
});

// ----- Product-category color picker -----
//
// Categories are admin-managed (added at runtime), so we list them
// dynamically rather than baking them into BUTTON_KEYS. The "Default"
// entry sets the colour applied to every category that hasn't been
// explicitly themed — including any future categories the admin
// adds. Per-category overrides win over the default; both win over
// the hard-coded 'none'.
const CATEGORY_COLOR_PER_PAGE = 8;

async function showCategoryColorList(ctx: AppCtx, page: number): Promise<void> {
  const cats = await listAllCategories();
  const totalPages = Math.max(1, Math.ceil(cats.length / CATEGORY_COLOR_PER_PAGE));
  const start = page * CATEGORY_COLOR_PER_PAGE;
  const slice = cats.slice(start, start + CATEGORY_COLOR_PER_PAGE);
  const kb = new InlineKeyboard();
  if (page === 0) {
    const def = getCategoryDefaultColor();
    kb.text(`✨ Default (new categories) — ${def}`, 'adm:catcolor:pick:default').row();
  }
  for (const c of slice) {
    const color = getCategoryColor(c.id);
    const emoji = c.emoji ?? '📁';
    const label = `${emoji} ${c.name} — ${color}`.slice(0, 60);
    kb.text(label, `adm:catcolor:pick:${c.id}`).row();
  }
  if (totalPages > 1) {
    if (page > 0) kb.text('◀️ Prev', `adm:catcolor:list:${page - 1}`);
    kb.text(`${page + 1}/${totalPages}`, 'adm:noop');
    if (page + 1 < totalPages) kb.text('Next ▶️', `adm:catcolor:list:${page + 1}`);
    kb.row();
  }
  kb.text('⬅️ Back', 'adm:cust:color:pick');
  await ctx.editMessageText(
    '🎨 *Set Color — Product Categories*\n\n' +
      'Pick a tint hint (blue / green / red / yellow / none) for each ' +
      'product category select button. Tap a category to change its ' +
      'colour. Tap *Default* to set the colour applied to every category ' +
      'you add later.',
    { parse_mode: 'Markdown', reply_markup: kb },
  );
}

adminBot.callbackQuery('adm:catcolor:list', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = undefined;
  await showCategoryColorList(ctx, 0);
});

adminBot.callbackQuery(/^adm:catcolor:list:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showCategoryColorList(ctx, Number(ctx.match[1]));
});

adminBot.callbackQuery(/^adm:catcolor:pick:(default|\d+)$/, async (ctx) => {
  const target = ctx.match[1]!;
  await ctx.answerCallbackQuery();
  let label: string;
  if (target === 'default') {
    label = 'Default (new categories)';
  } else {
    const cats = await listAllCategories();
    const cat = cats.find((c) => c.id === Number(target));
    label = cat ? `${cat.emoji ?? '📁'} ${cat.name}` : `Category #${target}`;
  }
  const kb = new InlineKeyboard();
  for (const c of Object.keys(COLOR_PREFIX) as ColorMode[]) {
    kb.text(c, `adm:catcolor:set:${target}:${c}`);
  }
  kb.row().text('⬅️ Back', 'adm:catcolor:list');
  await ctx.editMessageText(`🎨 *Set Color* — ${label}\n\nPick a color:`, {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
});

adminBot.callbackQuery(/^adm:catcolor:set:(default|\d+):([^:]+)$/, async (ctx) => {
  const target = ctx.match[1]!;
  const color = ctx.match[2] as ColorMode;
  if (!(color in COLOR_PREFIX)) {
    await ctx.answerCallbackQuery({ text: 'Bad color' });
    return;
  }
  if (target === 'default') {
    await setCategoryDefaultColor(color, ctx.from!.id);
    await ctx.answerCallbackQuery({ text: `Default → ${color}` });
  } else {
    const id = Number(target);
    await setCategoryColor(id, color, ctx.from!.id);
    await ctx.answerCallbackQuery({ text: `#${id} → ${color}` });
  }
  await showCategoryColorList(ctx, 0);
});

// ----- Custom Color Glyphs editor -----
//
// Lets the bot owner customise the prefix glyph used for each
// `ColorMode` (blue/green/red/yellow/none). The default is the
// matching coloured circle (🔵🟢🔴🟡), but an admin can replace
// any of them with arbitrary unicode (e.g. squares, hearts, brand
// emojis) or clear it entirely. Stored under `color.prefix.<mode>`
// in the settings cache (see `services/settings.ts`).
async function showColorGlyphPicker(ctx: AppCtx): Promise<void> {
  const modes: ColorMode[] = ['blue', 'green', 'red', 'yellow', 'none'];
  const lines = ['🎯 *Custom Color Glyphs*', ''];
  for (const m of modes) {
    const glyph = getColorPrefix(m);
    const display = glyph.length > 0 ? glyph : '_(none)_';
    lines.push(`*${m}*: ${display}`);
  }
  lines.push('', '_Tap a mode to change its glyph. Send any text (single emoji, brand symbol, etc.) or `/clear` to drop the override._');
  const kb = new InlineKeyboard();
  for (const m of modes) {
    kb.text(`${m} → ${getColorPrefix(m) || '·'}`, `adm:colorglyph:edit:${m}`).row();
  }
  kb.text('⬅️ Back', 'adm:cust');
  await ctx.editMessageText(lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

adminBot.callbackQuery('adm:cust:colorglyph', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = undefined;
  await showColorGlyphPicker(ctx);
});

adminBot.callbackQuery(/^adm:colorglyph:edit:([^:]+)$/, async (ctx) => {
  const mode = ctx.match[1]! as ColorMode;
  if (!(mode in COLOR_PREFIX)) {
    await ctx.answerCallbackQuery({ text: 'Bad mode' });
    return;
  }
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = {
    type: 'set_color_glyph',
    step: 'value',
    data: { mode },
  };
  const cur = getColorPrefix(mode);
  await ctx.reply(
    `🎯 *Set Glyph for \`${mode}\`*\n\nCurrent: ${cur || '_(none)_'}\n\nSend a single emoji / symbol as your next message — it will become the new prefix glyph for the *${mode}* color mode. Send \`/clear\` to drop the override (falls back to the built-in default). Send \`/cancel\` to abort.`,
    { parse_mode: 'Markdown' },
  );
});

// ----- Button-icon picker (button-driven, A → Z) -----
//
// Lists every BUTTON_KEYS entry with its current icon state. Tapping
// a key opens the standard set-emoji flow but stores the value under
// `btn.<key>` so it ONLY affects that button (not any shared emoji
// elsewhere in the bot). The lookup happens in
// `src/keyboards/helpers.ts → resolveIconId`.
const BTN_ICON_PER_PAGE = 8;

function buttonIconLabel(key: keyof typeof BUTTON_KEYS): string {
  const spec = getButtonIcon(key);
  if (spec) return `${spec.unicode} ${key} — premium`;
  return `· ${key} — default`;
}

function buttonIconPickerKb(page: number): InlineKeyboard {
  const keys = buttonKeyList();
  const totalPages = Math.max(1, Math.ceil(keys.length / BTN_ICON_PER_PAGE));
  const start = page * BTN_ICON_PER_PAGE;
  const slice = keys.slice(start, start + BTN_ICON_PER_PAGE);
  const kb = new InlineKeyboard();
  for (const k of slice) {
    kb.text(
      buttonIconLabel(k as keyof typeof BUTTON_KEYS).slice(0, 60),
      `adm:btnicon:pick:${k}`,
    ).row();
  }
  if (totalPages > 1) {
    if (page > 0) kb.text('◀️ Prev', `adm:cust:btnicon:${page - 1}`);
    kb.text(`${page + 1}/${totalPages}`, 'adm:noop');
    if (page + 1 < totalPages) kb.text('Next ▶️', `adm:cust:btnicon:${page + 1}`);
    kb.row();
  }
  kb.text('⬅️ Back', 'adm:cust');
  return kb;
}

async function showButtonIconPicker(ctx: AppCtx, page: number): Promise<void> {
  await ctx.editMessageText(
    '🎯 *Set Button Icon*\n\n' +
      'Pick a button to assign your own *premium emoji* icon to it. ' +
      'Send a premium emoji message and the bot will read its ' +
      '`custom_emoji_id` automatically. Each override is per-button — ' +
      "changing one button's icon won't affect anything else.",
    { parse_mode: 'Markdown', reply_markup: buttonIconPickerKb(page) },
  );
}

adminBot.callbackQuery('adm:cust:btnicon', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = undefined;
  await showButtonIconPicker(ctx, 0);
});

adminBot.callbackQuery(/^adm:cust:btnicon:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showButtonIconPicker(ctx, Number(ctx.match[1]));
});

adminBot.callbackQuery(/^adm:btnicon:pick:(.+)$/, async (ctx) => {
  const key = ctx.match[1]!;
  if (!(key in BUTTON_KEYS)) {
    await ctx.answerCallbackQuery({ text: 'Unknown button.' });
    return;
  }
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = { type: 'set_btnicon', step: 'value', data: { btnKey: key } };
  const cur = getButtonIcon(key);
  const curLine = cur
    ? `Current: ${cur.unicode}  *premium id* \`${cur.custom_emoji_id}\``
    : 'Current: _default (none set)_';
  const kb = new InlineKeyboard()
    .text('🗑 Clear icon', `adm:btnicon:clear:${key}`)
    .row()
    .text('⬅️ Back', 'adm:cust:btnicon');
  await ctx.editMessageText(
    `🎯 *Set Button Icon* — \`${key}\`\n\n` +
      `${curLine}\n\n` +
      'Send a *premium emoji message* — the bot reads its ' +
      '`custom_emoji_id` and uses it as the icon for this button.\n\n' +
      'The emoji must be one your bot owner has access to (any premium ' +
      'emoji visible to the owner). Plain unicode emojis without a ' +
      'premium id can\'t be used as button icons.\n\n' +
      'Or `/cancel`.',
    { parse_mode: 'Markdown', reply_markup: kb },
  );
});

adminBot.callbackQuery(/^adm:btnicon:clear:(.+)$/, async (ctx) => {
  const key = ctx.match[1]!;
  if (!(key in BUTTON_KEYS)) {
    await ctx.answerCallbackQuery({ text: 'Unknown button.' });
    return;
  }
  await clearButtonIcon(key);
  ctx.session.adminFlow = undefined;
  await ctx.answerCallbackQuery({ text: `Cleared icon for ${key}.` });
  await showButtonIconPicker(ctx, 0);
});

// Silent no-op (used for the page indicator in the picker).
adminBot.callbackQuery('adm:noop', async (ctx) => {
  await ctx.answerCallbackQuery();
});

// ---------- Announce ----------
adminBot.callbackQuery('adm:ann', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = { type: 'announce', step: 'text', data: {} };
  await ctx.editMessageText(
    '📣 *Announce*\n\nSend the announcement text.\n\n' +
      'Tip: use `{tiger}` `{fire}` `{rocket}` etc. to insert mapped emojis (premium-aware).' +
      '\n\nOr `/cancel`.',
    { parse_mode: 'Markdown', reply_markup: backRow(new InlineKeyboard()) },
  );
});

adminBot.callbackQuery('adm:ann:send', async (ctx) => {
  const flow = ctx.session.adminFlow;
  if (flow?.type !== 'announce' || flow.step !== 'confirm') {
    await ctx.answerCallbackQuery({ text: 'Nothing to send.' });
    return;
  }
  const body = flow.data.text;
  const recipients = await listUsersForAnnouncement();
  await ctx.editMessageText(`📣 Broadcasting to ${recipients.length} user(s)…`);
  // Render once: HTML output expands `{tokens}` AND auto-wraps any
  // unicode emoji that has a configured premium custom_emoji_id.
  const html = renderMdHtml(body);
  let ok = 0;
  let fail = 0;
  for (const r of recipients) {
    try {
      await ctx.api.sendMessage(r.telegram_id, html, { parse_mode: 'HTML' });
      ok++;
    } catch (err) {
      fail++;
      logger.warn({ err, user: r.telegram_id }, 'announce send failed');
    }
  }
  ctx.session.adminFlow = undefined;
  await ctx.editMessageText(
    `✅ Done. Delivered: *${ok}*, failed: *${fail}*.`,
    { parse_mode: 'Markdown', reply_markup: backRow(new InlineKeyboard()) },
  );
});

// ---------- Users ----------
adminBot.callbackQuery(/^adm:usr:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showUserList(ctx, Number(ctx.match[1]));
});

async function showUserList(ctx: AppCtx, page: number): Promise<void> {
  ctx.session.adminFlow = undefined;
  const { rows, total } = await listRecentUsers(page, PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const lines = [`👥 *Users* — page ${page + 1}/${totalPages}  (total ${total})`, ''];
  const kb = new InlineKeyboard();
  for (const u of rows) {
    const handle = u.username ? `@${u.username}` : (u.first_name ?? `id ${u.telegram_id}`);
    lines.push(`\`${u.telegram_id}\` ${handle}  •  $${Number(u.balance).toFixed(2)}`);
    kb.text(handle.slice(0, 24), `adm:usr:v:${u.telegram_id}`).row();
  }
  if (page > 0) kb.text('◀️ Prev', `adm:usr:${page - 1}`);
  if (page + 1 < totalPages) kb.text('Next ▶️', `adm:usr:${page + 1}`);
  kb.row().text('🔍 Find user', 'adm:usr:find').row().text('⬅️ Back', 'adm:root');
  await ctx.editMessageText(lines.join('\n'), { parse_mode: 'Markdown', reply_markup: kb });
}

adminBot.callbackQuery('adm:usr:find', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = { type: 'find_user', step: 'query', data: {} };
  await ctx.editMessageText(
    '🔍 *Find User*\n\nSend the user\'s Telegram numeric ID or `@username` (or `/cancel`).',
    { parse_mode: 'Markdown', reply_markup: backRow(new InlineKeyboard()) },
  );
});

async function showUserCard(ctx: AppCtx, user: DBUser): Promise<void> {
  const isAdminUser = await isAdmin(user.telegram_id);
  const summary = await getUserOrderSummary(user.telegram_id);
  const lines = [
    `👤 *User Details*`,
    '',
    `ID: \`${user.telegram_id}\``,
    user.username ? `Username: @${user.username}` : 'Username: _none_',
    `Name: ${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || 'Name: _none_',
    `Balance: *$${Number(user.balance).toFixed(2)}*`,
    `Language: ${user.language}`,
    `Joined: ${new Date(user.joined_at).toLocaleDateString('en-GB')}`,
    `Orders: *${summary.orders}* • Total spent: *$${summary.spent.toFixed(2)}*`,
    `Admin: ${isAdminUser ? '✅' : '❌'}`,
    user.is_banned
      ? `Banned: *YES*${
          user.banned_at
            ? ` (since ${new Date(user.banned_at).toLocaleDateString('en-GB')})`
            : ''
        }${user.banned_reason ? `\nReason: _${user.banned_reason}_` : ''}`
      : 'Banned: ❌',
  ];
  const kb = new InlineKeyboard()
    .text('💰 Adjust balance', `adm:usr:bal:${user.telegram_id}`)
    .row();
  if (isAdminUser) {
    kb.text('🛡 Demote admin', `adm:usr:demote:${user.telegram_id}`);
  } else {
    kb.text('🛡 Promote admin', `adm:usr:promote:${user.telegram_id}`);
  }
  kb.row();
  // Admins can never be banned via this UI — promote-then-ban
  // would be self-defeating, so just hide the row entirely.
  if (!isAdminUser) {
    if (user.is_banned) {
      kb.text('♻️ Unban user', `adm:usr:unban:${user.telegram_id}`);
    } else {
      kb.text('🚫 Ban user', `adm:usr:ban:${user.telegram_id}`);
    }
    kb.row();
  }
  kb.text('💎 Custom prices', `adm:price:u:${user.telegram_id}`).row();
  kb.text('⬅️ Back to users', 'adm:usr:0').text('🏠 Main', 'adm:root');
  if (ctx.callbackQuery) {
    await ctx.editMessageText(lines.join('\n'), { parse_mode: 'Markdown', reply_markup: kb });
  } else {
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown', reply_markup: kb });
  }
}

adminBot.callbackQuery(/^adm:usr:v:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = await findUserById(Number(ctx.match[1]));
  if (!user) {
    await ctx.editMessageText('User not found.', { reply_markup: backRow(new InlineKeyboard()) });
    return;
  }
  await showUserCard(ctx, user);
});

adminBot.callbackQuery(/^adm:usr:promote:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  const u = await findUserById(id);
  await promoteAdmin(id, u?.username ?? null);
  await ctx.answerCallbackQuery({ text: '🛡 Promoted to admin.' });
  if (u) await showUserCard(ctx, u);
});

adminBot.callbackQuery(/^adm:usr:demote:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  if (id === ctx.from!.id) {
    await ctx.answerCallbackQuery({
      text: 'Refusing to demote yourself. Promote another admin first.',
      show_alert: true,
    });
    return;
  }
  await demoteAdmin(id);
  await ctx.answerCallbackQuery({ text: 'Demoted.' });
  const u = await findUserById(id);
  if (u) await showUserCard(ctx, u);
});

adminBot.callbackQuery(/^adm:usr:bal:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = Number(ctx.match[1]);
  ctx.session.adminFlow = { type: 'adjust_balance', step: 'amount', data: { telegram_id: id } };
  await ctx.editMessageText(
    `💰 *Adjust Balance* for \`${id}\`\n\nSend a number to add (e.g. \`5\`) or subtract (e.g. \`-3.50\`).` +
      '\n\nOr `/cancel`.',
    { parse_mode: 'Markdown', reply_markup: backRow(new InlineKeyboard()) },
  );
});

// Step 1 of the ban flow: prompt admin for an optional reason. Admin
// can send `-` (or just hit /cancel) to ban with no reason. Any other
// message becomes the reason and is stored on the user row for
// future reference.
adminBot.callbackQuery(/^adm:usr:ban:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = Number(ctx.match[1]);
  if (id === ctx.from!.id) {
    await ctx.answerCallbackQuery({
      text: 'Refusing to ban yourself.',
      show_alert: true,
    });
    return;
  }
  if (await isAdmin(id)) {
    await ctx.answerCallbackQuery({
      text: 'Demote this admin first before banning.',
      show_alert: true,
    });
    return;
  }
  ctx.session.adminFlow = { type: 'ban_user', step: 'reason', data: { telegram_id: id } };
  await ctx.editMessageText(
    `🚫 *Ban user* \`${id}\`\n\n` +
      'Send a short reason (admin-only note) or `-` to skip.\n' +
      'After confirmation the bot will silently drop every update from this ' +
      'user until you unban them.\n\n' +
      'Or `/cancel`.',
    { parse_mode: 'Markdown', reply_markup: backRow(new InlineKeyboard()) },
  );
});

// One-tap unban — no extra prompt, mirrors how Promote/Demote work.
adminBot.callbackQuery(/^adm:usr:unban:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  await unbanUser(id);
  await ctx.answerCallbackQuery({ text: '♻️ User unbanned.' });
  const u = await findUserById(id);
  if (u) await showUserCard(ctx, u);
});

// ============================================================
// Custom Prices — per-user, per-product price overrides.
//
// Flow:
//   adm:price            → ask admin for telegram_id (or @username)
//   adm:price:u:<tgid>   → render the user's override list with
//                          buttons to add a new override, edit /
//                          clear an existing one, bulk paste, or
//                          clear-all.
//   adm:price:add:<tgid> → list every active product so the admin
//                          can pick which one to override next.
//   adm:price:set:<tgid>:<pid>
//                        → prompt for the override price.
//   adm:price:del:<tgid>:<pid>
//                        → drop a single override.
//   adm:price:bulk:<tgid> → enter bulk-paste mode.
//   adm:price:clr:<tgid> → drop every override for the user.
// ============================================================

const PRICE_PRODUCTS_PER_PAGE = 8;

async function showCustomPriceUserPick(ctx: AppCtx): Promise<void> {
  ctx.session.adminFlow = {
    type: 'price_overrides_pick_user',
    step: 'query',
    data: {},
  };
  const body =
    '💎 *Custom Prices*\n\n' +
    'Per-user, per-product price overrides. Send the user\'s ' +
    'Telegram numeric ID or `@username` to start editing.\n\n' +
    'Tip: you can pre-set prices for users who haven\'t `/start`-ed ' +
    'the bot yet — paste their numeric Telegram ID.\n\n' +
    'Or `/cancel`.';
  // Two top-level shortcuts that don't require typing a user first:
  //   📊 Overview — paginated, deeply detailed table of every
  //                 override across every user.
  //   📥 Export CSV — same data as a downloadable .csv file you can
  //                   open in Excel / Google Sheets for sorting,
  //                   filtering, charting.
  const kb = new InlineKeyboard()
    .text('📊 Full overview', 'adm:price:report:0')
    .text('📥 Export CSV', 'adm:price:csv')
    .row()
    .text('⬅️ Back', 'adm:root');
  if (ctx.callbackQuery) {
    await ctx.editMessageText(body, {
      parse_mode: 'Markdown',
      reply_markup: kb,
    });
  } else {
    await ctx.reply(body, {
      parse_mode: 'Markdown',
      reply_markup: kb,
    });
  }
}

async function showCustomPriceUserCard(
  ctx: AppCtx,
  telegram_id: number,
): Promise<void> {
  ctx.session.adminFlow = undefined;
  const overrides = await listUserPriceOverrides(telegram_id);
  const targetUser = await findUserById(telegram_id);
  const handle = targetUser?.username
    ? `@${targetUser.username}`
    : (targetUser?.first_name ?? `id ${telegram_id}`);
  const lines: string[] = [
    `💎 *Custom Prices for* \`${telegram_id}\` _(${escapeHtml(handle)})_`,
    '',
  ];
  if (overrides.length === 0) {
    lines.push('_No overrides yet._ Tap *Add override* to set one.');
  } else {
    lines.push(`Active overrides: *${overrides.length}*`, '');
    for (const o of overrides) {
      lines.push(
        `\`#${o.product_id}\` ${escapeHtml(o.product_name)}: ` +
          `*$${o.price.toFixed(2)}* ` +
          `_(default $${o.product_default_price.toFixed(2)})_`,
      );
    }
  }
  const kb = new InlineKeyboard()
    .text('➕ Add / edit override', `adm:price:add:${telegram_id}:0`)
    .row()
    .text('📋 Bulk paste', `adm:price:bulk:${telegram_id}`)
    .row();
  if (overrides.length > 0) {
    // Clear-rows: each override gets a one-tap delete row.
    for (const o of overrides) {
      kb.text(
        `🗑 ${o.product_name.slice(0, 40)} ($${o.price.toFixed(2)})`,
        `adm:price:del:${telegram_id}:${o.product_id}`,
      ).row();
    }
    kb.text('🧹 Clear ALL overrides', `adm:price:clr:${telegram_id}`).row();
  }
  kb.text('⬅️ Back', 'adm:price');
  if (ctx.callbackQuery) {
    await ctx.editMessageText(lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: kb,
    });
  } else {
    await ctx.reply(lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: kb,
    });
  }
}

async function showCustomPriceProductPicker(
  ctx: AppCtx,
  telegram_id: number,
  page: number,
): Promise<void> {
  const { rows, total } = await listAllProducts(page, PRICE_PRODUCTS_PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(total / PRICE_PRODUCTS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const overrides = await listUserPriceOverrides(telegram_id);
  const overrideMap = new Map(overrides.map((o) => [o.product_id, o.price]));

  const lines = [
    `💎 *Pick a product* — page ${safePage + 1}/${totalPages}`,
    '',
    `Editing overrides for \`${telegram_id}\`. ` +
      'Tap a product to set/replace its override price.',
  ];
  const kb = new InlineKeyboard();
  for (const p of rows) {
    const cur = overrideMap.get(p.id);
    const label =
      cur !== undefined
        ? `${p.name} — $${cur.toFixed(2)} (was $${Number(p.price).toFixed(2)})`
        : `${p.name} — $${Number(p.price).toFixed(2)}`;
    kb.text(label.slice(0, 60), `adm:price:set:${telegram_id}:${p.id}`).row();
  }
  if (safePage > 0) {
    kb.text('◀ Prev', `adm:price:add:${telegram_id}:${safePage - 1}`);
  }
  if (safePage + 1 < totalPages) {
    kb.text('Next ▶', `adm:price:add:${telegram_id}:${safePage + 1}`);
  }
  kb.row().text('⬅️ Back', `adm:price:u:${telegram_id}`);
  await ctx.editMessageText(lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

adminBot.callbackQuery('adm:price', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showCustomPriceUserPick(ctx);
});

adminBot.callbackQuery(/^adm:price:u:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showCustomPriceUserCard(ctx, Number(ctx.match[1]));
});

adminBot.callbackQuery(/^adm:price:add:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showCustomPriceProductPicker(
    ctx,
    Number(ctx.match[1]),
    Number(ctx.match[2]),
  );
});

adminBot.callbackQuery(/^adm:price:set:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const telegram_id = Number(ctx.match[1]);
  const product_id = Number(ctx.match[2]);
  const product = await getProduct(product_id);
  if (!product) {
    await ctx.editMessageText('Product no longer exists.', {
      reply_markup: backRow(new InlineKeyboard()),
    });
    return;
  }
  ctx.session.adminFlow = {
    type: 'price_override_set',
    step: 'price',
    data: { telegram_id, product_id },
  };
  await ctx.editMessageText(
    `💎 *Set override*\n\n` +
      `User: \`${telegram_id}\`\n` +
      `Product: ${escapeHtml(product.name)} (\`#${product.id}\`)\n` +
      `Default price: *$${Number(product.price).toFixed(2)}*\n\n` +
      'Send the new override price (e.g. `12.50`). Send `0` to make ' +
      'it free for this user, or `/cancel` to abort.',
    {
      parse_mode: 'Markdown',
      reply_markup: backRow(new InlineKeyboard()),
    },
  );
});

adminBot.callbackQuery(/^adm:price:del:(\d+):(\d+)$/, async (ctx) => {
  const telegram_id = Number(ctx.match[1]);
  const product_id = Number(ctx.match[2]);
  await clearUserProductPrice(telegram_id, product_id);
  await ctx.answerCallbackQuery({ text: '🗑 Override removed.' });
  await showCustomPriceUserCard(ctx, telegram_id);
});

adminBot.callbackQuery(/^adm:price:clr:(\d+)$/, async (ctx) => {
  const telegram_id = Number(ctx.match[1]);
  const n = await clearAllUserPriceOverrides(telegram_id);
  await ctx.answerCallbackQuery({
    text: n === 0 ? 'No overrides to clear.' : `🧹 Cleared ${n} overrides.`,
  });
  await showCustomPriceUserCard(ctx, telegram_id);
});

adminBot.callbackQuery(/^adm:price:bulk:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const telegram_id = Number(ctx.match[1]);
  ctx.session.adminFlow = {
    type: 'price_override_bulk',
    step: 'block',
    data: { telegram_id },
  };
  await ctx.editMessageText(
    `📋 *Bulk paste* — for user \`${telegram_id}\`\n\n` +
      'Send a single message with one override per line, in the form:\n' +
      '```\n' +
      '<product_id> <price>\n' +
      '<product_id> <price>\n' +
      '```\n' +
      'Example:\n' +
      '```\n' +
      '17 9.99\n' +
      '23 0\n' +
      '42 100.50\n' +
      '```\n' +
      'Lines starting with `#` are ignored. Existing overrides for the ' +
      'listed products are replaced; others are left untouched.\n\n' +
      'Or `/cancel`.',
    {
      parse_mode: 'Markdown',
      reply_markup: backRow(new InlineKeyboard()),
    },
  );
});

// ------------------------------------------------------------
// 📊 Full overview — paginated, deeply detailed table of every
// override across every user. Groups by user; each group shows
// the user's handle / Telegram ID, total override count, total
// dollar swing (sum of override-default deltas) and a row per
// product with default → override price + delta.
//
// USERS_PER_PAGE limits how many user-groups appear per Telegram
// message so we never blow past the 4096-char Markdown limit.
// ------------------------------------------------------------
const PRICE_REPORT_USERS_PER_PAGE = 5;

adminBot.callbackQuery(/^adm:price:report:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const page = Math.max(0, Number(ctx.match[1]));
  const all = await listAllPriceOverrides();
  if (all.length === 0) {
    await ctx.editMessageText(
      '📊 *Custom Prices — Overview*\n\n_No overrides set yet._\n\n' +
        'Add one via the user pick screen or pre-set by Telegram ID.',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('⬅️ Back', 'adm:price'),
      },
    );
    return;
  }

  // Group by telegram_id while preserving the (telegram_id, product_id)
  // sort coming from the query.
  const groups = new Map<
    number,
    {
      telegram_id: number;
      username: string | null;
      first_name: string | null;
      rows: typeof all;
    }
  >();
  for (const o of all) {
    let g = groups.get(o.telegram_id);
    if (!g) {
      g = {
        telegram_id: o.telegram_id,
        username: o.username,
        first_name: o.first_name,
        rows: [],
      };
      groups.set(o.telegram_id, g);
    }
    g.rows.push(o);
  }
  const groupArr = Array.from(groups.values());
  const totalPages = Math.max(
    1,
    Math.ceil(groupArr.length / PRICE_REPORT_USERS_PER_PAGE),
  );
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * PRICE_REPORT_USERS_PER_PAGE;
  const end = Math.min(start + PRICE_REPORT_USERS_PER_PAGE, groupArr.length);

  const header = [
    '📊 *Custom Prices — Overview*',
    `Users with overrides: *${groupArr.length}* · ` +
      `Total override rows: *${all.length}*` +
      ` · Page ${safePage + 1}/${totalPages}`,
    '',
  ];

  const sections: string[] = [];
  for (let i = start; i < end; i++) {
    const g = groupArr[i];
    if (!g) continue;
    const handle = g.username ? `@${g.username}` : (g.first_name ?? '_no name_');
    const swing = g.rows.reduce(
      (acc, r) => acc + (r.price - r.product_default_price),
      0,
    );
    const swingTxt =
      swing === 0
        ? '±$0.00'
        : swing > 0
          ? `+$${swing.toFixed(2)} above default`
          : `−$${Math.abs(swing).toFixed(2)} below default`;
    const userLine =
      `*${i + 1}.* \`${g.telegram_id}\` _(${escapeHtml(handle)})_ · ` +
      `*${g.rows.length}* override${g.rows.length === 1 ? '' : 's'} · ${swingTxt}`;
    const productLines = g.rows.map((r) => {
      const delta = r.price - r.product_default_price;
      const sign = delta === 0 ? '=' : delta > 0 ? '+' : '−';
      const pct =
        r.product_default_price > 0
          ? `${((delta / r.product_default_price) * 100).toFixed(1)}%`
          : 'n/a';
      return (
        `   • \`#${r.product_id}\` ${escapeHtml(r.product_name)}: ` +
        `*$${r.price.toFixed(2)}* ` +
        `(default $${r.product_default_price.toFixed(2)}, ` +
        `${sign}$${Math.abs(delta).toFixed(2)} / ${pct})`
      );
    });
    sections.push([userLine, ...productLines].join('\n'));
  }

  const kb = new InlineKeyboard();
  if (safePage > 0) {
    kb.text('◀ Prev', `adm:price:report:${safePage - 1}`);
  }
  if (safePage + 1 < totalPages) {
    kb.text('Next ▶', `adm:price:report:${safePage + 1}`);
  }
  kb.row().text('📥 Export CSV', 'adm:price:csv').row();
  kb.text('⬅️ Back', 'adm:price');

  const body = [...header, ...sections].join('\n\n');
  await ctx.editMessageText(body, {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
});

// 📥 CSV export — emits the same data as a downloadable file with
// columns the admin can sort / filter / chart in Excel or Google
// Sheets. Quoted with RFC-4180 doubling so commas and quotes inside
// product names don't break parsing.
function csvEscape(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

adminBot.callbackQuery('adm:price:csv', async (ctx) => {
  await ctx.answerCallbackQuery({ text: 'Building CSV…' });
  const all = await listAllPriceOverrides();
  if (all.length === 0) {
    await ctx.reply(
      '📥 No overrides to export — set at least one before downloading.',
    );
    return;
  }
  const header = [
    'telegram_id',
    'username',
    'first_name',
    'product_id',
    'product_name',
    'default_price_usd',
    'override_price_usd',
    'delta_usd',
    'delta_pct',
    'set_by_admin_telegram_id',
    'set_at',
  ];
  const lines = [header.join(',')];
  for (const r of all) {
    const delta = r.price - r.product_default_price;
    const pct =
      r.product_default_price > 0
        ? ((delta / r.product_default_price) * 100).toFixed(2)
        : '';
    lines.push(
      [
        r.telegram_id,
        r.username ?? '',
        r.first_name ?? '',
        r.product_id,
        r.product_name,
        r.product_default_price.toFixed(2),
        r.price.toFixed(2),
        delta.toFixed(2),
        pct,
        r.created_by ?? '',
        r.updated_at,
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `price_overrides_${stamp}.csv`;
  await ctx.replyWithDocument(
    new InputFile(Buffer.from(lines.join('\n') + '\n', 'utf8'), filename),
    {
      caption:
        `📥 *Custom Prices — Export*\n` +
        `Rows: *${all.length}* · ` +
        `Generated: ${new Date().toUTCString()}`,
      parse_mode: 'Markdown',
    },
  );
});

// ============================================================
// 💸 Promos — qty-threshold flat-USDT auto-discounts.
//
// Hierarchical scope: per-user-per-product → per-user → per-product
// → default. Most specific match wins; ties on the same tier go to
// the largest discount. Resolution + integration live in
// `src/services/promo.ts` and the `pay:wallet:<id>` handler — this
// section is purely the admin CRUD UI.
//
// Routes:
//   adm:promo                     → list page 0
//   adm:promo:list:<page>         → paginated list
//   adm:promo:v:<id>              → view/edit a single promo
//   adm:promo:new                 → start the new-promo wizard
//   adm:promo:scope:<scope>       → scope chosen
//   adm:promo:np:<page>           → product picker (new promo)
//   adm:promo:npp:<product_id>    → product chosen
//   adm:promo:nameSkip            → skip optional promo name
//   adm:promo:toggle:<id>         → flip active flag
//   adm:promo:editq:<id>          → start "change min qty" prompt
//   adm:promo:editd:<id>          → start "change discount" prompt
//   adm:promo:editn:<id>          → start "change name" prompt
//   adm:promo:del:<id>            → delete confirmation
//   adm:promo:delok:<id>          → confirm delete
// ============================================================

const PROMO_PAGE_SIZE = 8;

/** Human-readable scope label for the list / detail views. */
function promoScopeLabel(p: Pick<DBPromo, 'product_id' | 'telegram_id'> & { product_name?: string | null }): string {
  if (p.telegram_id !== null && p.product_id !== null) {
    return `User \`${p.telegram_id}\` · Product ${p.product_name ? `*${p.product_name}*` : `#${p.product_id}`}`;
  }
  if (p.telegram_id !== null) return `User \`${p.telegram_id}\` · _any product_`;
  if (p.product_id !== null) return `_any user_ · Product ${p.product_name ? `*${p.product_name}*` : `#${p.product_id}`}`;
  return '_default — every user, every product_';
}

async function showPromoList(ctx: AppCtx, page: number): Promise<void> {
  ctx.session.adminFlow = undefined;
  const { rows, total } = await listPromos(page, PROMO_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / PROMO_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const lines: string[] = [
    '💸 *Promos*',
    '',
    `Active rule set — page ${safePage + 1}/${totalPages}  (total ${total})`,
  ];
  if (rows.length === 0) {
    lines.push('', '_No promos yet._', 'Tap *➕ Add promo* to create the first one.');
  } else {
    lines.push('');
    for (const p of rows) {
      const scope = promoScopeLabel(p);
      const active = p.active ? '🟢' : '⏸';
      const name = p.name?.trim() ? ` — _${p.name.trim()}_` : '';
      lines.push(
        `${active} \`#${p.id}\` qty ≥ *${p.min_qty}* → −*$${Number(p.discount_amount).toFixed(2)}*${name}`,
        `   ${scope}`,
      );
    }
  }
  const kb = new InlineKeyboard()
    .text('➕ Add promo', 'adm:promo:new')
    .row()
    .text('📊 Full overview', 'adm:promo:report:0')
    .row();
  for (const p of rows) {
    const scope = p.telegram_id && p.product_id
      ? 'U+P'
      : p.telegram_id
        ? 'User'
        : p.product_id
          ? 'Prod'
          : 'Def';
    kb.text(
      `#${p.id} ${scope} q≥${p.min_qty} −$${Number(p.discount_amount).toFixed(2)}`,
      `adm:promo:v:${p.id}`,
    ).row();
  }
  if (safePage > 0) kb.text('◀ Prev', `adm:promo:list:${safePage - 1}`);
  if (safePage + 1 < totalPages) kb.text('Next ▶', `adm:promo:list:${safePage + 1}`);
  kb.row().text('⬅️ Back', 'adm:root');
  await sendOrEdit(ctx, lines.join('\n'), kb);
}

adminBot.callbackQuery('adm:promo', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPromoList(ctx, 0);
});

/**
 * `/promo [add|list|edit <id>|delete <id>]` — convenience slash
 * command that lands on the same UI as the panel button. Subcommands
 * are best-effort shortcuts:
 *   /promo            → list page 0
 *   /promo list       → list page 0
 *   /promo add        → start the new-promo wizard (scope picker)
 *   /promo edit <id>  → jump to the promo card (toggle / edit / delete)
 *   /promo delete <id>→ jump to the delete confirmation
 */
adminBot.command('promo', async (ctx) => {
  ctx.session.adminFlow = undefined;
  const arg = (ctx.match ?? '').toString().trim();
  if (!arg || /^list\b/i.test(arg)) {
    await showPromoList(ctx, 0);
    return;
  }
  if (/^add\b/i.test(arg)) {
    const kb = new InlineKeyboard()
      .text('🌐 Default (everyone, every product)', 'adm:promo:scope:default')
      .row()
      .text('📦 Per product (any user)', 'adm:promo:scope:product')
      .row()
      .text('👤 Per user (any product)', 'adm:promo:scope:user')
      .row()
      .text('👤📦 Per user + product', 'adm:promo:scope:user_product')
      .row()
      .text('⬅️ Cancel', 'adm:promo');
    await ctx.reply(
      [
        '➕ *New promo — Step 1/4: Scope*',
        '',
        'Pick how widely this discount should apply.',
        'Most-specific scope wins at order time, so a per-user-per-product',
        'promo overrides a per-user one, etc.',
      ].join('\n'),
      { parse_mode: 'Markdown', reply_markup: kb },
    );
    return;
  }
  const editMatch = arg.match(/^edit\s+(\d+)\b/i);
  if (editMatch) {
    const id = Number(editMatch[1]);
    await showPromoCard(ctx, id);
    return;
  }
  const delMatch = arg.match(/^(?:delete|del|rm)\s+(\d+)\b/i);
  if (delMatch) {
    const id = Number(delMatch[1]);
    const p = await getPromo(id);
    if (!p) {
      await ctx.reply(`❓ Promo #${id} not found.`);
      return;
    }
    const kb = new InlineKeyboard()
      .text('🗑 Yes, delete', `adm:promo:delok:${id}`)
      .text('❌ Cancel', `adm:promo:v:${id}`);
    await ctx.reply(
      `🗑 *Delete promo #${id}?*\n\nThis cannot be undone.`,
      { parse_mode: 'Markdown', reply_markup: kb },
    );
    return;
  }
  await ctx.reply(
    [
      '💸 *Usage:*',
      '`/promo`              — list promos',
      '`/promo add`          — new promo wizard',
      '`/promo edit <id>`    — open a promo',
      '`/promo delete <id>`  — delete a promo',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
});

adminBot.callbackQuery(/^adm:promo:list:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPromoList(ctx, Number(ctx.match[1]));
});

/**
 * Send `text` either by editing the current callback message or, if
 * we're being called from a `message:text` handler (no callback to
 * edit), by replying with a fresh message. Used by every admin
 * helper that can be reached both ways.
 */
async function sendOrEdit(
  ctx: AppCtx,
  text: string,
  reply_markup: InlineKeyboard,
): Promise<void> {
  const opts = { parse_mode: 'Markdown' as const, reply_markup };
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, opts);
      return;
    } catch {
      // Fall through to a fresh reply if the source message can't
      // be edited (e.g. too old, deleted by user, etc.).
    }
  }
  await ctx.reply(text, opts);
}

/**
 * Render the deep-detail card for a single promo. Mirrors the
 * Custom Prices "user card" — beyond the raw row, also surfaces
 * the joined product (name / default price / stock), the joined
 * target user (handle / balance), the admin actor that created
 * the promo, and aggregate impact stats from the orders table.
 */
async function showPromoCard(ctx: AppCtx, promo_id: number): Promise<void> {
  ctx.session.adminFlow = undefined;
  const p = await getPromo(promo_id);
  if (!p) {
    await sendOrEdit(
      ctx,
      '❓ Promo not found.',
      new InlineKeyboard().text('⬅️ Back', 'adm:promo'),
    );
    return;
  }
  // Hydrate side-tables in parallel — none of them block on each
  // other and only the first three are guaranteed to fire.
  const [product, targetUser, actorUser, impact] = await Promise.all([
    p.product_id !== null ? getProduct(p.product_id) : Promise.resolve(null),
    p.telegram_id !== null ? findUserById(p.telegram_id) : Promise.resolve(null),
    p.created_by !== null ? findUserById(p.created_by) : Promise.resolve(null),
    getPromoImpact(p.id),
  ]);

  const scope = promoScopeLabel({ ...p, product_name: product?.name ?? null });
  const lines: string[] = [
    `💸 *Promo #${p.id}*`,
    '',
    `Status: ${p.active ? '🟢 *Active*' : '⏸ *Paused*'}`,
    `Scope: ${scope}`,
    `Min qty: *${p.min_qty}*`,
    `Discount: *$${Number(p.discount_amount).toFixed(2)}* off the line total`,
    `Name: ${p.name?.trim() ? `_${p.name.trim()}_` : '—'}`,
  ];

  if (product) {
    const stock = Number(product.stock);
    const price = Number(product.price);
    lines.push(
      '',
      `📦 *Product*`,
      `   • \`#${product.id}\` ${escapeHtml(product.name)}`,
      `   • Default price: *$${price.toFixed(2)}*`,
      `   • In stock: *${stock}*`,
    );
    // Cheap "savings preview" so the admin can sanity-check the
    // promo at a glance — what the buyer pays at the threshold qty.
    const grossAtMin = price * p.min_qty;
    const discountAtMin = Math.min(Number(p.discount_amount), grossAtMin);
    const totalAtMin = grossAtMin - discountAtMin;
    const pct =
      grossAtMin > 0 ? `${((discountAtMin / grossAtMin) * 100).toFixed(1)}%` : 'n/a';
    lines.push(
      `   • At qty *${p.min_qty}*: gross *$${grossAtMin.toFixed(2)}*` +
        ` → pay *$${totalAtMin.toFixed(2)}* (saves $${discountAtMin.toFixed(2)} / ${pct})`,
    );
  }

  if (targetUser) {
    const handle = targetUser.username
      ? `@${targetUser.username}`
      : (targetUser.first_name ?? '_no name_');
    const balance = Number(targetUser.balance ?? 0);
    lines.push(
      '',
      `👤 *Target user*`,
      `   • \`${targetUser.telegram_id}\` _(${escapeHtml(handle)})_`,
      `   • Wallet balance: *$${balance.toFixed(2)}*`,
    );
  } else if (p.telegram_id !== null) {
    // User-scoped promo set for a tg id that hasn't /start-ed yet.
    lines.push(
      '',
      `👤 *Target user*`,
      `   • \`${p.telegram_id}\` _(hasn't started the bot)_`,
    );
  }

  // Impact stats — only meaningful once at least one order has used
  // this promo, but we always render the section so the admin sees
  // "0 orders so far" for new rules.
  lines.push(
    '',
    `📊 *Impact (paid orders)*`,
    `   • Orders matched: *${impact.orders}*`,
    `   • Total discount given: *$${impact.total_discount.toFixed(2)}*`,
    `   • Last used: ${impact.last_used ? new Date(impact.last_used).toLocaleString('en-GB') : '—'}`,
  );

  // Audit trail.
  const actorHandle = actorUser
    ? actorUser.username
      ? `@${actorUser.username}`
      : (actorUser.first_name ?? `id ${actorUser.telegram_id}`)
    : null;
  lines.push(
    '',
    `Created: ${new Date(p.created_at).toLocaleString('en-GB')}`,
    p.created_by
      ? `By: ${actorHandle ? `_${escapeHtml(actorHandle)}_ ` : ''}\`${p.created_by}\``
      : 'By: _—_',
    `Updated: ${new Date(p.updated_at).toLocaleString('en-GB')}`,
  );

  const kb = new InlineKeyboard()
    .text(p.active ? '⏸ Pause' : '▶️ Activate', `adm:promo:toggle:${p.id}`)
    .row()
    .text('✏️ Min qty', `adm:promo:editq:${p.id}`)
    .text('💵 Discount', `adm:promo:editd:${p.id}`)
    .row()
    .text('🏷 Name', `adm:promo:editn:${p.id}`)
    .row()
    .text('🗑 Delete', `adm:promo:del:${p.id}`)
    .row()
    .text('⬅️ Back to list', 'adm:promo');
  await sendOrEdit(ctx, lines.join('\n'), kb);
}

adminBot.callbackQuery(/^adm:promo:v:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPromoCard(ctx, Number(ctx.match[1]));
});

adminBot.callbackQuery(/^adm:promo:toggle:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  const p = await getPromo(id);
  if (!p) {
    await ctx.answerCallbackQuery({ text: 'Not found.', show_alert: true });
    return;
  }
  await updatePromo(id, { active: !p.active });
  await ctx.answerCallbackQuery({ text: !p.active ? 'Activated' : 'Paused' });
  await showPromoCard(ctx, id);
});

adminBot.callbackQuery(/^adm:promo:del:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = Number(ctx.match[1]);
  const kb = new InlineKeyboard()
    .text('🗑 Yes, delete', `adm:promo:delok:${id}`)
    .text('❌ Cancel', `adm:promo:v:${id}`);
  await ctx.editMessageText(
    `🗑 *Delete promo #${id}?*\n\nThis cannot be undone.`,
    { parse_mode: 'Markdown', reply_markup: kb },
  );
});

adminBot.callbackQuery(/^adm:promo:delok:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  await deletePromo(id);
  await ctx.answerCallbackQuery({ text: 'Deleted' });
  await showPromoList(ctx, 0);
});

// -------- Full overview (paginated, grouped by scope tier) -------
//
// Mirrors `adm:price:report` — groups every promo into the four
// scope tiers (default / per-product / per-user / per-user-product),
// shows totals + impact stats per row, and offers a CSV export.
//
// Tier ordering matches the runtime resolver: most-specific first.

const PROMO_REPORT_TIERS = [
  { key: 'user_product', label: '👤📦 Per user + product', tier: 3 },
  { key: 'user', label: '👤 Per user (any product)', tier: 2 },
  { key: 'product', label: '📦 Per product (any user)', tier: 1 },
  { key: 'default', label: '🌐 Default (everyone, every product)', tier: 0 },
] as const;

const PROMO_REPORT_PER_PAGE = 4; // 4 tier blocks per page max — keeps under Telegram's 4096-char limit comfortably.

function tierOf(p: { product_id: number | null; telegram_id: number | null }): number {
  if (p.telegram_id !== null && p.product_id !== null) return 3;
  if (p.telegram_id !== null) return 2;
  if (p.product_id !== null) return 1;
  return 0;
}

adminBot.callbackQuery(/^adm:promo:report:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const page = Math.max(0, Number(ctx.match[1]));
  const all = await listAllPromos();
  if (all.length === 0) {
    await ctx.editMessageText(
      '📊 *Promos — Overview*\n\n_No promos yet._\n\nTap *➕ Add promo* on the previous screen.',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('⬅️ Back', 'adm:promo'),
      },
    );
    return;
  }

  // Resolve impact stats in parallel (one query per promo). Cheap
  // since the partial index on orders.promo_id keeps each query
  // tight even when there are many promos.
  const impactArr = await Promise.all(all.map((p) => getPromoImpact(p.id)));
  const impactMap = new Map<number, (typeof impactArr)[number]>();
  all.forEach((p, i) => impactMap.set(p.id, impactArr[i]!));

  // Group by tier — already sorted by created_at desc inside listAllPromos.
  const buckets = new Map<number, typeof all>();
  for (const p of all) {
    const t = tierOf(p);
    const arr = buckets.get(t) ?? [];
    arr.push(p);
    buckets.set(t, arr);
  }
  const populated = PROMO_REPORT_TIERS.filter((t) => (buckets.get(t.tier) ?? []).length > 0);
  const totalPages = Math.max(1, Math.ceil(populated.length / PROMO_REPORT_PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * PROMO_REPORT_PER_PAGE;
  const end = Math.min(start + PROMO_REPORT_PER_PAGE, populated.length);

  // Headline totals.
  const totalActive = all.filter((p) => p.active).length;
  const totalImpact = impactArr.reduce(
    (acc, x) => ({
      orders: acc.orders + x.orders,
      total_discount: acc.total_discount + x.total_discount,
    }),
    { orders: 0, total_discount: 0 },
  );

  const header = [
    '📊 *Promos — Overview*',
    `Promos: *${all.length}* (active *${totalActive}*) · ` +
      `Lifetime discounted *$${totalImpact.total_discount.toFixed(2)}* across *${totalImpact.orders}* orders` +
      ` · Page ${safePage + 1}/${totalPages}`,
    '',
  ];

  const sections: string[] = [];
  for (let i = start; i < end; i++) {
    const tierMeta = populated[i]!;
    const rows = buckets.get(tierMeta.tier) ?? [];
    const tierImpact = rows.reduce(
      (acc, r) => {
        const im = impactMap.get(r.id)!;
        return {
          orders: acc.orders + im.orders,
          total_discount: acc.total_discount + im.total_discount,
        };
      },
      { orders: 0, total_discount: 0 },
    );
    const lines: string[] = [
      `${tierMeta.label}`,
      `   _${rows.length} rule${rows.length === 1 ? '' : 's'} · ` +
        `${tierImpact.orders} orders · ` +
        `$${tierImpact.total_discount.toFixed(2)} given_`,
    ];
    for (const r of rows) {
      const status = r.active ? '🟢' : '⏸';
      const name = r.name?.trim() ? ` — _${r.name.trim()}_` : '';
      const userPart =
        r.telegram_id !== null
          ? ` user \`${r.telegram_id}\`${
              r.username ? ` (@${r.username})` : r.first_name ? ` (${escapeHtml(r.first_name)})` : ''
            }`
          : '';
      const productPart =
        r.product_id !== null
          ? ` · *${escapeHtml(r.product_name ?? `#${r.product_id}`)}*`
          : '';
      const im = impactMap.get(r.id)!;
      lines.push(
        `   • ${status} \`#${r.id}\` qty ≥ *${r.min_qty}* → −*$${Number(r.discount_amount).toFixed(2)}*${name}` +
          `${userPart}${productPart}`,
        `       impact: ${im.orders} orders · $${im.total_discount.toFixed(2)}`,
      );
    }
    sections.push(lines.join('\n'));
  }

  const kb = new InlineKeyboard();
  if (safePage > 0) kb.text('◀ Prev', `adm:promo:report:${safePage - 1}`);
  if (safePage + 1 < totalPages) kb.text('Next ▶', `adm:promo:report:${safePage + 1}`);
  kb.row().text('📥 Export CSV', 'adm:promo:csv').row().text('⬅️ Back', 'adm:promo');

  await ctx.editMessageText([...header, ...sections].join('\n\n'), {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
});

adminBot.callbackQuery('adm:promo:csv', async (ctx) => {
  await ctx.answerCallbackQuery({ text: 'Building CSV…' });
  const all = await listAllPromos();
  if (all.length === 0) {
    await ctx.reply('📥 No promos to export — add at least one before downloading.');
    return;
  }
  const impactArr = await Promise.all(all.map((p) => getPromoImpact(p.id)));
  const header = [
    'promo_id',
    'scope',
    'tier',
    'telegram_id',
    'username',
    'first_name',
    'product_id',
    'product_name',
    'product_default_price',
    'product_stock',
    'min_qty',
    'discount_amount_usd',
    'name',
    'active',
    'orders_used',
    'total_discount_given_usd',
    'last_used_at',
    'created_at',
    'updated_at',
    'created_by_telegram_id',
    'created_by_username',
  ];
  const tierName: Record<number, string> = {
    3: 'user_product',
    2: 'user',
    1: 'product',
    0: 'default',
  };
  const lines = [header.join(',')];
  for (let i = 0; i < all.length; i++) {
    const r = all[i]!;
    const im = impactArr[i]!;
    const t = tierOf(r);
    lines.push(
      [
        r.id,
        tierName[t],
        t,
        r.telegram_id ?? '',
        r.username ?? '',
        r.first_name ?? '',
        r.product_id ?? '',
        r.product_name ?? '',
        r.product_default_price !== null ? r.product_default_price.toFixed(2) : '',
        r.product_stock ?? '',
        r.min_qty,
        Number(r.discount_amount).toFixed(2),
        r.name ?? '',
        r.active ? 'true' : 'false',
        im.orders,
        im.total_discount.toFixed(2),
        im.last_used ?? '',
        r.created_at,
        r.updated_at,
        r.created_by ?? '',
        r.created_by_username ?? '',
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `promos_${stamp}.csv`;
  await ctx.replyWithDocument(
    new InputFile(Buffer.from(lines.join('\n') + '\n', 'utf8'), filename),
    {
      caption:
        `📥 *Promos — Export*\n` +
        `Rows: *${all.length}* · ` +
        `Generated: ${new Date().toUTCString()}`,
      parse_mode: 'Markdown',
    },
  );
});

// -------- New promo wizard --------

adminBot.callbackQuery('adm:promo:new', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = undefined;
  const kb = new InlineKeyboard()
    .text('🌐 Default (everyone, every product)', 'adm:promo:scope:default')
    .row()
    .text('📦 Per product (any user)', 'adm:promo:scope:product')
    .row()
    .text('👤 Per user (any product)', 'adm:promo:scope:user')
    .row()
    .text('👤📦 Per user + product', 'adm:promo:scope:user_product')
    .row()
    .text('⬅️ Cancel', 'adm:promo');
  await ctx.editMessageText(
    [
      '➕ *New promo — Step 1/4: Scope*',
      '',
      'Pick how widely this discount should apply.',
      'Most-specific scope wins at order time, so a per-user-per-product',
      'promo overrides a per-user one, etc.',
    ].join('\n'),
    { parse_mode: 'Markdown', reply_markup: kb },
  );
});

async function showPromoNewProductPicker(
  ctx: AppCtx,
  page: number,
): Promise<void> {
  const flow = ctx.session.adminFlow;
  if (flow?.type !== 'promo_add' || flow.step !== 'pick_product') {
    await ctx.editMessageText(
      '❓ Lost the promo flow — start over.',
      { reply_markup: new InlineKeyboard().text('⬅️ Back', 'adm:promo') },
    );
    return;
  }
  const { rows, total } = await listAllProducts(page, PROMO_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / PROMO_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const lines = [
    '➕ *New promo — pick a product*',
    `Page ${safePage + 1}/${totalPages}  (total ${total})`,
    '',
    'Tap a product to attach the promo to it.',
  ];
  const kb = new InlineKeyboard();
  for (const p of rows) {
    kb.text(
      `${p.name.slice(0, 40)} — $${Number(p.price).toFixed(2)}`,
      `adm:promo:npp:${p.id}`,
    ).row();
  }
  if (safePage > 0) kb.text('◀ Prev', `adm:promo:np:${safePage - 1}`);
  if (safePage + 1 < totalPages) kb.text('Next ▶', `adm:promo:np:${safePage + 1}`);
  kb.row().text('⬅️ Cancel', 'adm:promo');
  await ctx.editMessageText(lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
}

async function promptPromoMinQty(ctx: AppCtx): Promise<void> {
  await ctx.editMessageText(
    [
      '➕ *New promo — Step 3/4: Minimum qty*',
      '',
      'Send the minimum quantity that triggers this promo.',
      'Whole number ≥ 1, e.g. `10`.',
      '',
      'Send `/cancel` to abort.',
    ].join('\n'),
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('⬅️ Cancel', 'adm:promo'),
    },
  );
}

adminBot.callbackQuery(/^adm:promo:scope:(default|product|user|user_product)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const scope = ctx.match[1] as 'default' | 'product' | 'user' | 'user_product';
  if (scope === 'default') {
    ctx.session.adminFlow = {
      type: 'promo_add',
      step: 'min_qty',
      data: { scope, product_id: null, telegram_id: null },
    };
    await promptPromoMinQty(ctx);
    return;
  }
  if (scope === 'product') {
    ctx.session.adminFlow = {
      type: 'promo_add',
      step: 'pick_product',
      data: { scope, telegram_id: null },
    };
    await showPromoNewProductPicker(ctx, 0);
    return;
  }
  // user / user_product → first ask for telegram id or @username.
  ctx.session.adminFlow = {
    type: 'promo_add',
    step: 'pick_user',
    data: { scope },
  };
  await ctx.editMessageText(
    [
      '➕ *New promo — Step 2: Pick user*',
      '',
      'Send the user\'s numeric Telegram ID or `@username`.',
      '',
      '`@username` only works for users who have already started the bot at least once.',
      'Numeric IDs work for anyone.',
      '',
      'Send `/cancel` to abort.',
    ].join('\n'),
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('⬅️ Cancel', 'adm:promo'),
    },
  );
});

adminBot.callbackQuery(/^adm:promo:np:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showPromoNewProductPicker(ctx, Number(ctx.match[1]));
});

adminBot.callbackQuery(/^adm:promo:npp:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const product_id = Number(ctx.match[1]);
  const flow = ctx.session.adminFlow;
  if (flow?.type !== 'promo_add' || flow.step !== 'pick_product') {
    await ctx.editMessageText('❓ Lost the promo flow — start over.', {
      reply_markup: new InlineKeyboard().text('⬅️ Back', 'adm:promo'),
    });
    return;
  }
  const prod = await getProduct(product_id);
  if (!prod) {
    await ctx.answerCallbackQuery({ text: 'Product not found.', show_alert: true });
    return;
  }
  ctx.session.adminFlow = {
    type: 'promo_add',
    step: 'min_qty',
    data: {
      scope: flow.data.scope,
      product_id,
      telegram_id: flow.data.telegram_id,
    },
  };
  await promptPromoMinQty(ctx);
});

adminBot.callbackQuery(/^adm:promo:editq:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = Number(ctx.match[1]);
  ctx.session.adminFlow = { type: 'promo_edit_qty', step: 'value', data: { promo_id: id } };
  await ctx.editMessageText(
    `✏️ *Promo #${id} — Min qty*\n\nSend the new minimum quantity (whole number ≥ 1).\n\n\`/cancel\` to abort.`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('⬅️ Cancel', `adm:promo:v:${id}`),
    },
  );
});

adminBot.callbackQuery(/^adm:promo:editd:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = Number(ctx.match[1]);
  ctx.session.adminFlow = { type: 'promo_edit_discount', step: 'value', data: { promo_id: id } };
  await ctx.editMessageText(
    `💵 *Promo #${id} — Discount*\n\nSend the new flat discount in USDT (e.g. \`5\` or \`12.5\`).\n\n\`/cancel\` to abort.`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('⬅️ Cancel', `adm:promo:v:${id}`),
    },
  );
});

adminBot.callbackQuery(/^adm:promo:editn:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = Number(ctx.match[1]);
  ctx.session.adminFlow = { type: 'promo_edit_name', step: 'value', data: { promo_id: id } };
  await ctx.editMessageText(
    `🏷 *Promo #${id} — Name*\n\nSend a short label shown to buyers, or \`-\` to clear it.\n\n\`/cancel\` to abort.`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('⬅️ Cancel', `adm:promo:v:${id}`),
    },
  );
});

adminBot.callbackQuery('adm:promo:nameSkip', async (ctx) => {
  await ctx.answerCallbackQuery();
  const flow = ctx.session.adminFlow;
  if (flow?.type !== 'promo_add' || flow.step !== 'name') {
    await ctx.editMessageText('❓ Lost the promo flow — start over.', {
      reply_markup: new InlineKeyboard().text('⬅️ Back', 'adm:promo'),
    });
    return;
  }
  // Mirror the message:text-handler error shape so admins see the
  // real Postgres error (e.g. missing table) instead of a stuck UI.
  let created;
  try {
    created = await addPromo({
      product_id: flow.data.product_id,
      telegram_id: flow.data.telegram_id,
      name: null,
      min_qty: flow.data.min_qty,
      discount_amount: flow.data.discount_amount,
      created_by: ctx.from!.id,
    });
  } catch (err) {
    logger.error({ err, flow }, 'promo nameSkip addPromo failed');
    ctx.session.adminFlow = undefined;
    const e = err as { code?: string; message?: string };
    const detail =
      e?.code === '42P01'
        ? 'The `promos` table is missing — apply migrations 0013 / 0014.'
        : (e?.message ?? String(err)).slice(0, 500);
    await ctx.editMessageText(
      `⚠️ *Could not save promo*\n\n\`${escapeHtml(detail)}\``,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('⬅️ Back', 'adm:promo'),
      },
    );
    return;
  }
  ctx.session.adminFlow = undefined;
  try {
    await showPromoCard(ctx, created.id);
  } catch (err) {
    logger.error({ err, promo_id: created.id }, 'showPromoCard after nameSkip failed');
    await ctx.reply(
      `✅ Promo *#${created.id}* saved.\n\n_(Detail card render failed — open it from /promo list.)_`,
      { parse_mode: 'Markdown', reply_markup: rootMenu() },
    );
  }
});

// ============================================================
// Multi-step input handler — fired for any text msg from admin
// when session.adminFlow is set.
// ============================================================
adminBot.on('message:text', async (ctx, next) => {
  const flow = ctx.session.adminFlow;
  if (!flow) return next();
  // Defence in depth: if for any reason a non-admin has a flow set
  // (shouldn't happen), discard it silently.
  if (!ctx.from || !(await isAdmin(ctx.from.id))) {
    ctx.session.adminFlow = undefined;
    return next();
  }

  const text = ctx.message.text.trim();

  if (text === '/cancel') {
    ctx.session.adminFlow = undefined;
    await ctx.reply('❌ Cancelled.', { reply_markup: rootMenu() });
    return;
  }

  if (text.startsWith('/')) {
    // Don't capture other commands; let them through
    return next();
  }

  try {
    if (flow.type === 'add_category') {
      if (flow.step === 'name') {
        ctx.session.adminFlow = {
          type: 'add_category',
          step: 'emoji',
          data: { name: text },
        };
        const kb = new InlineKeyboard().text('Skip emoji', 'adm:cat:skip_emoji');
        backRow(kb);
        await ctx.reply(
          `🗂 Category name: *${text}*\n\nNow send a single emoji for the category, or tap *Skip emoji*.`,
          { parse_mode: 'Markdown', reply_markup: kb },
        );
      } else if (flow.step === 'emoji') {
        const cat = await addCategory(flow.data.name, text);
        ctx.session.adminFlow = undefined;
        cache.del('cats');
        await ctx.reply(
          `✅ Category *${cat.name}* added (id=${cat.id}).`,
          { parse_mode: 'Markdown', reply_markup: rootMenu() },
        );
      }
      return;
    }

    if (flow.type === 'add_product') {
      if (flow.step === 'name') {
        ctx.session.adminFlow = {
          type: 'add_product',
          step: 'price',
          data: { ...flow.data, name: text },
        };
        await ctx.reply(`Product name: *${text}*\n\nSend the *price* (number, e.g. \`9.99\`).`, {
          parse_mode: 'Markdown',
        });
      } else if (flow.step === 'price') {
        const price = Number(text);
        if (!Number.isFinite(price) || price < 0) {
          await ctx.reply('❌ Bad price. Send a number like `9.99`.');
          return;
        }
        ctx.session.adminFlow = {
          type: 'add_product',
          step: 'unlimited',
          data: { ...flow.data, price },
        };
        // Two-button question: skips the integer count when admin
        // picks "Unlimited". This is the new flow the bot owner
        // explicitly asked for ("no products asking for stock brooo").
        const kb = new InlineKeyboard()
          .text('♾ Unlimited', 'adm:prod:unl:yes')
          .text('🔢 Set Count', 'adm:prod:unl:no');
        await ctx.reply(
          [
            '*Unlimited stock?*',
            '',
            'Tap *Unlimited* if you can deliver this product as many ',
            'times as needed (no per-buy decrement). Tap *Set Count* ',
            'to set an integer stock that decrements on each sale.',
          ].join('\n'),
          { parse_mode: 'Markdown', reply_markup: kb },
        );
      } else if (flow.step === 'unlimited') {
        // Free-form text in this step is unexpected — the user is
        // supposed to tap one of the inline buttons. Re-prompt.
        await ctx.reply('Tap *Unlimited* or *Set Count* on the buttons above.', {
          parse_mode: 'Markdown',
        });
        return;
      } else if (flow.step === 'stock') {
        const stock = Number(text);
        if (!Number.isInteger(stock) || stock < 0) {
          await ctx.reply('❌ Bad stock. Send an integer ≥ 0.');
          return;
        }
        ctx.session.adminFlow = {
          type: 'add_product',
          step: 'warranty',
          data: { ...flow.data, stock },
        };
        const kb = new InlineKeyboard().text('Skip', 'adm:prod:skip:warranty');
        await ctx.reply('Send the *warranty* text (or tap Skip).', {
          parse_mode: 'Markdown',
          reply_markup: kb,
        });
      } else if (flow.step === 'warranty') {
        ctx.session.adminFlow = {
          type: 'add_product',
          step: 'description',
          data: { ...flow.data, warranty: text },
        };
        const kb = new InlineKeyboard().text('Skip', 'adm:prod:skip:description');
        await ctx.reply('Send the *description* (or Skip).', {
          parse_mode: 'Markdown',
          reply_markup: kb,
        });
      } else if (flow.step === 'description') {
        ctx.session.adminFlow = {
          type: 'add_product',
          step: 'note',
          data: { ...flow.data, description: text },
        };
        const kb = new InlineKeyboard().text('Skip', 'adm:prod:skip:note');
        await ctx.reply(
          'Send the *View Note* text shown when buyer taps 📝 View Note (or Skip).',
          { parse_mode: 'Markdown', reply_markup: kb },
        );
      } else if (flow.step === 'note') {
        ctx.session.adminFlow = {
          type: 'add_product',
          step: 'items',
          data: { ...flow.data, note: text },
        };
        const kb = new InlineKeyboard().text('Skip', 'adm:prod:skip:items');
        await ctx.reply(
          [
            '📦 *Send the deliverables (items pool)* — one payload per line.',
            'These are the actual things buyers receive (acc emails+passwords, links, codes, etc).',
            'Example:',
            '```',
            'email1@example.com|password123',
            'email2@example.com|password456',
            'https://account-link/...',
            '```',
            '',
            'Or tap *Skip* to leave the pool empty (you can always add items later from the Edit screen).',
          ].join('\n'),
          { parse_mode: 'Markdown', reply_markup: kb },
        );
      } else if (flow.step === 'items') {
        const payloads = text
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        await finalizeProduct(ctx, flow.data, payloads);
      }
      return;
    }

    // -------- Per-product editor: text-based steps --------
    if (flow.type === 'edit_product_emoji') {
      // Premium emoji is sent as a `custom_emoji` entity attached to
      // a text message — the visible text is the unicode fallback,
      // the entity carries the `custom_emoji_id`. Read it directly
      // off the message.
      const ent = ctx.message.entities?.find(
        (e) => e.type === 'custom_emoji' && 'custom_emoji_id' in e,
      ) as { custom_emoji_id: string } | undefined;
      if (!ent) {
        await ctx.reply(
          '❌ I didn\'t see a premium emoji in that message. Try again with a single premium emoji.',
        );
        return;
      }
      await updateProduct(flow.data.product_id, { emoji_id: ent.custom_emoji_id });
      ctx.session.adminFlow = undefined;
      await ctx.reply('✅ Premium emoji saved.');
      await showProductEditor(ctx, flow.data.product_id, flow.data.page);
      return;
    }
    if (flow.type === 'edit_product_note_text') {
      await updateProduct(flow.data.product_id, { note: text });
      ctx.session.adminFlow = undefined;
      await ctx.reply('✅ Note text saved.');
      await showProductEditor(ctx, flow.data.product_id, flow.data.page);
      return;
    }
    if (flow.type === 'edit_product_tutorial_text') {
      await updateProduct(flow.data.product_id, { tutorial_text: text });
      ctx.session.adminFlow = undefined;
      await ctx.reply('✅ Tutorial text saved.');
      await showProductEditor(ctx, flow.data.product_id, flow.data.page);
      return;
    }
    if (flow.type === 'edit_product_tutorial_url') {
      if (!/^https?:\/\//.test(text)) {
        await ctx.reply('❌ URL must start with `http://` or `https://`.');
        return;
      }
      await updateProduct(flow.data.product_id, { tutorial_url: text });
      ctx.session.adminFlow = undefined;
      await ctx.reply('✅ Tutorial URL saved.');
      await showProductEditor(ctx, flow.data.product_id, flow.data.page);
      return;
    }
    if (flow.type === 'edit_product_items') {
      const payloads = text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (payloads.length === 0) {
        await ctx.reply('❌ No payloads found.');
        return;
      }
      await addProductItems(flow.data.product_id, payloads);
      ctx.session.adminFlow = undefined;
      await ctx.reply(`✅ Added ${payloads.length} items to the pool.`);
      await showProductEditor(ctx, flow.data.product_id, flow.data.page);
      return;
    }
    if (flow.type === 'edit_product_price') {
      const price = Number(text);
      if (!Number.isFinite(price) || price < 0) {
        await ctx.reply('❌ Bad price. Send a number like `9.99`.');
        return;
      }
      await updateProduct(flow.data.product_id, { price });
      ctx.session.adminFlow = undefined;
      await ctx.reply('✅ Price updated.');
      await showProductEditor(ctx, flow.data.product_id, flow.data.page);
      return;
    }
    if (flow.type === 'edit_product_stock') {
      const stock = Number(text);
      if (!Number.isInteger(stock) || stock < 0) {
        await ctx.reply('❌ Bad stock. Send an integer ≥ 0.');
        return;
      }
      await updateProduct(flow.data.product_id, { stock });
      ctx.session.adminFlow = undefined;
      await ctx.reply('✅ Stock updated.');
      await showProductEditor(ctx, flow.data.product_id, flow.data.page);
      return;
    }
    if (flow.type === 'edit_product_name') {
      await updateProduct(flow.data.product_id, { name: text });
      ctx.session.adminFlow = undefined;
      await ctx.reply('✅ Name updated.');
      await showProductEditor(ctx, flow.data.product_id, flow.data.page);
      return;
    }
    if (flow.type === 'edit_bot_tutorial_text') {
      await setBotTutorialField('text', text, ctx.from!.id);
      ctx.session.adminFlow = undefined;
      await ctx.reply('✅ Bot Tutorial text saved.');
      return;
    }
    if (flow.type === 'edit_bot_tutorial_url') {
      if (!/^https?:\/\//.test(text)) {
        await ctx.reply('❌ URL must start with `http://` or `https://`.');
        return;
      }
      await setBotTutorialField('url', text, ctx.from!.id);
      ctx.session.adminFlow = undefined;
      await ctx.reply('✅ Bot Tutorial URL saved.');
      return;
    }

    if (flow.type === 'add_payment') {
      if (flow.step === 'name') {
        ctx.session.adminFlow = {
          type: 'add_payment',
          step: 'instructions',
          data: { name: text },
        };
        await ctx.reply(
          'Send the *instructions* (what users should do to pay; e.g. wallet address + reply with txid).',
          { parse_mode: 'Markdown' },
        );
      } else if (flow.step === 'instructions') {
        ctx.session.adminFlow = {
          type: 'add_payment',
          step: 'min_amount',
          data: { ...flow.data, instructions: text },
        };
        await ctx.reply('Send the *minimum amount* (number).', { parse_mode: 'Markdown' });
      } else if (flow.step === 'min_amount') {
        const min = Number(text);
        if (!Number.isFinite(min) || min < 0) {
          await ctx.reply('❌ Bad amount.');
          return;
        }
        const m = await addPaymentMethod({
          name: flow.data.name,
          instructions: flow.data.instructions,
          min_amount: min,
        });
        ctx.session.adminFlow = undefined;
        await ctx.reply(`✅ Payment method *${m.name}* added (id=${m.id}).`, {
          parse_mode: 'Markdown',
          reply_markup: rootMenu(),
        });
      }
      return;
    }

    if (flow.type === 'add_gift') {
      // The whole gift-create flow uses HTML — Markdown V1 trips on
      // any underscore in a code (e.g. `MY_CODE`) and silently rejects
      // editMessageText / sendMessage, which surfaced as a generic
      // "Something went wrong. Cancelled." at every step.
      if (flow.step === 'code') {
        if (!/^[A-Z0-9_-]{3,40}$/i.test(text)) {
          await ctx.reply(
            '⚠️ Code must be 3–40 chars: letters, digits, <code>_</code> or <code>-</code>.',
            { parse_mode: 'HTML' },
          );
          return;
        }
        const code = text.toUpperCase();
        ctx.session.adminFlow = { type: 'add_gift', step: 'amount', data: { code } };
        await ctx.reply(
          `Send the <b>amount in USDT</b> to credit when <code>${escapeHtml(code)}</code> is redeemed.`,
          { parse_mode: 'HTML' },
        );
      } else if (flow.step === 'amount') {
        const amount = Number(text);
        if (!Number.isFinite(amount) || amount <= 0) {
          await ctx.reply('⚠️ Send a positive number.');
          return;
        }
        ctx.session.adminFlow = {
          type: 'add_gift',
          step: 'per_user_limit',
          data: { code: flow.data.code, amount },
        };
        await ctx.reply(
          'How many times can a <b>single user</b> redeem this code? Send the number (default <code>1</code>).',
          { parse_mode: 'HTML' },
        );
      } else if (flow.step === 'per_user_limit') {
        const lim = Number(text);
        if (!Number.isInteger(lim) || lim < 1) {
          await ctx.reply(
            '⚠️ Send a positive integer (e.g. <code>1</code>).',
            { parse_mode: 'HTML' },
          );
          return;
        }
        ctx.session.adminFlow = {
          type: 'add_gift',
          step: 'max_redemptions',
          data: { code: flow.data.code, amount: flow.data.amount, per_user_limit: lim },
        };
        await ctx.reply(
          'Total redemption <b>cap</b> across all users? Send a number, or <code>-</code> for unlimited.',
          { parse_mode: 'HTML' },
        );
      } else if (flow.step === 'max_redemptions') {
        let max: number | null = null;
        if (text !== '-' && text !== '') {
          const n = Number(text);
          if (!Number.isInteger(n) || n < 1) {
            await ctx.reply(
              '⚠️ Send a positive integer or <code>-</code> for unlimited.',
              { parse_mode: 'HTML' },
            );
            return;
          }
          max = n;
        }
        try {
          const gift = await createGiftCode({
            code: flow.data.code,
            amount: flow.data.amount,
            per_user_limit: flow.data.per_user_limit,
            max_redemptions: max,
            created_by: ctx.from!.id,
          });
          ctx.session.adminFlow = undefined;
          await ctx.reply(
            `✅ Gift code <code>${escapeHtml(gift.code)}</code> created — <b>${gift.amount} USDT</b>, ` +
              `per-user ${gift.per_user_limit}, total ${gift.max_redemptions ?? '∞'}.`,
            { parse_mode: 'HTML', reply_markup: rootMenu() },
          );
        } catch (err) {
          // Most likely cause: migration 0007 not applied → the
          // `gift_codes` table doesn't exist. Surface this so the
          // operator knows to run it instead of seeing the generic
          // "Something went wrong" copy.
          ctx.session.adminFlow = undefined;
          const e = err as { code?: string; message?: string } | undefined;
          const detail = e?.message
            ? ` <i>(${escapeHtml(e.code ?? 'err')}: ${escapeHtml(e.message)})</i>`
            : '';
          await ctx.reply(
            '⚠️ Could not create gift code — the bot operator must apply ' +
              'migration <code>0007_gift_codes.sql</code>. ' +
              'If already applied, reload the API schema in Supabase.' +
              detail,
            { parse_mode: 'HTML', reply_markup: rootMenu() },
          );
        }
      }
      return;
    }

    if (flow.type === 'set_text') {
      if (flow.step === 'key') {
        ctx.session.adminFlow = { type: 'set_text', step: 'value', data: { key: text } };
        await ctx.reply(`Send the new value for \`${text}\`:`, { parse_mode: 'Markdown' });
      } else if (flow.step === 'value') {
        await setText(flow.data.key, text, ctx.from!.id);
        ctx.session.adminFlow = undefined;
        await ctx.reply(`✅ Text \`${flow.data.key}\` updated.`, {
          parse_mode: 'Markdown',
          reply_markup: rootMenu(),
        });
      }
      return;
    }

    if (flow.type === 'set_emoji') {
      if (flow.step === 'key') {
        // Legacy slash-command path: admin typed the key first.
        ctx.session.adminFlow = { type: 'set_emoji', step: 'value', data: { key: text } };
        await ctx.reply(
          `Send the emoji for \`${text}\`. You can send a *premium* emoji ` +
            'directly (the bot reads its `custom_emoji_id`), a plain unicode ' +
            'emoji, or `<unicode> <custom_emoji_id>`.',
          { parse_mode: 'Markdown' },
        );
        return;
      }
      // step === 'value'
      let unicode: string | undefined;
      let customId: string | undefined;

      // Preferred path: the admin forwarded / typed a premium emoji
      // — Telegram surfaces it as a `custom_emoji` MessageEntity
      // alongside the unicode fallback in the message text.
      const ce = (ctx.message.entities ?? []).find(
        (e) => e.type === 'custom_emoji' && 'custom_emoji_id' in e,
      ) as { offset: number; length: number; custom_emoji_id: string } | undefined;
      if (ce) {
        // Slice from the original (un-trimmed) text using the entity
        // offsets (UTF-16 code units, matching String.prototype.length).
        const raw = ctx.message.text;
        unicode = raw.slice(ce.offset, ce.offset + ce.length);
        customId = ce.custom_emoji_id;
      } else {
        // Fallback: parse `<unicode> [custom_emoji_id]` from the text.
        const parts = text.split(/\s+/, 2);
        unicode = parts[0];
        customId = parts[1];
      }

      if (!unicode) {
        await ctx.reply('❌ Empty value.');
        return;
      }
      await setEmoji(flow.data.key, unicode, customId, ctx.from!.id);
      ctx.session.adminFlow = undefined;
      const idLine = customId
        ? ` (premium id \`${customId}\`)`
        : '';
      await ctx.reply(
        `✅ Emoji \`${flow.data.key}\` updated → ${unicode}${idLine}.`,
        { parse_mode: 'Markdown', reply_markup: rootMenu() },
      );
      return;
    }

    if (flow.type === 'set_btnicon') {
      // Per-button icon override → stored under `btnicon.<key>`,
      // separate from the shared `emoji.<key>` map. Requires a real
      // premium emoji (custom_emoji_id) — plain unicode can't be used
      // in `icon_custom_emoji_id` per Bot API 9.4.
      const ce = (ctx.message.entities ?? []).find(
        (e) => e.type === 'custom_emoji' && 'custom_emoji_id' in e,
      ) as { offset: number; length: number; custom_emoji_id: string } | undefined;
      let unicode: string | undefined;
      let customId: string | undefined;
      if (ce) {
        const raw = ctx.message.text;
        unicode = raw.slice(ce.offset, ce.offset + ce.length);
        customId = ce.custom_emoji_id;
      } else {
        const parts = text.split(/\s+/, 2);
        unicode = parts[0];
        customId = parts[1];
      }
      if (!unicode || !customId || !/^\d{8,}$/.test(customId)) {
        await ctx.reply(
          '❌ This needs a *premium* emoji. Send a premium emoji message ' +
            'directly (the bot will read its `custom_emoji_id`), or type ' +
            '`<unicode> <custom_emoji_id>` with a numeric id.',
          { parse_mode: 'Markdown' },
        );
        return;
      }
      await setButtonIcon(flow.data.btnKey, unicode, customId, ctx.from!.id);
      ctx.session.adminFlow = undefined;
      await ctx.reply(
        `✅ Button \`${flow.data.btnKey}\` icon updated → ${unicode} ` +
          `(premium id \`${customId}\`).`,
        { parse_mode: 'Markdown', reply_markup: rootMenu() },
      );
      return;
    }

    if (flow.type === 'set_color') {
      // The picker UI uses callback buttons; if we get here, the user
      // typed text instead of tapping. Treat the text as the button
      // key and offer a colour chooser.
      if (!flow.data.key) {
        ctx.session.adminFlow = { type: 'set_color', step: 'value', data: { key: text } };
        const kb = new InlineKeyboard();
        for (const c of Object.keys(COLOR_PREFIX)) {
          kb.text(`${COLOR_PREFIX[c as ColorMode] || '∅'} ${c}`, `adm:color:set:${text}:${c}`);
        }
        backRow(kb);
        await ctx.reply(`Pick a color for \`${text}\`:`, {
          parse_mode: 'Markdown',
          reply_markup: kb,
        });
      }
      return;
    }

    if (flow.type === 'set_color_glyph') {
      const mode = flow.data.mode as ColorMode;
      if (!(mode in COLOR_PREFIX)) {
        ctx.session.adminFlow = undefined;
        await ctx.reply('⚠️ Unknown color mode — aborted.');
        return;
      }
      const trimmed = text.trim();
      if (trimmed === '/cancel') {
        ctx.session.adminFlow = undefined;
        await ctx.reply('Cancelled.');
        return;
      }
      if (trimmed === '/clear') {
        await clearColorPrefix(mode);
        ctx.session.adminFlow = undefined;
        await ctx.reply(
          `✅ Cleared *${mode}* glyph — falling back to the built-in default.`,
          { parse_mode: 'Markdown' },
        );
        return;
      }
      // Trim whitespace but allow zero-width / multi-codepoint emoji.
      // Cap to 16 chars so the prefix never breaks the button label.
      const glyph = trimmed.slice(0, 16);
      await setColorPrefix(mode, glyph, ctx.from!.id);
      ctx.session.adminFlow = undefined;
      await ctx.reply(
        `✅ Updated *${mode}* glyph → ${glyph || '_(empty)_'}.`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    if (flow.type === 'announce') {
      if (flow.step === 'text') {
        ctx.session.adminFlow = { type: 'announce', step: 'confirm', data: { text } };
        const recipients = await listUsersForAnnouncement();
        const kb = new InlineKeyboard()
          .text(`📣 Send to ${recipients.length}`, 'adm:ann:send')
          .text('❌ Cancel', 'adm:root');
        // Preview exactly what users will see: HTML output with
        // expanded tokens AND auto-wrapped unicode emojis.
        await ctx.reply(renderMdHtml(text), { parse_mode: 'HTML' });
        await ctx.reply('Confirm sending:', { reply_markup: kb });
      }
      return;
    }

    if (flow.type === 'set_channel') {
      if (!/^https?:\/\/t\.me\//i.test(text) && !/^https?:\/\//i.test(text)) {
        await ctx.reply(
          '❌ That doesn\'t look like a URL. Send a link like `https://t.me/yourchannel`.',
          { parse_mode: 'Markdown' },
        );
        return;
      }
      await setChannelUrl(text, ctx.from!.id);
      ctx.session.adminFlow = undefined;
      await ctx.reply(`✅ Channel link saved:\n\`${text}\``, {
        parse_mode: 'Markdown',
        reply_markup: rootMenu(),
      });
      return;
    }

    if (flow.type === 'find_user') {
      const query = text.replace(/^@/, '');
      const user = /^\d+$/.test(query)
        ? await findUserById(Number(query))
        : await findUserByUsername(query);
      ctx.session.adminFlow = undefined;
      if (!user) {
        await ctx.reply('No user found.', { reply_markup: rootMenu() });
        return;
      }
      await showUserCard(ctx, user);
      return;
    }

    if (flow.type === 'adjust_balance') {
      const delta = Number(text);
      if (!Number.isFinite(delta)) {
        await ctx.reply('❌ Bad number. Send e.g. `5` or `-3.5`.');
        return;
      }
      const newBal = await adjustBalance(flow.data.telegram_id, delta);
      await recordLedger(
        flow.data.telegram_id,
        delta > 0 ? 'admin_add_balance' : 'admin_deduct_balance',
        delta,
        delta > 0 ? 'admin_add_balance' : 'admin_deduct_balance',
      );
      ctx.session.adminFlow = undefined;
      await ctx.reply(
        `✅ Balance adjusted by *${delta >= 0 ? '+' : ''}${delta}*. New balance: *$${newBal}*.`,
        { parse_mode: 'Markdown', reply_markup: rootMenu() },
      );
      try {
        if (delta !== 0) {
          // Render via the locale + premium-emoji pipeline so the
          // wallet credit / debit notification picks up `credit_emoji`,
          // `balance_emoji`, `debit_emoji` from the EMOJI map (and any
          // admin override stored under `emoji.<key>`). Recipient's
          // lang isn't loaded here, so we render in English; ar/vi
          // fall through to en automatically via the i18n resolver.
          const balanceFmt = Number(newBal).toFixed(2);
          const tpl =
            delta > 0
              ? translate('en', 'wallet.admin_credit', {
                  amount: delta.toFixed(2),
                  balance: balanceFmt,
                })
              : translate('en', 'wallet.admin_debit', {
                  amount: Math.abs(delta).toFixed(2),
                  balance: balanceFmt,
                });
          await ctx.api.sendMessage(
            flow.data.telegram_id,
            renderMdHtml(tpl),
            { parse_mode: 'HTML' },
          );
        }
      } catch (err) {
        logger.warn({ err }, 'Could not DM user about balance change');
      }
      // Deep-detail admin log so the action ends up in the same
      // structured feed as everything else (auditable trail across
      // sessions, even when the admin is the actor).
      void adminLog.logBalanceChange(ctx.api, {
        user: {
          telegram_id: flow.data.telegram_id,
          username: null,
          first_name: null,
          email: null,
        },
        delta,
        balanceAfter: Number(Number(newBal).toFixed(3)),
        reason: delta > 0 ? 'admin manual credit' : 'admin manual debit',
        by: 'admin',
      });
      return;
    }

    if (flow.type === 'ban_user') {
      const reason = text === '-' ? null : text.slice(0, 200);
      await banUser(flow.data.telegram_id, reason);
      ctx.session.adminFlow = undefined;
      await ctx.reply(
        `🚫 *User banned.*\n\n` +
          `\`${flow.data.telegram_id}\` will see no responses from the bot ` +
          `until you unban them.${
            reason ? `\n\nReason on file: _${reason}_` : ''
          }`,
        { parse_mode: 'Markdown', reply_markup: rootMenu() },
      );
      return;
    }

    if (flow.type === 'price_overrides_pick_user') {
      const query = text.replace(/^@/, '');
      const numeric = /^\d+$/.test(query);
      // Username path requires the user to have started the bot at
      // least once (otherwise we have no row to look up). Numeric
      // path works regardless — the override system is keyed by
      // telegram_id, not by users.id.
      let telegram_id: number | null = null;
      if (numeric) {
        telegram_id = Number(query);
      } else {
        const u = await findUserByUsername(query);
        if (u) telegram_id = u.telegram_id;
      }
      if (telegram_id === null || !Number.isFinite(telegram_id) || telegram_id <= 0) {
        await ctx.reply(
          'Could not resolve that user. Send a numeric Telegram ID ' +
            '(e.g. `123456789`) or `@username` of a user who has ' +
            'previously started the bot. Or `/cancel`.',
          { parse_mode: 'Markdown' },
        );
        return;
      }
      ctx.session.adminFlow = undefined;
      await showCustomPriceUserCard(ctx, telegram_id);
      return;
    }

    if (flow.type === 'price_override_set') {
      const price = Number(text);
      if (!Number.isFinite(price) || price < 0) {
        await ctx.reply('❌ Send a non-negative number, e.g. `9.99` or `0`.');
        return;
      }
      await setUserProductPrice({
        telegram_id: flow.data.telegram_id,
        product_id: flow.data.product_id,
        price,
        created_by: ctx.from!.id,
      });
      const target = flow.data.telegram_id;
      ctx.session.adminFlow = undefined;
      await ctx.reply(
        `💎 *Override saved.*\n\n` +
          `User \`${target}\` now sees product \`#${flow.data.product_id}\` ` +
          `at *$${price.toFixed(2)}*.`,
        { parse_mode: 'Markdown' },
      );
      await showCustomPriceUserCard(ctx, target);
      return;
    }

    if (flow.type === 'price_override_bulk') {
      const target = flow.data.telegram_id;
      const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));
      const ok: string[] = [];
      const bad: string[] = [];
      for (const line of lines) {
        const m = line.match(/^(\d+)\s+(-?\d+(?:\.\d+)?)$/);
        if (!m) {
          bad.push(`• \`${line.slice(0, 40)}\` — bad format`);
          continue;
        }
        const product_id = Number(m[1]);
        const price = Number(m[2]);
        if (!Number.isFinite(price) || price < 0) {
          bad.push(`• \`#${product_id}\` — price must be ≥ 0`);
          continue;
        }
        const product = await getProduct(product_id);
        if (!product) {
          bad.push(`• \`#${product_id}\` — product not found`);
          continue;
        }
        await setUserProductPrice({
          telegram_id: target,
          product_id,
          price,
          created_by: ctx.from!.id,
        });
        ok.push(
          `• ${escapeHtml(product.name)} (\`#${product_id}\`) → *$${price.toFixed(2)}*`,
        );
      }
      ctx.session.adminFlow = undefined;
      const summary = [
        `📋 *Bulk paste applied* for \`${target}\``,
        '',
        ok.length > 0 ? `*Saved (${ok.length}):*` : '_No overrides saved._',
        ...ok,
        '',
        bad.length > 0 ? `*Skipped (${bad.length}):*` : '',
        ...bad,
      ]
        .filter((l) => l !== '')
        .join('\n');
      await ctx.reply(summary, { parse_mode: 'Markdown' });
      await showCustomPriceUserCard(ctx, target);
      return;
    }

    if (flow.type === 'set_deposit_amount') {
      const amount = Number(text);
      if (!Number.isFinite(amount) || amount <= 0) {
        await ctx.reply('❌ Send a positive number, e.g. `5.12`.');
        return;
      }
      // numeric(14,2) — keep at most 2 decimals.
      const rounded = Math.floor(amount * 100) / 100;
      await setDepositAmount(flow.data.deposit_id, rounded);
      ctx.session.adminFlow = undefined;
      await ctx.reply(
        `✅ Deposit *#${flow.data.deposit_id}* amount set to *$${rounded.toFixed(2)}*. Tap Approve to credit the user.`,
        { parse_mode: 'Markdown' },
      );
      await showDepositList(ctx);
      return;
    }

    // -------- Promo flows (add wizard + single-field edits) --------

    if (flow.type === 'promo_add' && flow.step === 'pick_user') {
      // Resolve the user — numeric Telegram ID always works,
      // @username only resolves when the user has /start-ed the bot.
      const query = text.replace(/^@/, '');
      const numeric = /^\d+$/.test(query);
      let telegram_id: number | null = null;
      if (numeric) {
        telegram_id = Number(query);
      } else {
        const u = await findUserByUsername(query);
        if (u) telegram_id = u.telegram_id;
      }
      if (telegram_id === null || !Number.isFinite(telegram_id) || telegram_id <= 0) {
        await ctx.reply(
          'Could not resolve that user. Send a numeric Telegram ID ' +
            '(e.g. `123456789`) or `@username` of a user who has ' +
            'previously started the bot. Or `/cancel`.',
          { parse_mode: 'Markdown' },
        );
        return;
      }
      if (flow.data.scope === 'user') {
        ctx.session.adminFlow = {
          type: 'promo_add',
          step: 'min_qty',
          data: { scope: 'user', product_id: null, telegram_id },
        };
        await ctx.reply(
          [
            '➕ *New promo — Step 3/4: Minimum qty*',
            '',
            'Send the minimum quantity that triggers this promo.',
            'Whole number ≥ 1, e.g. `10`.',
            '',
            'Send `/cancel` to abort.',
          ].join('\n'),
          {
            parse_mode: 'Markdown',
            reply_markup: new InlineKeyboard().text('⬅️ Cancel', 'adm:promo'),
          },
        );
        return;
      }
      // user_product → next step is product picker.
      ctx.session.adminFlow = {
        type: 'promo_add',
        step: 'pick_product',
        data: { scope: 'user_product', telegram_id },
      };
      const { rows, total } = await listAllProducts(0, PROMO_PAGE_SIZE);
      const totalPages = Math.max(1, Math.ceil(total / PROMO_PAGE_SIZE));
      const kb = new InlineKeyboard();
      for (const p of rows) {
        kb.text(
          `${p.name.slice(0, 40)} — $${Number(p.price).toFixed(2)}`,
          `adm:promo:npp:${p.id}`,
        ).row();
      }
      if (totalPages > 1) kb.text('Next ▶', 'adm:promo:np:1');
      kb.row().text('⬅️ Cancel', 'adm:promo');
      await ctx.reply(
        [
          '➕ *New promo — pick a product*',
          `User: \`${telegram_id}\``,
          `Page 1/${totalPages}  (total ${total})`,
          '',
          'Tap a product to attach the promo to it.',
        ].join('\n'),
        { parse_mode: 'Markdown', reply_markup: kb },
      );
      return;
    }

    if (flow.type === 'promo_add' && flow.step === 'min_qty') {
      const min_qty = Number(text);
      if (!Number.isInteger(min_qty) || min_qty < 1) {
        await ctx.reply('❌ Send a whole number ≥ 1, e.g. `10`.');
        return;
      }
      ctx.session.adminFlow = {
        type: 'promo_add',
        step: 'discount',
        data: { ...flow.data, min_qty },
      };
      await ctx.reply(
        [
          '➕ *New promo — Step 4/4: Discount*',
          '',
          `Triggers when qty ≥ *${min_qty}*. Send the flat USDT discount`,
          'taken off the line total, e.g. `5` or `12.5`.',
          '',
          'Send `/cancel` to abort.',
        ].join('\n'),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('⬅️ Cancel', 'adm:promo'),
        },
      );
      return;
    }

    if (flow.type === 'promo_add' && flow.step === 'discount') {
      const discount_amount = Number(text);
      if (!Number.isFinite(discount_amount) || discount_amount < 0) {
        await ctx.reply('❌ Send a non-negative number, e.g. `5` or `12.5`.');
        return;
      }
      ctx.session.adminFlow = {
        type: 'promo_add',
        step: 'name',
        data: { ...flow.data, discount_amount },
      };
      const kb = new InlineKeyboard()
        .text('Skip name', 'adm:promo:nameSkip')
        .row()
        .text('⬅️ Cancel', 'adm:promo');
      await ctx.reply(
        [
          '➕ *New promo — optional label*',
          '',
          'Send a short label that buyers will see on the product page',
          '(e.g. `Bulk deal`, `VIP offer`), or tap *Skip name*.',
        ].join('\n'),
        { parse_mode: 'Markdown', reply_markup: kb },
      );
      return;
    }

    if (flow.type === 'promo_add' && flow.step === 'name') {
      const name = text === '-' ? null : text.slice(0, 80);
      const created = await addPromo({
        product_id: flow.data.product_id,
        telegram_id: flow.data.telegram_id,
        name,
        min_qty: flow.data.min_qty,
        discount_amount: flow.data.discount_amount,
        created_by: ctx.from!.id,
      });
      ctx.session.adminFlow = undefined;
      await ctx.reply(`✅ Promo *#${created.id}* saved.`, {
        parse_mode: 'Markdown',
      });
      // Isolate the post-save card render — if the impact-stats query
      // happens to fail (e.g. orders.promo_id column missing) the
      // promo is already in the database and the admin shouldn't
      // see "Something went wrong" on top of a successful save.
      try {
        await showPromoCard(ctx, created.id);
      } catch (err) {
        logger.error({ err, promo_id: created.id }, 'showPromoCard after save failed');
        await ctx.reply(
          '_(Detail card render failed — promo is saved. Open it from /promo list.)_',
          { parse_mode: 'Markdown' },
        );
      }
      return;
    }

    if (flow.type === 'promo_edit_qty') {
      const min_qty = Number(text);
      if (!Number.isInteger(min_qty) || min_qty < 1) {
        await ctx.reply('❌ Send a whole number ≥ 1, e.g. `10`.');
        return;
      }
      await updatePromo(flow.data.promo_id, { min_qty });
      ctx.session.adminFlow = undefined;
      await ctx.reply(`✅ Min qty updated to *${min_qty}*.`, { parse_mode: 'Markdown' });
      await showPromoCard(ctx, flow.data.promo_id);
      return;
    }

    if (flow.type === 'promo_edit_discount') {
      const discount_amount = Number(text);
      if (!Number.isFinite(discount_amount) || discount_amount < 0) {
        await ctx.reply('❌ Send a non-negative number, e.g. `5` or `12.5`.');
        return;
      }
      await updatePromo(flow.data.promo_id, { discount_amount });
      ctx.session.adminFlow = undefined;
      await ctx.reply(`✅ Discount updated to *$${discount_amount.toFixed(2)}*.`, {
        parse_mode: 'Markdown',
      });
      await showPromoCard(ctx, flow.data.promo_id);
      return;
    }

    if (flow.type === 'promo_edit_name') {
      const name = text === '-' ? null : text.slice(0, 80);
      await updatePromo(flow.data.promo_id, { name });
      ctx.session.adminFlow = undefined;
      await ctx.reply(name ? `✅ Name updated.` : `✅ Name cleared.`);
      await showPromoCard(ctx, flow.data.promo_id);
      return;
    }
  } catch (err) {
    logger.error({ err, flow }, 'admin flow error');
    ctx.session.adminFlow = undefined;
    // Surface the real DB error for promo flows — these have been
    // failing silently with "Something went wrong" when the
    // migrations weren't applied. Knowing the Postgres error code is
    // usually enough for the admin to tell whether they need to run
    // a migration or just retry.
    const e = err as { code?: string; message?: string; hint?: string } & Error;
    const isPromoFlow = flow.type.startsWith('promo_');
    if (isPromoFlow && e?.code === '42P01') {
      // undefined_table — migrations 0013 / 0014 didn't run.
      await ctx.reply(
        '⚠️ *Promo system not migrated*\n\n' +
          'The `promos` table is missing on this database. Apply the\n' +
          '`supabase/migrations/0013_promos.sql` and `0014_orders_promo_id.sql`\n' +
          'migrations on your Supabase, then try again.',
        { parse_mode: 'Markdown', reply_markup: rootMenu() },
      );
      return;
    }
    if (isPromoFlow && e?.code === '42703') {
      // undefined_column — schema partly migrated.
      await ctx.reply(
        '⚠️ *Promo schema is partially migrated*\n\n' +
          `The database is missing a column: \`${escapeHtml(e.message ?? '')}\`. Make sure ` +
          'both `0013_promos.sql` and `0014_orders_promo_id.sql` ran in full.',
        { parse_mode: 'Markdown', reply_markup: rootMenu() },
      );
      return;
    }
    if (isPromoFlow) {
      const detail = e?.message ?? String(err);
      await ctx.reply(
        '⚠️ *Promo flow failed*\n\n' +
          `\`\`\`\n${detail.slice(0, 500)}\n\`\`\`\n` +
          (e?.hint ? `_Hint: ${escapeHtml(e.hint)}_\n` : '') +
          '\nCheck the bot logs for the full stack trace.',
        { parse_mode: 'Markdown', reply_markup: rootMenu() },
      );
      return;
    }
    await ctx.reply('⚠️ Something went wrong. Cancelled.', { reply_markup: rootMenu() });
  }
});

// -------- Per-product editor: file-based steps --------
//
// We listen for documents/photos/videos and dispatch only when an
// `edit_product_*_file` flow is armed. Anything else passes through
// to the next handler so other features (announcements, etc.) keep
// working unchanged.
adminBot.on('message:document', async (ctx, next) => {
  const flow = ctx.session.adminFlow;
  if (!flow) return next();
  if (!ctx.from || !(await isAdmin(ctx.from.id))) return next();
  const doc = ctx.message.document;
  if (flow.type === 'edit_product_tutorial_file') {
    await updateProduct(flow.data.product_id, {
      tutorial_file_id: doc.file_id,
      tutorial_file_type: 'document',
    });
    ctx.session.adminFlow = undefined;
    await ctx.reply('✅ Tutorial document saved.');
    return;
  }
  if (flow.type === 'edit_bot_tutorial_file') {
    await setBotTutorialField('file_id', doc.file_id, ctx.from.id);
    await setBotTutorialField('file_type', 'document', ctx.from.id);
    ctx.session.adminFlow = undefined;
    await ctx.reply('✅ Bot Tutorial document saved.');
    return;
  }
  return next();
});

adminBot.on('message:photo', async (ctx, next) => {
  const flow = ctx.session.adminFlow;
  if (!flow) return next();
  if (!ctx.from || !(await isAdmin(ctx.from.id))) return next();
  const photos = ctx.message.photo;
  // Telegram sends a sized array; the last entry is the largest. We
  // store the largest because the bot will re-send it directly and
  // Telegram resizes per-client anyway.
  const fileId = photos[photos.length - 1]?.file_id;
  if (!fileId) return next();
  if (flow.type === 'edit_product_tutorial_file') {
    await updateProduct(flow.data.product_id, {
      tutorial_file_id: fileId,
      tutorial_file_type: 'photo',
    });
    ctx.session.adminFlow = undefined;
    await ctx.reply('✅ Tutorial photo saved.');
    return;
  }
  if (flow.type === 'edit_bot_tutorial_file') {
    await setBotTutorialField('file_id', fileId, ctx.from.id);
    await setBotTutorialField('file_type', 'photo', ctx.from.id);
    ctx.session.adminFlow = undefined;
    await ctx.reply('✅ Bot Tutorial photo saved.');
    return;
  }
  return next();
});

adminBot.on('message:video', async (ctx, next) => {
  const flow = ctx.session.adminFlow;
  if (!flow) return next();
  if (!ctx.from || !(await isAdmin(ctx.from.id))) return next();
  const fileId = ctx.message.video.file_id;
  if (flow.type === 'edit_product_tutorial_file') {
    await updateProduct(flow.data.product_id, {
      tutorial_file_id: fileId,
      tutorial_file_type: 'video',
    });
    ctx.session.adminFlow = undefined;
    await ctx.reply('✅ Tutorial video saved.');
    return;
  }
  if (flow.type === 'edit_bot_tutorial_file') {
    await setBotTutorialField('file_id', fileId, ctx.from.id);
    await setBotTutorialField('file_type', 'video', ctx.from.id);
    ctx.session.adminFlow = undefined;
    await ctx.reply('✅ Bot Tutorial video saved.');
    return;
  }
  return next();
});

// "Skip" buttons for optional product fields
adminBot.callbackQuery('adm:cat:skip_emoji', async (ctx) => {
  const flow = ctx.session.adminFlow;
  if (flow?.type !== 'add_category' || flow.step !== 'emoji') {
    await ctx.answerCallbackQuery({ text: 'Stale flow' });
    return;
  }
  const cat = await addCategory(flow.data.name);
  ctx.session.adminFlow = undefined;
  cache.del('cats');
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(`✅ Category *${cat.name}* added (id=${cat.id}).`, {
    parse_mode: 'Markdown',
    reply_markup: rootMenu(),
  });
});

// "Unlimited?" buttons fired during the product creation flow,
// right after the user enters the price. Yes → stock=0 + unlimited=true.
// No → continue to the integer stock prompt.
adminBot.callbackQuery('adm:prod:unl:yes', async (ctx) => {
  const flow = ctx.session.adminFlow;
  if (flow?.type !== 'add_product' || flow.step !== 'unlimited') {
    await ctx.answerCallbackQuery({ text: 'Stale flow' });
    return;
  }
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = {
    type: 'add_product',
    step: 'warranty',
    data: { ...flow.data, stock: 0, unlimited: true },
  };
  const kb = new InlineKeyboard().text('Skip', 'adm:prod:skip:warranty');
  await ctx.reply('♾ Stock set to *Unlimited*.\n\nSend the *warranty* text (or tap Skip).', {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
});

adminBot.callbackQuery('adm:prod:unl:no', async (ctx) => {
  const flow = ctx.session.adminFlow;
  if (flow?.type !== 'add_product' || flow.step !== 'unlimited') {
    await ctx.answerCallbackQuery({ text: 'Stale flow' });
    return;
  }
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = {
    type: 'add_product',
    step: 'stock',
    data: { ...flow.data },
  };
  await ctx.reply('Send the *stock* quantity (integer ≥ 0).', { parse_mode: 'Markdown' });
});

adminBot.callbackQuery(/^adm:prod:skip:(warranty|description|note|items)$/, async (ctx) => {
  const which = ctx.match[1] as 'warranty' | 'description' | 'note' | 'items';
  const flow = ctx.session.adminFlow;
  if (flow?.type !== 'add_product') {
    await ctx.answerCallbackQuery({ text: 'Stale flow' });
    return;
  }
  await ctx.answerCallbackQuery();
  if (which === 'warranty' && flow.step === 'warranty') {
    ctx.session.adminFlow = {
      type: 'add_product',
      step: 'description',
      data: flow.data,
    };
    const kb = new InlineKeyboard().text('Skip', 'adm:prod:skip:description');
    await ctx.reply('Send the *description* (or Skip).', {
      parse_mode: 'Markdown',
      reply_markup: kb,
    });
  } else if (which === 'description' && flow.step === 'description') {
    ctx.session.adminFlow = {
      type: 'add_product',
      step: 'note',
      data: flow.data,
    };
    const kb = new InlineKeyboard().text('Skip', 'adm:prod:skip:note');
    await ctx.reply(
      'Send the *View Note* text shown when buyer taps 📝 View Note (or Skip).',
      { parse_mode: 'Markdown', reply_markup: kb },
    );
  } else if (which === 'note' && flow.step === 'note') {
    ctx.session.adminFlow = {
      type: 'add_product',
      step: 'items',
      data: flow.data,
    };
    const kb = new InlineKeyboard().text('Skip', 'adm:prod:skip:items');
    await ctx.reply(
      [
        '📦 *Send the deliverables (items pool)* — one payload per line.',
        'These are the actual things buyers receive (acc emails+passwords, links, codes, etc).',
        '',
        'Or tap *Skip* to leave the pool empty (you can add items later from the Edit screen).',
      ].join('\n'),
      { parse_mode: 'Markdown', reply_markup: kb },
    );
  } else if (which === 'items' && flow.step === 'items') {
    await finalizeProduct(ctx, flow.data, []);
  }
});

async function finalizeProduct(
  ctx: AppCtx,
  data: {
    category_id: number;
    name: string;
    price: number;
    stock: number;
    unlimited?: boolean;
    warranty?: string;
    description?: string;
    note?: string;
  },
  items: string[] = [],
): Promise<void> {
  const product = await addProduct(data);
  // If admin chose "Unlimited" earlier, persist the flag now that we
  // have a product id. addProduct() doesn't know about the new
  // column, so we do this as a follow-up update — graceful no-op
  // when migration 0015 isn't applied (updateProduct will just throw
  // and we log/swallow).
  if (data.unlimited === true) {
    try {
      await updateProduct(product.id, { unlimited_stock: true });
    } catch (err) {
      logger.error({ err, product_id: product.id }, 'set unlimited_stock on create failed');
    }
  }
  if (items.length > 0) {
    try {
      await addProductItems(product.id, items);
    } catch (err) {
      logger.error({ err, product_id: product.id }, 'addProductItems on create failed');
    }
  }
  ctx.session.adminFlow = undefined;
  cache.del('cats');
  const stockBlurb = data.unlimited
    ? 'stock ∞'
    : `stock ${product.stock}`;
  await ctx.reply(
    [
      `✅ Product *${product.name}* added (id=${product.id}, $${product.price}, ${stockBlurb}).`,
      items.length > 0 ? `📦 ${items.length} items added to the pool.` : null,
      '',
      `_Tap_ ✏️ Edit #${product.id} _on the product list to add a premium emoji, view-note file, tutorial, or more items._`,
    ]
      .filter((s) => s !== null)
      .join('\n'),
    { parse_mode: 'Markdown', reply_markup: rootMenu() },
  );
}

// ============================================================
// Legacy slash commands (still supported for power users).
// ============================================================
adminBot.command('settext', async (ctx) => {
  const [, key, ...rest] = (ctx.message?.text ?? '').split(/\s+/);
  const value = rest.join(' ');
  if (!key || !value) {
    await ctx.reply('Usage: /settext <key> <text...>');
    return;
  }
  await setText(key, value, ctx.from!.id);
  await ctx.reply(`✅ Text \`${key}\` updated.`, { parse_mode: 'Markdown' });
});

adminBot.command('setcolor', async (ctx) => {
  const [, key, modeRaw] = (ctx.message?.text ?? '').split(/\s+/);
  if (!key || !modeRaw) {
    await ctx.reply('Usage: /setcolor <key> <none|blue|green|red|yellow>');
    return;
  }
  const mode = modeRaw as ColorMode;
  if (!(mode in COLOR_PREFIX)) {
    await ctx.reply(`Unknown color "${modeRaw}". Allowed: ${Object.keys(COLOR_PREFIX).join(', ')}`);
    return;
  }
  await setColor(key, mode, ctx.from!.id);
  await ctx.reply(`✅ Color for \`${key}\` set to *${mode}*.`, { parse_mode: 'Markdown' });
});

adminBot.command('setemoji', async (ctx) => {
  const [, key, unicode, customId] = (ctx.message?.text ?? '').split(/\s+/);
  if (!key || !unicode) {
    await ctx.reply('Usage: /setemoji <key> <unicode> [custom_emoji_id]');
    return;
  }
  await setEmoji(key, unicode, customId, ctx.from!.id);
  await ctx.reply(`✅ Emoji \`${key}\` updated.`, { parse_mode: 'Markdown' });
});

// ---------------------------------------------------------------------------
//  Premium-shop overhaul: per-product asset commands.
//
//  Each command operates on a single product id. Replying *to* the
//  admin's own message that contains a photo / video / document
//  swaps the slash-command target into the replied-to file, so the
//  admin can drag-drop a file into Telegram and run the command in
//  the same chat without copy-pasting file_ids.
// ---------------------------------------------------------------------------

function readPremiumEmojiFromMessage(
  ctx: AppCtx,
): { unicode: string; custom_emoji_id: string } | null {
  // Admin replies to a message containing a single premium emoji.
  // We grab the first `custom_emoji` entity and snapshot its unicode
  // fallback (one grapheme cluster from the entity range).
  const reply = ctx.message?.reply_to_message;
  if (!reply) return null;
  const text = reply.text ?? reply.caption ?? '';
  const entities = reply.entities ?? reply.caption_entities ?? [];
  const entity = entities.find(
    (e) => e.type === 'custom_emoji' && 'custom_emoji_id' in e,
  ) as { offset: number; length: number; custom_emoji_id: string } | undefined;
  if (!entity) return null;
  const unicode = text
    .substring(entity.offset, entity.offset + entity.length)
    .trim();
  if (!unicode) return null;
  return { unicode, custom_emoji_id: entity.custom_emoji_id };
}

adminBot.command('setproductemoji', async (ctx) => {
  // Usage: /setproductemoji <id> [<unicode> <custom_emoji_id>]
  // Or: reply to a premium-emoji message with `/setproductemoji <id>`.
  const parts = (ctx.message?.text ?? '').split(/\s+/);
  const id = Number(parts[1]);
  if (!Number.isFinite(id)) {
    await ctx.reply('Usage: /setproductemoji <id> [<unicode> <custom_emoji_id>]');
    return;
  }
  let customId: string | null = null;
  if (parts[2] && parts[3]) {
    customId = parts[3]!;
  } else {
    const fromReply = readPremiumEmojiFromMessage(ctx);
    if (fromReply) customId = fromReply.custom_emoji_id;
  }
  if (!customId) {
    await ctx.reply(
      'Reply to a single premium-emoji message with `/setproductemoji <id>`, or pass the id directly.',
      { parse_mode: 'Markdown' },
    );
    return;
  }
  await updateProduct(id, { emoji_id: customId });
  await ctx.reply(`✅ Product #${id} emoji_id set.`);
});

adminBot.command('clearproductemoji', async (ctx) => {
  const id = Number((ctx.message?.text ?? '').split(/\s+/)[1]);
  if (!Number.isFinite(id)) {
    await ctx.reply('Usage: /clearproductemoji <id>');
    return;
  }
  await updateProduct(id, { emoji_id: null });
  await ctx.reply(`🧹 Product #${id} emoji_id cleared.`);
});

adminBot.command('setproductunlimited', async (ctx) => {
  // Usage: /setproductunlimited <id> on|off
  const parts = (ctx.message?.text ?? '').split(/\s+/);
  const id = Number(parts[1]);
  const flag = parts[2]?.toLowerCase();
  if (!Number.isFinite(id) || (flag !== 'on' && flag !== 'off')) {
    await ctx.reply('Usage: /setproductunlimited <id> on|off');
    return;
  }
  await updateProduct(id, { unlimited_stock: flag === 'on' });
  await ctx.reply(`✅ Product #${id} unlimited_stock = ${flag.toUpperCase()}.`);
});

adminBot.command('setproducttutorial', async (ctx) => {
  // Usage variants:
  //   /setproducttutorial <id> text <body...>
  //   /setproducttutorial <id> url <https://...>
  //   /setproducttutorial <id> clear
  //   reply to photo/video/doc with: /setproducttutorial <id> file
  const text = ctx.message?.text ?? '';
  const m = text.match(/^\/setproducttutorial(?:@\S+)?\s+(\d+)\s+(text|url|file|clear)\s*([\s\S]*)$/);
  if (!m) {
    await ctx.reply(
      'Usage:\n' +
        '`/setproducttutorial <id> text <body>`\n' +
        '`/setproducttutorial <id> url <https://...>`\n' +
        '`/setproducttutorial <id> file` (reply to photo/video/document)\n' +
        '`/setproducttutorial <id> clear`',
      { parse_mode: 'Markdown' },
    );
    return;
  }
  const id = Number(m[1]);
  const action = m[2];
  const value = m[3]?.trim() ?? '';
  if (action === 'text') {
    await updateProduct(id, { tutorial_text: value || null });
    await ctx.reply(`✅ Product #${id} tutorial text saved.`);
    return;
  }
  if (action === 'url') {
    await updateProduct(id, { tutorial_url: value || null });
    await ctx.reply(`✅ Product #${id} tutorial url saved.`);
    return;
  }
  if (action === 'clear') {
    await updateProduct(id, {
      tutorial_text: null,
      tutorial_file_id: null,
      tutorial_file_type: null,
      tutorial_url: null,
    });
    await ctx.reply(`🧹 Product #${id} tutorial wiped.`);
    return;
  }
  // file
  const reply = ctx.message?.reply_to_message;
  let file_id: string | undefined;
  let file_type: 'photo' | 'video' | 'document' | undefined;
  if (reply?.photo && reply.photo.length > 0) {
    file_id = reply.photo[reply.photo.length - 1]!.file_id;
    file_type = 'photo';
  } else if (reply?.video) {
    file_id = reply.video.file_id;
    file_type = 'video';
  } else if (reply?.document) {
    file_id = reply.document.file_id;
    file_type = 'document';
  }
  if (!file_id || !file_type) {
    await ctx.reply('Reply to a photo, video, or document message with this command.');
    return;
  }
  await updateProduct(id, {
    tutorial_file_id: file_id,
    tutorial_file_type: file_type,
  });
  await ctx.reply(`✅ Product #${id} tutorial ${file_type} saved.`);
});

adminBot.command('addproductitems', async (ctx) => {
  // Usage: /addproductitems <id>
  // Then reply to a message containing newline-separated payloads,
  // OR include them after the id in the same message body.
  const text = ctx.message?.text ?? '';
  const m = text.match(/^\/addproductitems(?:@\S+)?\s+(\d+)\s*([\s\S]*)$/);
  if (!m) {
    await ctx.reply(
      'Usage: /addproductitems <id>\nThen include payloads on subsequent lines, or reply to a message containing them.',
    );
    return;
  }
  const id = Number(m[1]);
  let body = (m[2] ?? '').trim();
  if (!body && ctx.message?.reply_to_message) {
    body = (ctx.message.reply_to_message.text ?? ctx.message.reply_to_message.caption ?? '').trim();
  }
  if (!body) {
    await ctx.reply('No payloads found. Either include them after the id or reply to a message with one payload per line.');
    return;
  }
  const payloads = body
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (payloads.length === 0) {
    await ctx.reply('No payloads found.');
    return;
  }
  const inserted = await addProductItems(id, payloads);
  const remaining = await countAvailableProductItems(id);
  await ctx.reply(`✅ Added ${inserted} items to product #${id}. Pool now has ${remaining} unconsumed.`);
});

adminBot.command('countproductitems', async (ctx) => {
  const id = Number((ctx.message?.text ?? '').split(/\s+/)[1]);
  if (!Number.isFinite(id)) {
    await ctx.reply('Usage: /countproductitems <id>');
    return;
  }
  const remaining = await countAvailableProductItems(id);
  await ctx.reply(`Product #${id}: ${remaining} unconsumed item(s).`);
});

adminBot.command('clearproductitems', async (ctx) => {
  const id = Number((ctx.message?.text ?? '').split(/\s+/)[1]);
  if (!Number.isFinite(id)) {
    await ctx.reply('Usage: /clearproductitems <id>');
    return;
  }
  await clearProductItems(id);
  await ctx.reply(`🧹 Product #${id}: all items wiped.`);
});

// ---- Bot Tutorial (Settings) ----
adminBot.command('setbottutorial', async (ctx) => {
  // /setbottutorial text <body>
  // /setbottutorial url <https://...>
  // /setbottutorial file (reply to photo/video/document)
  // /setbottutorial clear
  const text = ctx.message?.text ?? '';
  const m = text.match(/^\/setbottutorial(?:@\S+)?\s+(text|url|file|clear)\s*([\s\S]*)$/);
  if (!m) {
    await ctx.reply(
      'Usage:\n' +
        '`/setbottutorial text <body>`\n' +
        '`/setbottutorial url <https://...>`\n' +
        '`/setbottutorial file` (reply to a photo/video/document)\n' +
        '`/setbottutorial clear`',
      { parse_mode: 'Markdown' },
    );
    return;
  }
  const action = m[1];
  const value = m[2]?.trim() ?? '';
  const adminId = ctx.from!.id;
  if (action === 'text') {
    await setBotTutorialField('text', value || null, adminId);
    await ctx.reply('✅ Bot Tutorial text saved.');
    return;
  }
  if (action === 'url') {
    await setBotTutorialField('url', value || null, adminId);
    await ctx.reply('✅ Bot Tutorial URL saved.');
    return;
  }
  if (action === 'clear') {
    await setBotTutorialField('text', null, adminId);
    await setBotTutorialField('file_id', null, adminId);
    await setBotTutorialField('file_type', null, adminId);
    await setBotTutorialField('url', null, adminId);
    await ctx.reply('🧹 Bot Tutorial wiped.');
    return;
  }
  // file
  const reply = ctx.message?.reply_to_message;
  let file_id: string | undefined;
  let file_type: NonNullable<BotTutorial['file_type']> | undefined;
  if (reply?.photo && reply.photo.length > 0) {
    file_id = reply.photo[reply.photo.length - 1]!.file_id;
    file_type = 'photo';
  } else if (reply?.video) {
    file_id = reply.video.file_id;
    file_type = 'video';
  } else if (reply?.document) {
    file_id = reply.document.file_id;
    file_type = 'document';
  }
  if (!file_id || !file_type) {
    await ctx.reply('Reply to a photo, video, or document message with /setbottutorial file.');
    return;
  }
  await setBotTutorialField('file_id', file_id, adminId);
  await setBotTutorialField('file_type', file_type, adminId);
  await ctx.reply(`✅ Bot Tutorial ${file_type} saved.`);
});

adminBot.command('showbottutorial', async (ctx) => {
  const tut = getBotTutorial();
  await ctx.reply(
    [
      '*Bot Tutorial:*',
      `Text: ${tut.text ? '`set`' : '_unset_'}`,
      `File: ${tut.file_id ? `\`${tut.file_type}\`` : '_unset_'}`,
      `URL: ${tut.url ? `\`${tut.url}\`` : '_unset_'}`,
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
});

adminBot.command('clearcache', async (ctx) => {
  cache.clearAll();
  await ctx.reply('🧹 Cache cleared.');
});

adminBot.command('reload', async (ctx) => {
  await refreshSettings();
  cache.clearAll();
  await ctx.reply('🔁 Settings reloaded.');
});

// Diagnostic: show whether the welcome / change / delete emails will
// actually leave the bot. Useful when "no emails are arriving" — it
// answers the first question (transport configured?) without
// requiring shell access to the Railway env vars.
adminBot.command('mailerstatus', async (ctx) => {
  const status = describeMailerStatus();
  await ctx.reply(`📬 *Mailer status*\n\n\`\`\`\n${status}\n\`\`\``, {
    parse_mode: 'Markdown',
  });
});

// Diagnostic: send a real "set"-mode welcome email to the admin's
// chosen address so they can verify the transport / domain / DNS
// end-to-end. Usage: /testemail you@example.com [set|change|delete]
adminBot.command('testemail', async (ctx) => {
  const [, target, modeRaw] = (ctx.message?.text ?? '').split(/\s+/);
  if (!target || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
    await ctx.reply('Usage: /testemail <email> [set|change|delete]');
    return;
  }
  const mode = (modeRaw === 'change' || modeRaw === 'delete' ? modeRaw : 'set') as
    | 'set'
    | 'change'
    | 'delete';
  await ctx.reply(`Sending ${mode} test email to ${target}…`);
  const ok = await sendWelcomeEmail({
    email: target,
    previousEmail: mode === 'change' || mode === 'delete' ? target : null,
    firstName: ctx.from?.first_name ?? null,
    username: ctx.from?.username ?? null,
    mode,
  });
  await ctx.reply(
    ok
      ? `✅ Sent. Check ${target}'s inbox (and spam). If nothing arrives, run /mailerstatus and check the bot logs for the Resend / SMTP error.`
      : `❌ Send failed. Run /mailerstatus and check the logs — usually missing RESEND_API_KEY or unverified domain.`,
  );
});
