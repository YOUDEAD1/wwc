/**
 * Admin dashboard — fully button-driven.
 *
 * Entry: /admin (admin only). Everything else happens via inline
 * buttons + multi-step text input collected through `session.adminFlow`.
 */
import { Composer, InlineKeyboard } from 'grammy';
import { adminOnly } from '../../middleware/adminOnly.js';
import {
  addCategory,
  addPaymentMethod,
  addProduct,
  adjustBalance,
  deleteCategory,
  deletePaymentMethod,
  deleteProduct,
  getDeposit,
  getStats,
  listAllCategories,
  listAllProducts,
  listPaymentMethods,
  listPendingDeposits,
  listUsersForAnnouncement,
  setDepositStatus,
  setProductActive,
} from '../../db/queries.js';
import * as cache from '../../services/cache.js';
import { setColor, setEmoji, setText, refreshSettings } from '../../services/settings.js';
import { renderPremium } from '../../services/premium.js';
import type { ColorMode } from '../../../config/index.js';
import { COLOR_PREFIX } from '../../../config/index.js';
import type { AppCtx } from '../../middleware/user.js';
import { logger } from '../../logger.js';

export const adminBot = new Composer<AppCtx>();
adminBot.use(adminOnly);

const PER_PAGE = 8;
const ROOT_TEXT = '🛠 *Admin Dashboard*\n\nPick a section:';

function rootMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📦 Products', 'adm:prod')
    .text('🗂 Categories', 'adm:cat')
    .row()
    .text('💳 Payments', 'adm:pay')
    .text('💰 Deposits', 'adm:dep')
    .row()
    .text('✏️ Customize', 'adm:cust')
    .text('📣 Announce', 'adm:ann')
    .row()
    .text('📊 Stats', 'adm:stats')
    .text('🔁 Reload', 'adm:reload')
    .row()
    .text('🧹 Clear Cache', 'adm:clr')
    .text('❌ Close', 'adm:close');
}

const backRow = (kb: InlineKeyboard) => kb.row().text('⬅️ Back', 'adm:root');

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
    .text('📋 List & Manage', 'adm:pay:list');
  backRow(kb);
  await ctx.editMessageText('💳 *Payment Methods*', {
    parse_mode: 'Markdown',
    reply_markup: kb,
  });
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
    lines.push(
      `#${d.id}  user \`${d.user_id}\`  ${d.method}  $${d.amount}` +
        (d.reference ? `\n     ref: ${d.reference}` : ''),
    );
    kb.text(`✅ Approve #${d.id}`, `adm:dep:ok:${d.id}`)
      .text(`❌ Reject #${d.id}`, `adm:dep:no:${d.id}`)
      .row();
  }
  backRow(kb);
  await ctx.editMessageText(lines.join('\n'), { parse_mode: 'Markdown', reply_markup: kb });
}

adminBot.callbackQuery(/^adm:dep:ok:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  const dep = await getDeposit(id);
  if (!dep || dep.status !== 'pending') {
    await ctx.answerCallbackQuery({ text: 'Deposit no longer pending.' });
    await showDepositList(ctx);
    return;
  }
  await setDepositStatus(id, 'approved');
  const newBal = await adjustBalance(dep.user_id, Number(dep.amount));
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
  const kb = new InlineKeyboard()
    .text('📝 Edit Text', 'adm:cust:text')
    .text('🎨 Set Color', 'adm:cust:color:pick')
    .row()
    .text('😀 Set Emoji', 'adm:cust:emoji')
    .text('🔁 Reload Settings', 'adm:reload');
  backRow(kb);
  await ctx.editMessageText(
    '✏️ *Customize*\n\nEdit any text, button color, or emoji used by the bot.',
    { parse_mode: 'Markdown', reply_markup: kb },
  );
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

adminBot.callbackQuery('adm:cust:emoji', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = { type: 'set_emoji', step: 'key', data: {} };
  await ctx.editMessageText(
    '😀 *Set Emoji*\n\nSend the *emoji key* you want to map (e.g. `tiger`, `fire`, `wallet`).' +
      '\n\nOr `/cancel`.',
    { parse_mode: 'Markdown', reply_markup: backRow(new InlineKeyboard()) },
  );
});

adminBot.callbackQuery('adm:cust:color:pick', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.adminFlow = { type: 'set_text', step: 'key', data: {} };
  // Reuse the "set_text" flow shape but tag it as set_color via a sentinel:
  // The user types a key then chooses a color from buttons (handled below).
  ctx.session.adminFlow = { type: 'set_color', step: 'value', data: { key: '' } };
  await ctx.editMessageText(
    '🎨 *Set Color*\n\nSend the *button key* (e.g. `buy_now`, `topup`, `shop`).' +
      '\n\nOr `/cancel`.',
    { parse_mode: 'Markdown', reply_markup: backRow(new InlineKeyboard()) },
  );
});

adminBot.callbackQuery(/^adm:color:set:(.+):(.+)$/, async (ctx) => {
  const key = ctx.match[1]!;
  const color = ctx.match[2] as ColorMode;
  if (!(color in COLOR_PREFIX)) {
    await ctx.answerCallbackQuery({ text: 'Bad color' });
    return;
  }
  await setColor(key, color, ctx.from!.id);
  await ctx.answerCallbackQuery({ text: `Set ${key} → ${color}` });
  await showRoot(ctx);
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
  let ok = 0;
  let fail = 0;
  for (const r of recipients) {
    try {
      const { text, entities } = renderPremium(body);
      await ctx.api.sendMessage(r.telegram_id, text, {
        entities: entities.length ? entities : undefined,
        parse_mode: entities.length ? undefined : 'Markdown',
      });
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

// ============================================================
// Multi-step input handler — fired for any text msg from admin
// when session.adminFlow is set.
// ============================================================
adminBot.on('message:text', async (ctx, next) => {
  const flow = ctx.session.adminFlow;
  if (!flow) return next();

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
        ctx.session.adminFlow = { type: 'set_emoji', step: 'value', data: { key: text } };
        await ctx.reply(
          `Send the emoji as \`<unicode> [custom_emoji_id]\` for \`${text}\`. ` +
            `Example: \`🐯\` or \`🐯 5440733430971678660\` (premium).`,
          { parse_mode: 'Markdown' },
        );
      } else if (flow.step === 'value') {
        const [unicode, customId] = text.split(/\s+/, 2);
        if (!unicode) {
          await ctx.reply('❌ Empty value.');
          return;
        }
        await setEmoji(flow.data.key, unicode, customId, ctx.from!.id);
        ctx.session.adminFlow = undefined;
        await ctx.reply(`✅ Emoji \`${flow.data.key}\` updated.`, {
          parse_mode: 'Markdown',
          reply_markup: rootMenu(),
        });
      }
      return;
    }

    if (flow.type === 'set_color') {
      // Expecting key
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
        const { text: rendered, entities } = renderPremium(text);
        await ctx.reply(rendered, {
          entities: entities.length ? entities : undefined,
          parse_mode: entities.length ? undefined : 'Markdown',
        });
        await ctx.reply('Confirm sending:', { reply_markup: kb });
      }
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
