/**
 * Super Admin Panel — لوحة تحكم المالك الرئيسي
 * تظهر فقط للـ ADMIN_USER_ID
 */
import { Composer, InlineKeyboard, InputFile } from 'grammy';
import type { AppCtx } from '../middleware/user.js';
import { env } from '../env.js';
import { logger } from '../logger.js';
import {
  listTenants,
  getTenant,
  addTenant,
  extendTenant,
  deleteTenant,
  getTenantStats,
  TENANTS_MIGRATION_SQL,
  type Tenant,
} from '../tenants/store.js';
import {
  launchTenantBot,
  suspendTenant,
  resumeTenant,
  isTenantRunning,
  getRunningBots,
} from '../tenants/manager.js';

export const superAdminBot = new Composer<AppCtx>();

const isSuperAdmin = (ctx: AppCtx) => ctx.from?.id === env.ADMIN_USER_ID;

// =====================================================================
// Session flows
// =====================================================================
type SuperFlow =
  | { type: 'add_tenant'; step: 'token' | 'owner_id' | 'supabase_url' | 'supabase_key' | 'days' | 'notes'; data: Record<string, unknown> }
  | { type: 'extend_tenant'; step: 'days'; data: { tenant_id: string } };

const superFlows = new Map<number, SuperFlow>();

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// =====================================================================
// /superadmin
// =====================================================================
superAdminBot.command('superadmin', async (ctx) => {
  if (!isSuperAdmin(ctx)) return;
  await showSuperRoot(ctx);
});

superAdminBot.callbackQuery('sa:root', async (ctx) => {
  if (!isSuperAdmin(ctx)) { await ctx.answerCallbackQuery(); return; }
  await ctx.answerCallbackQuery();
  await showSuperRoot(ctx);
});

async function showSuperRoot(ctx: AppCtx): Promise<void> {
  superFlows.delete(ctx.from!.id);
  let tenants: Tenant[] = [];
  try { tenants = await listTenants(); } catch { /* ignore */ }

  const active = tenants.filter((t) => t.status === 'active').length;
  const suspended = tenants.filter((t) => t.status === 'suspended').length;
  const expired = tenants.filter((t) => t.status === 'expired').length;
  const running = getRunningBots().length;

  const kb = new InlineKeyboard()
    .text('➕ Add Tenant', 'sa:add')
    .text('📋 List Tenants', 'sa:list:0')
    .row()
    .text('📊 Stats Overview', 'sa:stats')
    .text('🔄 Running Bots', 'sa:running')
    .row()
    .text('🗄 Run Migration', 'sa:migrate')
    .text('📥 SQL Schema', 'sa:get_sql');

  const text = [
    '🔱 <b>Super Admin Panel</b>',
    '',
    `📦 Total tenants: <b>${tenants.length}</b>`,
    `✅ Active: <b>${active}</b>`,
    `⏸ Suspended: <b>${suspended}</b>`,
    `❌ Expired: <b>${expired}</b>`,
    `🟢 Running: <b>${running}</b>`,
  ].join('\n');

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  } catch {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

// =====================================================================
// قائمة المستأجرين
// =====================================================================
superAdminBot.callbackQuery(/^sa:list:(\d+)$/, async (ctx) => {
  if (!isSuperAdmin(ctx)) { await ctx.answerCallbackQuery(); return; }
  await ctx.answerCallbackQuery();
  const page = Number(ctx.match[1]);
  const PER_PAGE = 5;

  let tenants: Tenant[] = [];
  try { tenants = await listTenants(); } catch {
    await ctx.editMessageText('❌ Failed to load tenants.', { reply_markup: new InlineKeyboard().text('⬅️ Back', 'sa:root') });
    return;
  }

  const total = tenants.length;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const slice = tenants.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  if (slice.length === 0) {
    await ctx.editMessageText('No tenants yet.', { reply_markup: new InlineKeyboard().text('⬅️ Back', 'sa:root') });
    return;
  }

  const lines = [`📋 <b>Tenants</b> — page ${page + 1}/${totalPages}`, ''];
  const kb = new InlineKeyboard();

  for (const t of slice) {
    const running = isTenantRunning(t.id);
    const statusEmoji = t.status === 'active' ? (running ? '🟢' : '🟡') : t.status === 'suspended' ? '⏸' : '❌';
    const end = new Date(t.subscription_end);
    const daysLeft = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    const daysStr = daysLeft > 0 ? `${daysLeft}d left` : 'expired';
    const botUser = esc(t.bot_username ?? '?');
    const ownerUser = t.owner_username ? esc(t.owner_username) : String(t.owner_telegram_id);
    lines.push(`${statusEmoji} @${botUser} — @${ownerUser} — ${daysStr}`);
    kb.text(`${statusEmoji} ${t.bot_username ?? t.id.slice(0, 8)}`, `sa:tenant:${t.id}`).row();
  }

  if (page > 0) kb.text('◀️ Prev', `sa:list:${page - 1}`);
  if (page + 1 < totalPages) kb.text('Next ▶️', `sa:list:${page + 1}`);
  kb.row().text('➕ Add', 'sa:add').text('⬅️ Back', 'sa:root');

  await ctx.editMessageText(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
});

// =====================================================================
// صفحة مستأجر واحد
// =====================================================================
superAdminBot.callbackQuery(/^sa:tenant:(t_[^:]+)$/, async (ctx) => {
  if (!isSuperAdmin(ctx)) { await ctx.answerCallbackQuery(); return; }
  await ctx.answerCallbackQuery();
  await showTenantCard(ctx, ctx.match[1]!);
});

async function showTenantCard(ctx: AppCtx, tenantId: string): Promise<void> {
  const t = await getTenant(tenantId);
  if (!t) {
    await ctx.editMessageText('❌ Tenant not found.', { reply_markup: new InlineKeyboard().text('⬅️ Back', 'sa:list:0') });
    return;
  }

  const running = isTenantRunning(t.id);
  const statusEmoji = t.status === 'active' ? (running ? '🟢' : '🟡') : t.status === 'suspended' ? '⏸' : '❌';
  const end = new Date(t.subscription_end);
  const daysLeft = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  let stats = { users: 0, orders: 0, revenue: 0 };
  try { stats = await getTenantStats(t); } catch { /* ignore */ }

  const lines = [
    `${statusEmoji} <b>Tenant: @${esc(t.bot_username ?? '?')}</b>`,
    '',
    `• Owner: ${t.owner_username ? `@${esc(t.owner_username)}` : ''} <code>${t.owner_telegram_id}</code>`,
    `• Status: <code>${t.status}</code> ${running ? '(running)' : '(stopped)'}`,
    `• Subscription: ${end.toLocaleDateString('en-GB')} (${daysLeft > 0 ? `${daysLeft} days left` : '⚠️ expired'})`,
    `• Supabase: <code>${esc(t.supabase_url.replace('https://', '').slice(0, 35))}</code>`,
    '',
    `👥 Users: <b>${stats.users}</b>`,
    `🧾 Orders: <b>${stats.orders}</b>`,
    `💰 Revenue: <b>$${stats.revenue.toFixed(2)}</b>`,
    t.notes ? `\n📝 Notes: <i>${esc(t.notes)}</i>` : '',
    `\n🆔 ID: <code>${t.id}</code>`,
  ].filter(Boolean);

  const kb = new InlineKeyboard();

  if (t.status === 'active' && running) {
    kb.text('⏸ Suspend', `sa:suspend:${t.id}`);
  } else if (t.status === 'suspended') {
    kb.text('▶️ Resume', `sa:resume:${t.id}`);
  } else if (t.status === 'active' && !running) {
    kb.text('▶️ Start Bot', `sa:start:${t.id}`);
  }

  kb.text('📅 Extend', `sa:extend:${t.id}`).row();
  kb.text('🔄 Refresh', `sa:tenant:${t.id}`).row();
  kb.text('🗑 Delete', `sa:delete:${t.id}`).row();
  kb.text('⬅️ Back', 'sa:list:0');

  await ctx.editMessageText(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb });
}

// =====================================================================
// تعليق / استئناف / تشغيل
// =====================================================================
superAdminBot.callbackQuery(/^sa:suspend:(t_[^:]+)$/, async (ctx) => {
  if (!isSuperAdmin(ctx)) { await ctx.answerCallbackQuery(); return; }
  const id = ctx.match[1]!;
  try {
    await suspendTenant(id);
    await ctx.answerCallbackQuery({ text: '⏸ Suspended' });
    const t = await getTenant(id);
    if (t) {
      try { await ctx.api.sendMessage(t.owner_telegram_id, '⚠️ Your bot has been suspended. Please contact support.'); } catch { /* ignore */ }
    }
  } catch {
    await ctx.answerCallbackQuery({ text: 'Failed', show_alert: true });
  }
  await showTenantCard(ctx, id);
});

superAdminBot.callbackQuery(/^sa:resume:(t_[^:]+)$/, async (ctx) => {
  if (!isSuperAdmin(ctx)) { await ctx.answerCallbackQuery(); return; }
  const id = ctx.match[1]!;
  try {
    const t = await getTenant(id);
    if (!t) throw new Error('not found');
    await resumeTenant(t);
    await ctx.answerCallbackQuery({ text: '▶️ Resumed' });
    try { await ctx.api.sendMessage(t.owner_telegram_id, '✅ Your bot has been resumed.'); } catch { /* ignore */ }
  } catch {
    await ctx.answerCallbackQuery({ text: 'Failed', show_alert: true });
  }
  await showTenantCard(ctx, id);
});

superAdminBot.callbackQuery(/^sa:start:(t_[^:]+)$/, async (ctx) => {
  if (!isSuperAdmin(ctx)) { await ctx.answerCallbackQuery(); return; }
  const id = ctx.match[1]!;
  try {
    const t = await getTenant(id);
    if (!t) throw new Error('not found');
    await launchTenantBot(t);
    await ctx.answerCallbackQuery({ text: '🟢 Started' });
  } catch {
    await ctx.answerCallbackQuery({ text: 'Failed', show_alert: true });
  }
  await showTenantCard(ctx, id);
});

// =====================================================================
// تمديد الاشتراك
// =====================================================================
superAdminBot.callbackQuery(/^sa:extend:(t_[^:]+)$/, async (ctx) => {
  if (!isSuperAdmin(ctx)) { await ctx.answerCallbackQuery(); return; }
  await ctx.answerCallbackQuery();
  const id = ctx.match[1]!;
  superFlows.set(ctx.from!.id, { type: 'extend_tenant', step: 'days', data: { tenant_id: id } });
  await ctx.editMessageText(
    '📅 <b>Extend Subscription</b>\n\nSend the number of days to add (e.g. <code>30</code>).\n\nOr /scancel.',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('⬅️ Back', `sa:tenant:${id}`) },
  );
});

// =====================================================================
// حذف مستأجر
// =====================================================================
superAdminBot.callbackQuery(/^sa:delete:(t_[^:]+)$/, async (ctx) => {
  if (!isSuperAdmin(ctx)) { await ctx.answerCallbackQuery(); return; }
  await ctx.answerCallbackQuery();
  const id = ctx.match[1]!;
  const t = await getTenant(id);
  const kb = new InlineKeyboard()
    .text('🗑 Yes, Delete', `sa:delete:confirm:${id}`)
    .text('❌ Cancel', `sa:tenant:${id}`);
  await ctx.editMessageText(
    `🗑 <b>Delete tenant @${esc(t?.bot_username ?? id)}?</b>\n\nThis stops the bot and removes it from the registry.\nThe tenant's Supabase data is NOT deleted.\n\nThis cannot be undone.`,
    { parse_mode: 'HTML', reply_markup: kb },
  );
});

superAdminBot.callbackQuery(/^sa:delete:confirm:(t_[^:]+)$/, async (ctx) => {
  if (!isSuperAdmin(ctx)) { await ctx.answerCallbackQuery(); return; }
  const id = ctx.match[1]!;
  try {
    const t = await getTenant(id);
    await suspendTenant(id);
    await deleteTenant(id);
    await ctx.answerCallbackQuery({ text: '🗑 Deleted' });
    if (t) {
      try { await ctx.api.sendMessage(t.owner_telegram_id, '❌ Your bot subscription has been cancelled.'); } catch { /* ignore */ }
    }
  } catch {
    await ctx.answerCallbackQuery({ text: 'Failed', show_alert: true });
  }
  await ctx.editMessageText('🗑 Tenant deleted.', { reply_markup: new InlineKeyboard().text('⬅️ Back', 'sa:list:0') });
});

// =====================================================================
// إضافة مستأجر — 6 خطوات
// =====================================================================
superAdminBot.callbackQuery('sa:add', async (ctx) => {
  if (!isSuperAdmin(ctx)) { await ctx.answerCallbackQuery(); return; }
  await ctx.answerCallbackQuery();
  superFlows.set(ctx.from!.id, { type: 'add_tenant', step: 'token', data: {} });
  await ctx.editMessageText(
    '➕ <b>Add New Tenant</b>\n\n<b>Step 1/6: Bot Token</b>\n\nSend the bot token from @BotFather.\nFormat: <code>1234567890:ABC...</code>\n\nOr /scancel.',
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('⬅️ Cancel', 'sa:root') },
  );
});

// =====================================================================
// إحصائيات
// =====================================================================
superAdminBot.callbackQuery('sa:stats', async (ctx) => {
  if (!isSuperAdmin(ctx)) { await ctx.answerCallbackQuery(); return; }
  await ctx.answerCallbackQuery({ text: 'Loading…' });

  let tenants: Tenant[] = [];
  try { tenants = await listTenants(); } catch {
    await ctx.editMessageText('❌ Failed.', { reply_markup: new InlineKeyboard().text('⬅️ Back', 'sa:root') });
    return;
  }

  let totalUsers = 0, totalOrders = 0, totalRevenue = 0;
  const rows: string[] = [];

  for (const t of tenants) {
    const stats = await getTenantStats(t);
    totalUsers += stats.users;
    totalOrders += stats.orders;
    totalRevenue += stats.revenue;
    const e = t.status === 'active' ? (isTenantRunning(t.id) ? '🟢' : '🟡') : '❌';
    rows.push(`${e} @${esc(t.bot_username ?? '?')}: ${stats.users} users · ${stats.orders} orders · $${stats.revenue.toFixed(2)}`);
  }

  const lines = [
    '📊 <b>Stats Overview</b>',
    '',
    `👥 Total Users: <b>${totalUsers}</b>`,
    `🧾 Total Orders: <b>${totalOrders}</b>`,
    `💰 Total Revenue: <b>$${totalRevenue.toFixed(2)}</b>`,
    '',
    '─────────────────',
    ...rows,
  ];

  await ctx.editMessageText(lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('⬅️ Back', 'sa:root'),
  });
});

// =====================================================================
// البوتات الشغالة
// =====================================================================
superAdminBot.callbackQuery('sa:running', async (ctx) => {
  if (!isSuperAdmin(ctx)) { await ctx.answerCallbackQuery(); return; }
  await ctx.answerCallbackQuery();
  const bots = getRunningBots();
  const lines = [
    '🔄 <b>Running Bots</b>',
    '',
    bots.length === 0
      ? '<i>No tenant bots running</i>'
      : bots.map((b) => `🟢 @${esc(b.username ?? '?')} — started ${b.startedAt.toLocaleTimeString('en-GB')}`).join('\n'),
  ];
  await ctx.editMessageText(lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: new InlineKeyboard().text('🔄 Refresh', 'sa:running').row().text('⬅️ Back', 'sa:root'),
  });
});

// =====================================================================
// Migration SQL
// =====================================================================
superAdminBot.callbackQuery('sa:migrate', async (ctx) => {
  if (!isSuperAdmin(ctx)) { await ctx.answerCallbackQuery(); return; }
  await ctx.answerCallbackQuery();
  await ctx.reply(
    `<b>Run this SQL in your Supabase SQL Editor:</b>\n\n<pre>${esc(TENANTS_MIGRATION_SQL)}</pre>`,
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('⬅️ Back', 'sa:root') },
  );
});

// =====================================================================
// Get SQL Schema File
// =====================================================================
superAdminBot.callbackQuery('sa:get_sql', async (ctx) => {
  if (!isSuperAdmin(ctx)) { await ctx.answerCallbackQuery(); return; }
  await ctx.answerCallbackQuery({ text: 'Sending SQL schema...' });
  try {
    await ctx.replyWithDocument(new InputFile('supabase/schema.sql'), {
      caption: '📄 <b>ملف تهيئة قاعدة بيانات البوت الجديد (schema.sql)</b>\nيرجى إرسال هذا الملف والملاحظة التالية للعميل.',
      parse_mode: 'HTML',
    });

    const instructions = [
      '📝 <b>خطوات تهيئة قاعدة البيانات للعميل (قم بتوجيهها للعميل):</b>',
      '',
      '1️⃣ افتح لوحة تحكم <b>Supabase</b> واذهب إلى مشروعك الجديد.',
      '2️⃣ من القائمة الجانبية اليسرى، اضغط على <b>SQL Editor</b>.',
      '3️⃣ اضغط على زر <b>New Query</b> (استعلام جديد).',
      '4️⃣ قم بسحب وإفلات ملف <code>schema.sql</code> المرفق أعلاه داخل الصفحة، أو افتحه وانسخ محتواه والصقه بالكامل.',
      '5️⃣ اضغط على زر <b>Run</b> في الأسفل لتشغيل الاستعلام.',
      '6️⃣ بعد انتهاء التشغيل بنجاح، اذهب إلى <b>Settings</b> ⚙️ -> <b>API</b> واضغط على تحديث كاش المخطط (<b>Reload Schema Cache</b>).',
      '',
      '💡 <i>بمجرد إتمام هذه الخطوات، سيعمل البوت تلقائياً وبشكل مستقل!</i>'
    ].join('\n');
    await ctx.reply(instructions, { parse_mode: 'HTML' });
  } catch (err) {
    logger.error({ err }, 'failed to send SQL file/instructions in sa:get_sql');
    await ctx.reply(`❌ Failed to send SQL file: ${(err as Error).message}`);
  }
});

// =====================================================================
// معالجة النصوص
// =====================================================================
superAdminBot.on('message:text', async (ctx, next) => {
  if (!isSuperAdmin(ctx)) return next();
  const flow = superFlows.get(ctx.from!.id);
  if (!flow) return next();

  const text = ctx.message.text.trim();

  if (text === '/scancel') {
    superFlows.delete(ctx.from!.id);
    await ctx.reply('❌ Cancelled.', { reply_markup: new InlineKeyboard().text('🔱 Super Admin', 'sa:root') });
    return;
  }

  try {
    // -------- تمديد --------
    if (flow.type === 'extend_tenant') {
      const days = Number(text);
      if (!Number.isInteger(days) || days < 1) {
        await ctx.reply('❌ Send a positive integer (e.g. <code>30</code>).', { parse_mode: 'HTML' });
        return;
      }
      const updated = await extendTenant(flow.data.tenant_id, days);
      superFlows.delete(ctx.from!.id);
      const newEnd = new Date(updated.subscription_end).toLocaleDateString('en-GB');
      await ctx.reply(
        `✅ Extended by <b>${days} days</b>.\nNew end: <b>${newEnd}</b>`,
        { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('View Tenant', `sa:tenant:${updated.id}`) },
      );
      try {
        await ctx.api.sendMessage(
          updated.owner_telegram_id,
          `✅ Your bot subscription has been extended by <b>${days} days</b>. New expiry: <b>${newEnd}</b>.`,
          { parse_mode: 'HTML' },
        );
      } catch { /* ignore */ }
      return;
    }

    // -------- إضافة مستأجر --------
    if (flow.type === 'add_tenant') {
      switch (flow.step) {

        case 'token': {
          if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(text)) {
            await ctx.reply('❌ Invalid token format. Should look like <code>1234567890:ABC...</code>\n\nTry again or /scancel.', { parse_mode: 'HTML' });
            return;
          }
          let botUsername: string | null = null;
          try {
            const { Bot } = await import('grammy');
            const testBot = new Bot(text);
            const me = await testBot.api.getMe();
            botUsername = me.username ?? null;
            await testBot.api.deleteWebhook({ drop_pending_updates: false });
          } catch {
            await ctx.reply('❌ Could not connect to that bot. Check the token and try again.');
            return;
          }
          flow.data.bot_token = text;
          flow.data.bot_username = botUsername;
          flow.step = 'owner_id';
          await ctx.reply(
            `✅ Bot: <code>@${esc(botUsername ?? '?')}</code>\n\n<b>Step 2/6: Owner Telegram ID</b>\n\nSend the Telegram ID of the person who will own this bot.\nExample: <code>123456789</code>`,
            { parse_mode: 'HTML' },
          );
          break;
        }

        case 'owner_id': {
          const ownerId = Number(text.replace('@', ''));
          if (!Number.isFinite(ownerId) || ownerId <= 0) {
            await ctx.reply('❌ Invalid Telegram ID. Send a numeric ID like <code>123456789</code>.', { parse_mode: 'HTML' });
            return;
          }
          let ownerUsername: string | null = null;
          try {
            const chat = await ctx.api.getChat(ownerId);
            ownerUsername = 'username' in chat ? (chat.username ?? null) : null;
          } catch { /* ignore */ }
          flow.data.owner_telegram_id = ownerId;
          flow.data.owner_username = ownerUsername;
          flow.step = 'supabase_url';
          await ctx.reply(
            `✅ Owner: ${ownerUsername ? `<code>@${esc(ownerUsername)}</code>` : `<code>${ownerId}</code>`}\n\n<b>Step 3/6: Supabase URL</b>\n\nSend the Supabase project URL.\nFormat: <code>https://xxxx.supabase.co</code>`,
            { parse_mode: 'HTML' },
          );
          break;
        }

        case 'supabase_url': {
          if (!text.startsWith('https://') || !text.includes('supabase')) {
            await ctx.reply('❌ Invalid Supabase URL. Should start with <code>https://</code> and contain <code>supabase</code>.', { parse_mode: 'HTML' });
            return;
          }
          flow.data.supabase_url = text.trim().replace(/\/$/, '');
          flow.step = 'supabase_key';
          await ctx.reply(
            '<b>Step 4/6: Supabase Service Key</b>\n\nSend the <code>service_role</code> key from Supabase → Settings → API.',
            { parse_mode: 'HTML' },
          );
          break;
        }

        case 'supabase_key': {
          if (text.length < 20) {
            await ctx.reply('❌ Key too short. Send the full <code>service_role</code> key.', { parse_mode: 'HTML' });
            return;
          }
          flow.data.supabase_service_key = text;
          flow.step = 'days';
          await ctx.reply(
            '<b>Step 5/6: Subscription Days</b>\n\nHow many days? (e.g. <code>30</code>)',
            { parse_mode: 'HTML' },
          );
          break;
        }

        case 'days': {
          const days = Number(text);
          if (!Number.isInteger(days) || days < 1) {
            await ctx.reply('❌ Send a positive integer (e.g. <code>30</code>).', { parse_mode: 'HTML' });
            return;
          }
          flow.data.subscription_days = days;
          flow.step = 'notes';
          await ctx.reply(
            '<b>Step 6/6: Notes (Optional)</b>\n\nSend any notes, or send <code>-</code> to skip.',
            { parse_mode: 'HTML' },
          );
          break;
        }

        case 'notes': {
          const notes = text === '-' ? undefined : text;
          superFlows.delete(ctx.from!.id);

          const tenant = await addTenant({
            bot_token: flow.data.bot_token as string,
            owner_telegram_id: flow.data.owner_telegram_id as number,
            owner_username: flow.data.owner_username as string | null,
            bot_username: flow.data.bot_username as string | null,
            supabase_url: flow.data.supabase_url as string,
            supabase_service_key: flow.data.supabase_service_key as string,
            subscription_days: flow.data.subscription_days as number,
            notes,
          });

          try { await launchTenantBot(tenant); } catch (err) {
            logger.error({ err }, 'failed to launch tenant bot after creation');
          }

          const end = new Date(tenant.subscription_end).toLocaleDateString('en-GB');
          await ctx.reply(
            [
              '✅ <b>Tenant Added!</b>',
              '',
              `• Bot: <code>@${esc(tenant.bot_username ?? '?')}</code>`,
              `• Owner: <code>${tenant.owner_username ? `@${esc(tenant.owner_username)}` : tenant.owner_telegram_id}</code>`,
              `• Subscription: <b>${flow.data.subscription_days} days</b> (until ${end})`,
              `• Status: 🟢 Running`,
            ].join('\n'),
            {
              parse_mode: 'HTML',
              reply_markup: new InlineKeyboard()
                .text('View Tenant', `sa:tenant:${tenant.id}`)
                .text('⬅️ Main', 'sa:root'),
            },
          );

          // Send SQL file and instructions to the super admin
          try {
            await ctx.replyWithDocument(new InputFile('supabase/schema.sql'), {
              caption: '📄 <b>ملف تهيئة قاعدة بيانات البوت الجديد (schema.sql)</b>\nيرجى إرسال هذا الملف والملاحظة التالية للعميل.',
              parse_mode: 'HTML',
            });

            const instructions = [
              '📝 <b>خطوات تهيئة قاعدة البيانات للعميل (قم بتوجيهها للعميل):</b>',
              '',
              '1️⃣ افتح لوحة تحكم <b>Supabase</b> واذهب إلى مشروعك الجديد.',
              '2️⃣ من القائمة الجانبية اليسرى، اضغط على <b>SQL Editor</b>.',
              '3️⃣ اضغط على زر <b>New Query</b> (استعلام جديد).',
              '4️⃣ قم بسحب وإفلات ملف <code>schema.sql</code> المرفق أعلاه داخل الصفحة، أو افتحه وانسخ محتواه والصقه بالكامل.',
              '5️⃣ اضغط على زر <b>Run</b> في الأسفل لتشغيل الاستعلام.',
              '6️⃣ بعد انتهاء التشغيل بنجاح، اذهب إلى <b>Settings</b> ⚙️ -> <b>API</b> واضغط على تحديث كاش المخطط (<b>Reload Schema Cache</b>).',
              '',
              '💡 <i>بمجرد إتمام هذه الخطوات، سيعمل البوت تلقائياً وبشكل مستقل!</i>'
            ].join('\n');
            await ctx.reply(instructions, { parse_mode: 'HTML' });
          } catch (err) {
            logger.error({ err }, 'failed to send SQL file/instructions to super admin');
          }

          // Send SQL file and instructions directly to the owner/client
          try {
            await ctx.api.sendMessage(
              tenant.owner_telegram_id,
              [
                '🎉 <b>تم تجهيز البوت الخاص بك بنجاح!</b>',
                '',
                `• البوت: <code>@${esc(tenant.bot_username ?? '?')}</code>`,
                `• مدة الاشتراك: <b>${flow.data.subscription_days} يوم</b> (حتى ${end})`,
                '',
                '⚠️ <b>هام جداً:</b> يجب تهيئة قاعدة بيانات Supabase الخاصة بك أولاً لكي يبدأ البوت بالعمل. يرجى تنزيل ملف الـ SQL المرفق أدناه وتشغيله في مشروعك.',
              ].join('\n'),
              { parse_mode: 'HTML' },
            );

            await ctx.api.sendDocument(
              tenant.owner_telegram_id,
              new InputFile('supabase/schema.sql'),
              {
                caption: '📄 <b>ملف تهيئة قاعدة البيانات (schema.sql)</b>',
                parse_mode: 'HTML',
              }
            );

            const ownerInstructions = [
              '📝 <b>خطوات تشغيل ملف الـ SQL:</b>',
              '',
              '1️⃣ افتح مشروعك في <b>Supabase</b>.',
              '2️⃣ اذهب إلى <b>SQL Editor</b> واضغط <b>New Query</b>.',
              '3️⃣ انسخ محتوى ملف <code>schema.sql</code> المرفق بالكامل والصقه في المحرر.',
              '4️⃣ اضغط على زر <b>Run</b> لتشغيل السكربت.',
              '5️⃣ اذهب إلى <b>Settings</b> ⚙️ -> <b>API</b> واضغط <b>Reload Schema Cache</b>.',
              '',
              '💡 <i>بمجرد إتمام الخطوات سيبدأ بوتك بالعمل تلقائياً!</i>'
            ].join('\n');
            await ctx.api.sendMessage(tenant.owner_telegram_id, ownerInstructions, { parse_mode: 'HTML' });
          } catch (err) {
            logger.warn({ err, owner_id: tenant.owner_telegram_id }, 'failed to send welcome/SQL to tenant owner');
          }
          break;
        }
      }
      return;
    }

  } catch (err) {
    logger.error({ err, flow }, 'super admin flow error');
    superFlows.delete(ctx.from!.id);
    await ctx.reply(`❌ Error: <code>${esc((err as Error).message?.slice(0, 200) ?? 'unknown')}</code>`, { parse_mode: 'HTML' });
  }
});