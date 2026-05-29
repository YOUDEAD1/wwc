/**
 * Tenant Manager — يشغل كل tenant bot كـ child process منفصل
 * كل process له env خاص = قاعدة بيانات منفصلة تماماً
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { logger } from '../logger.js';
import { listActiveTenants, setTenantStatus, type Tenant } from './store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// المسار الصحيح لـ tenant-worker.js بعد البناء
// __dirname = dist/src/tenants/ → نرجع مستويين
const WORKER_PATH = join(__dirname, '..', 'tenant-worker.js');

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
    BOT_USERNAME: tenant.bot_username ?? 'bot',
    BOT_MODE: 'polling',
    IS_TENANT: 'true',
    TENANT_ID: tenant.id,
    // منع webhook في tenant
    WEBHOOK_URL: '',
    WEBHOOK_SECRET: '',
  };

  const child = spawn(process.execPath, [WORKER_PATH], {
    env: tenantEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
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