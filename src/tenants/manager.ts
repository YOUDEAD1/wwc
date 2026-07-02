/**
 * Tenant Manager — يشغل كل tenant bot كـ child process منفصل
 * كل process له env خاص = قاعدة بيانات منفصلة تماماً
 */
import type http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { logger } from '../logger.js';
import { listActiveTenants, setTenantStatus, getTenantByToken, type Tenant } from './store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Detect if running TypeScript directly or compiled JavaScript
const isTs = __filename.endsWith('.ts');
const WORKER_PATH = join(__dirname, '..', isTs ? 'tenant-worker.ts' : 'tenant-worker.js');

type RunningBot = {
  tenant: Tenant;
  process: ChildProcess;
  startedAt: Date;
};

const running = new Map<string, RunningBot>();

async function startTenantProcess(tenant: Tenant): Promise<void> {
  if (running.has(tenant.id)) {
    logger.warn({ tenantId: tenant.id }, 'tenant bot already running');
    return;
  }

  const tenantEnv: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][]
    ),
    // --- override بقيم المستأجر ---
    TELEGRAM_BOT_TOKEN: tenant.bot_token,
    BOT_TOKEN: tenant.bot_token,
    SUPABASE_URL: tenant.supabase_url,
    SUPABASE_SERVICE_ROLE_KEY: tenant.supabase_service_key,
    ADMIN_USER_ID: String(tenant.owner_telegram_id),
    OWNER_USERNAME: tenant.owner_username ?? '',
    BOT_USERNAME: tenant.bot_username ?? 'bot',
    BOT_MODE: process.env.PUBLIC_BASE_URL ? 'webhook' : 'polling',
    IS_TENANT: 'true',
    TENANT_ID: tenant.id,
    SUBSCRIPTION_END: tenant.subscription_end,
    MASTER_CONTACT_URL: process.env.ADMIN_CONTACT_URL ?? 'https://t.me/lara_v2',
    // منع webhook في tenant
    WEBHOOK_URL: '',
    WEBHOOK_SECRET: '',
    // تعطيل القنوات والمسارات التلقائية للمشتركين لمنع التداخل وحظر البوتات
    LOG_CHAT_ID: 'off',
    ORDER_LOG_CHAT_ID: 'off',
    BOT_REFERS_CHANNEL: 'off',
    PUBLIC_FEED_CHAT_ID: 'off',
  };

  const args = [...process.execArgv, WORKER_PATH];
  const child = spawn(process.execPath, args, {
    env: tenantEnv,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    detached: false,
  });

  child.on('error', (err) => {
    logger.error({ tenantId: tenant.id, err }, 'Failed to start tenant bot child process');
  });

  child.stdout?.on('data', (data: Buffer) => {
    logger.info(
      { tenantId: tenant.id, bot: tenant.bot_username },
      `[tenant] ${data.toString().trim()}`,
    );
  });

  child.stderr?.on('data', (data: Buffer) => {
    logger.warn(
      { tenantId: tenant.id, bot: tenant.bot_username },
      `[tenant-err] ${data.toString().trim()}`,
    );
  });

  child.on('exit', (code, signal) => {
    logger.warn({ tenantId: tenant.id, code, signal }, 'tenant bot process exited');
    running.delete(tenant.id);
    // إعادة التشغيل بعد 15 ثانية إذا لم يُوقف يدوياً
    setTimeout(() => {
      if (!running.has(tenant.id)) {
        void restartIfActive(tenant.id);
      }
    }, 15_000);
  });

  running.set(tenant.id, { tenant, process: child, startedAt: new Date() });
  logger.info({ tenantId: tenant.id, username: tenant.bot_username, pid: child.pid }, 'tenant bot process started');
}

async function restartIfActive(tenantId: string): Promise<void> {
  try {
    const { getTenant } = await import('./store.js');
    const t = await getTenant(tenantId);
    if (!t || t.status !== 'active') return;
    if (new Date(t.subscription_end) < new Date()) return;
    await startTenantProcess(t);
  } catch (err) {
    logger.warn({ err, tenantId }, 'failed to restart tenant bot');
  }
}

export async function startAllTenantBots(): Promise<void> {
  let tenants: Tenant[] = [];
  try {
    tenants = await listActiveTenants();
  } catch (err) {
    logger.warn({ err }, 'could not load tenants — skipping tenant bots');
    return;
  }
  logger.info({ count: tenants.length }, 'starting tenant bots');
  for (const tenant of tenants) {
    await startTenantProcess(tenant);
    await new Promise((r) => setTimeout(r, 600));
  }
}

export async function launchTenantBot(tenant: Tenant): Promise<void> {
  await startTenantProcess(tenant);
}

export async function stopTenantBot(tenantId: string): Promise<void> {
  const entry = running.get(tenantId);
  if (!entry) return;
  try { entry.process.kill('SIGTERM'); } catch { /* ignore */ }
  running.delete(tenantId);
  logger.info({ tenantId }, 'tenant bot stopped');
}

export async function suspendTenant(tenantId: string): Promise<void> {
  await stopTenantBot(tenantId);
  await setTenantStatus(tenantId, 'suspended');
}

export async function resumeTenant(tenant: Tenant): Promise<void> {
  await setTenantStatus(tenant.id, 'active');
  await startTenantProcess(tenant);
}

export function isTenantRunning(tenantId: string): boolean {
  return running.has(tenantId);
}

export function getRunningBots(): { tenantId: string; username: string | null; startedAt: Date }[] {
  return Array.from(running.values()).map((r) => ({
    tenantId: r.tenant.id,
    username: r.tenant.bot_username,
    startedAt: r.startedAt,
  }));
}

export async function checkExpiredTenants(): Promise<void> {
  const now = new Date();
  for (const [tenantId, entry] of running.entries()) {
    const end = new Date(entry.tenant.subscription_end);
    if (end < now) {
      logger.info({ tenantId }, 'tenant subscription expired — stopping');
      await suspendTenant(tenantId);
      await setTenantStatus(tenantId, 'expired');
      try {
        const { Bot } = await import('grammy');
        const bot = new Bot(entry.tenant.bot_token);
        await bot.api.sendMessage(
          entry.tenant.owner_telegram_id,
          '⚠️ Your bot subscription has expired. Please contact support to renew.',
        );
      } catch { /* ignore */ }
    }
  }
}

export async function handleTenantWebhookRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const url = req.url ?? '';
  if (!url.startsWith('/webhook/tenant/')) return false;

  const token = url.split('/').pop()?.trim();
  if (!token) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'missing_token' }));
    return true;
  }

  let bodyStr = '';
  try {
    for await (const chunk of req) {
      bodyStr += chunk;
    }
  } catch (err) {
    logger.error({ err }, 'Error reading tenant webhook request body');
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'read_error' }));
    return true;
  }

  try {
    const update = JSON.parse(bodyStr);
    const tenant = await getTenantByToken(token);
    if (!tenant) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'tenant_not_found' }));
      return true;
    }

    const entry = running.get(tenant.id);
    if (!entry) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'tenant_not_running' }));
      return true;
    }

    if (entry.process.connected) {
      entry.process.send({ type: 'telegram_update', update });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'tenant_process_disconnected' }));
    }
  } catch (err) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'invalid_json' }));
  }
  return true;
}