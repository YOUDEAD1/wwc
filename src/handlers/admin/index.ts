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
} from '../../services/settings.js';
import { renderMdHtml } from '../../services/premium.js';
import * as adminLog from '../../services/adminLog.js';
import { describeMailerStatus, sendWelcomeEmail } from '../../services/mailer.js';
import type { ColorMode } from '../../../config/index.js';
import { BUTTON_KEYS, COLOR_PREFIX, EMOJI } from '../../../config/index.js';
import type { AppCtx } from '../../middleware/user.js';
import { logger } from '../../logger.js';
import type { DBUser } from '../../types.js';

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
  ['admin', 'settext', 'setcolor', 'setemoji', 'clearcache', 'reload', 'mailerstatus', 'testemail'],
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
    .text('🔁 Reload Settings', 'adm:reload');
  backRow(kb);
  await ctx.editMessageText('⚙️ *Bot Settings*\n\nGeneral configuration knobs.', {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
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
    kb.text(`🗑 #${c.id} ${c.name}`.slice(0, 60), `adm:cat:del:${c.id}`).row();
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
          step: 'stock',
          data: { ...flow.data, price },
        };
        await ctx.reply('Send the *stock* quantity (integer ≥ 0).', { parse_mode: 'Markdown' });
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
        await finalizeProduct(ctx, { ...flow.data, note: text });
      }
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
          await ctx.api.sendMessage(
            flow.data.telegram_id,
            delta > 0
              ? `💰 An admin credited *$${delta.toFixed(2)}* to your wallet. New balance: *$${newBal}*.`
              : `⚠️ An admin debited *$${Math.abs(delta).toFixed(2)}* from your wallet. New balance: *$${newBal}*.`,
            { parse_mode: 'Markdown' },
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
  } catch (err) {
    logger.error({ err, flow }, 'admin flow error');
    ctx.session.adminFlow = undefined;
    await ctx.reply('⚠️ Something went wrong. Cancelled.', { reply_markup: rootMenu() });
  }
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

adminBot.callbackQuery(/^adm:prod:skip:(warranty|description|note)$/, async (ctx) => {
  const which = ctx.match[1] as 'warranty' | 'description' | 'note';
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
    await finalizeProduct(ctx, flow.data);
  }
});

async function finalizeProduct(
  ctx: AppCtx,
  data: {
    category_id: number;
    name: string;
    price: number;
    stock: number;
    warranty?: string;
    description?: string;
    note?: string;
  },
): Promise<void> {
  const product = await addProduct(data);
  ctx.session.adminFlow = undefined;
  cache.del('cats');
  await ctx.reply(
    `✅ Product *${product.name}* added (id=${product.id}, $${product.price}, stock ${product.stock}).`,
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
