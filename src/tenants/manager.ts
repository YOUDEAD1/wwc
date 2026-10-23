import { randomUUID } from 'node:crypto';
import { inheritedTenantEnvironment, validWebhookSecret } from './security.js';
/**
 * Tenant Manager — يشغل كل tenant bot كـ child process منفصل
 * كل process له env خاص = قاعدة بيانات منفصلة تماماً
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../logger.js';
import { listActiveTenants, setTenantStatus, type Tenant } from './store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Detect if running TypeScript directly or compiled JavaScript
const isTs = __filename.endsWith('.ts');
const WORKER_PATH = join(__dirname, '..', isTs ? 'tenant-worker.ts' : 'tenant-worker.js');

type RunningBot = {
  tenant: Tenant;
  process: ChildProcess;
  startedAt: Date;
  ready: boolean;
};

const running = new Map<string, RunningBot>();
const explicitlyStopped = new Set<string>();
const acknowledgements = new Map<
  string,
  { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }
>();

async function startTenantProcess(tenant: Tenant): Promise<void> {
  if (running.has(tenant.id)) {
    logger.warn({ tenantId: tenant.id }, 'tenant bot already running');
    return;
  }

  const tenantEnv: Record<string, string> = {
    ...inheritedTenantEnvironment(process.env),
    DOTENV_CONFIG_PATH: join(__dirname, 'tenant.env.disabled'),
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

  child.on('message', (message: any) => {
    if (message?.type === 'ready') {
      const entry = running.get(tenant.id);
      if (entry?.process === child) entry.ready = true;
    }
    if (message?.type === 'update_ack') {
      const pending = acknowledgements.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        acknowledgements.delete(message.id);
        pending.resolve(message.ok === true);
      }
    }
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
    if (running.get(tenant.id)?.process === child) running.delete(tenant.id);
    // إعادة التشغيل بعد 15 ثانية إذا لم يُوقف يدوياً
    setTimeout(() => {
      if (!explicitlyStopped.has(tenant.id) && !running.has(tenant.id)) {
        void restartIfActive(tenant.id);
      }
    }, 15_000);
  });

  running.set(tenant.id, { tenant, process: child, startedAt: new Date(), ready: false });
  logger.info(
    { tenantId: tenant.id, username: tenant.bot_username, pid: child.pid },
    'tenant bot process started',
  );
}

async function restartIfActive(tenantId: string): Promise<void> {
  try {
    const { getTenant } = await import('./store.js');
    const t = await getTenant(tenantId);
    if (explicitlyStopped.has(tenantId) || !t || t.status !== 'active') return;
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
  explicitlyStopped.delete(tenant.id);
  const entry = running.get(tenant.id);
  if (entry) {
    entry.tenant = tenant;
    entry.process.send?.({ type: 'tenant_config', subscriptionEnd: tenant.subscription_end });
    return;
  }
  await startTenantProcess(tenant);
}

export async function stopTenantBot(tenantId: string): Promise<void> {
  explicitlyStopped.add(tenantId);
  const entry = running.get(tenantId);
  if (!entry) return;
  try {
    entry.process.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  running.delete(tenantId);
  logger.info({ tenantId }, 'tenant bot stopped');
}

export async function suspendTenant(tenantId: string): Promise<void> {
  await stopTenantBot(tenantId);
  await setTenantStatus(tenantId, 'suspended');
}

export async function resumeTenant(tenant: Tenant): Promise<void> {
  await setTenantStatus(tenant.id, 'active');
  await launchTenantBot({ ...tenant, status: 'active' });
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
      } catch {
        /* ignore */
      }
    }
  }
}

export async function handleTenantWebhookRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (!path.startsWith('/webhook/tenant/')) return false;
  const respond = (status: number, error?: string) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: status === 200, ...(error ? { error } : {}) }));
  };
  if (req.method !== 'POST') {
    respond(405, 'method_not_allowed');
    return true;
  }
  const id = path.slice('/webhook/tenant/'.length);
  const entry = running.get(id);
  if (
    !entry ||
    entry.tenant.status !== 'active' ||
    new Date(entry.tenant.subscription_end).getTime() <= Date.now()
  ) {
    respond(404, 'tenant_unavailable');
    return true;
  }
  const header = req.headers['x-telegram-bot-api-secret-token'];
  if (
    !validWebhookSecret(typeof header === 'string' ? header : undefined, entry.tenant.bot_token)
  ) {
    respond(403, 'invalid_secret');
    return true;
  }
  if (!entry.ready || !entry.process.connected) {
    respond(503, 'tenant_not_ready');
    return true;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += b.length;
    if (bytes > 256 * 1024) {
      respond(413, 'body_too_large');
      return true;
    }
    chunks.push(b);
  }
  let update: any;
  try {
    update = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Number.isInteger(update.update_id)) throw Error('Invalid update');
  } catch {
    respond(400, 'invalid_json');
    return true;
  }
  const requestId = randomUUID();
  const ok = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      acknowledgements.delete(requestId);
      resolve(false);
    }, 45000);
    acknowledgements.set(requestId, { resolve, timer });
    entry.process.send({ type: 'telegram_update', id: requestId, update }, (err) => {
      if (err) {
        clearTimeout(timer);
        acknowledgements.delete(requestId);
        resolve(false);
      }
    });
  });
  respond(ok ? 200 : 503, ok ? undefined : 'handler_failed');
  return true;
}
