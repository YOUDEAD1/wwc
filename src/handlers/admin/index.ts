/**
 * Admin dashboard — fully button-driven.
 *
 * Entry: /admin (admin only). Everything else happens via inline
 * buttons + multi-step text input collected through `session.adminFlow`.
 */
import { Composer, InlineKeyboard, type MiddlewareFn } from 'grammy';
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
  findUserById,
  findUserByUsername,
  getDeposit,
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
  setDepositAmount,
  setDepositStatus,
  setProductActive,
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
  clearEmoji,
  setText,
  refreshSettings,
  setChannelUrl,
  clearChannelUrl,
  getChannelUrl,
  getEmoji,
  getButtonColor,
} from '../../services/settings.js';
import { renderMdHtml } from '../../services/premium.js';
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

// ---------- AI Setup (placeholder) ----------
adminBot.callbackQuery('adm:ai', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = undefined;
  const kb = new InlineKeyboard()
    .text('🔑 Set AI API Key', 'adm:ai:key')
    .row()
    .text('💬 Set AI Prompt', 'adm:ai:prompt');
  backRow(kb);
  await ctx.editMessageText(
    '🤖 *AI Setup*\n\nConfigure the assistant used by the Support flow.',
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
adminBot.callbackQuery('adm:stats', async (ctx) => {
  await ctx.answerCallbackQuery();
  const s = await getStats();
  const text = [
    '📊 *Stats*',
    '',
    `👥 Users: *${s.users}*`,
    `📦 Active products: *${s.active_products}*`,
    `🗂 Active categories: *${s.active_categories}*`,
    `🧾 Total orders: *${s.orders}*`,
    `💰 Total revenue: *$${s.revenue.toFixed(2)}*`,
    `💳 Pending deposits: *${s.pending_deposits}*`,
  ].join('\n');
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
  const lines = [`📦 *Products* — page ${page + 1}/${totalPages}`, ''];
  const kb = new InlineKeyboard();
  for (const p of rows) {
    const flag = p.active ? '🟢' : '⚪️';
    lines.push(`${flag} #${p.id}  ${p.name} — $${p.price}  (stock ${p.stock})`);
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
  const spec = getEmoji(`btn.${key}`);
  if (typeof spec === 'object' && spec.custom_emoji_id) {
    return `${spec.unicode} ${key} — premium`;
  }
  if (typeof spec === 'string' && spec !== `btn.${key}`) {
    return `${spec} ${key}`;
  }
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
  const settingsKey = `btn.${key}`;
  ctx.session.adminFlow = { type: 'set_emoji', step: 'value', data: { key: settingsKey } };
  const cur = getEmoji(settingsKey);
  const curLine =
    typeof cur === 'object' && cur.custom_emoji_id
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
  await clearEmoji(`btn.${key}`);
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
  ];
  const kb = new InlineKeyboard()
    .text('💰 Adjust balance', `adm:usr:bal:${user.telegram_id}`)
    .row();
  if (isAdminUser) {
    kb.text('🛡 Demote admin', `adm:usr:demote:${user.telegram_id}`);
  } else {
    kb.text('🛡 Promote admin', `adm:usr:promote:${user.telegram_id}`);
  }
  kb.row().text('⬅️ Back to users', 'adm:usr:0').text('🏠 Main', 'adm:root');
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
