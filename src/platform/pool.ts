import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inheritedTenantEnvironment } from '../tenants/security.js';
import { Registry, effectivePlan, type Shop } from './repository.js';
import type { PlatformConfig } from './config.js';
import { PlatformError } from './security.js';
type Entry = {
  child: ChildProcess;
  ready: Promise<void>;
  readyDone: boolean;
  stopping: boolean;
  busy: number;
  lastUsed: number;
  shop: Shop;
};
type Reply = { status: number; headers: Record<string, string>; body: string };
type Waiting = {
  shop: Shop;
  resolve: (entry: Entry) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};
export class WorkerPool {
  readonly entries = new Map<string, Entry>();
  readonly seen = new Map<string, number>();
  readonly activity = new Map<string, string>();
  readonly purchases = new Map<string, string>();
  readonly failures = new Map<string, { code: string; at: string }>();
  private pending = new Map<string, { shop: string; resolve: (value: any) => void }>();
  private waiting: Waiting[] = [];
  private pumping = false;
  private updates = new Map<string, Promise<void>>();
  private stopping = false;
  private flushing = false;
  private timer: NodeJS.Timeout;
  constructor(
    readonly registry: Registry,
    readonly config: PlatformConfig,
    private launch?: (shop: Shop) => ChildProcess,
  ) {
    this.timer = setInterval(() => this.evict(), 10000);
    this.timer.unref();
  }
  private spawn(shop: Shop) {
    if (this.launch) return this.launch(shop);
    const s = this.registry.secrets(shop);
    return fork(fileURLToPath(new URL('../tenant-worker.js', import.meta.url)), [], {
      execArgv: [`--max-old-space-size=${this.config.heapMb}`],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: {
        ...inheritedTenantEnvironment(process.env),
        DOTENV_CONFIG_PATH: fileURLToPath(new URL('./tenant.env.disabled', import.meta.url)),
        IS_TENANT: 'true',
        WWC_MANAGED: '1',
        TENANT_ID: shop.id,
        TELEGRAM_BOT_TOKEN: s.botToken,
        BOT_TOKEN: s.botToken,
        BOT_USERNAME: shop.bot_username,
        ADMIN_USER_ID: String(shop.owner_id),
        SUPABASE_URL: s.databaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: s.databaseKey,
        BOT_MODE: 'webhook',
        PUBLIC_BASE_URL: this.config.publicUrl,
        DEFAULT_LANG: shop.owner_lang,
        TENANT_PLAN: effectivePlan(shop),
        TENANT_PAID_UNTIL: shop.paid_until ?? '',
        NSS_BOT_USERNAME: this.config.nssUsername,
        WWC_MANAGER_USERNAME: this.config.managerUsername || '',
        TENANT_SOURCE_URL: s.sourceUrl,
        TENANT_SOURCE_KEY: s.sourceKey,
        SUBSCRIPTION_END: shop.paid_until ?? '9999-12-31T00:00:00Z',
        SUPPLIER_SYNC_INTERVAL_MS: '600000',
        LOG_CHAT_ID: '0',
        ORDER_LOG_CHAT_ID: '0',
        BOT_REFERS_CHANNEL: '0',
        PUBLIC_FEED_CHAT_ID: '0',
      },
    });
  }
  private acquire(shop: Shop) {
    if (this.stopping) throw new PlatformError(503, 'HOST_RESTARTING');
    const old = this.entries.get(shop.id);
    if (old) {
      if (old.busy >= 4 || old.stopping) throw new PlatformError(503, 'WORKER_BUSY');
      old.shop = shop;
      old.child.send({
        type: 'platform_config',
        plan: effectivePlan(shop),
        paidUntil: shop.paid_until,
      });
      return old;
    }
    if (this.entries.size >= this.config.maxWorkers) {
      const idle = [...this.entries.entries()]
        .filter(([, e]) => !e.busy && !e.stopping)
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (idle) this.stop(idle[0]);
    }
    // A terminating process keeps its slot until exit, so peak RAM never exceeds the cap.
    if (this.entries.size >= this.config.maxWorkers)
      throw new PlatformError(503, 'WORKER_CAPACITY');
    const child = this.spawn(shop);
    let resolve!: () => void, reject!: (e: Error) => void;
    const ready = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void ready.catch(() => {});
    const entry: Entry = {
      child,
      ready,
      readyDone: false,
      stopping: false,
      busy: 0,
      lastUsed: Date.now(),
      shop,
    };
    this.entries.set(shop.id, entry);
    const startup = setTimeout(() => {
      this.failure(shop.id, 'WORKER_START_TIMEOUT');
      reject(Error('WORKER_START_TIMEOUT'));
      this.stop(shop.id, true);
    }, 30000);
    child.on('message', (m: any) => {
      if (m?.type === 'ready') {
        clearTimeout(startup);
        entry.readyDone = true;
        resolve();
      }
      if (m?.type === 'update_ack' || m?.type === 'api_result') this.pending.get(m.id)?.resolve(m);
      if (m?.type === 'platform_activity') this.activity.set(shop.id, `customer:${randomUUID()}`);
      if (m?.type === 'platform_purchase' && Number.isInteger(m.orderId))
        this.purchases.set(shop.id, `${shop.id}:order:${m.orderId}`);
    });
    child.stderr?.resume();
    child.on('error', () => reject(Error('WORKER_START_FAILED')));
    child.on('exit', () => {
      clearTimeout(startup);
      reject(Error('WORKER_EXITED'));
      if (!entry.stopping) this.failure(shop.id, 'WORKER_EXITED');
      if (this.entries.get(shop.id) === entry) this.entries.delete(shop.id);
      for (const p of this.pending.values()) if (p.shop === shop.id) p.resolve(null);
      this.pump();
    });
    return entry;
  }
  get queuedRequests() {
    return this.waiting.length;
  }
  private reserve(shop: Shop): Promise<Entry> {
    if (this.stopping) return Promise.reject(new PlatformError(503, 'HOST_RESTARTING'));
    if (this.waiting.length >= (this.config.queueLimit ?? 32))
      return Promise.reject(new PlatformError(503, 'WORKER_QUEUE_FULL'));
    return new Promise((resolve, reject) => {
      const job: Waiting = {
        shop,
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.waiting.indexOf(job);
          if (index < 0) return;
          this.waiting.splice(index, 1);
          reject(new PlatformError(503, 'WORKER_QUEUE_TIMEOUT'));
          this.pump();
        }, this.config.queueWaitMs ?? 15000),
      };
      this.waiting.push(job);
      this.pump();
    });
  }
  private pump() {
    if (this.pumping || this.stopping) return;
    this.pumping = true;
    try {
      while (this.waiting.length) {
        const job = this.waiting[0]!;
        let entry: Entry;
        try {
          entry = this.acquire(job.shop);
        } catch (error) {
          if (
            error instanceof PlatformError &&
            ['WORKER_CAPACITY', 'WORKER_BUSY'].includes(error.code)
          )
            return;
          this.waiting.shift();
          clearTimeout(job.timer);
          job.reject(error instanceof Error ? error : Error('WORKER_START_FAILED'));
          continue;
        }
        this.waiting.shift();
        clearTimeout(job.timer);
        // Reserve synchronously before another waiter can acquire the same slot.
        entry.busy++;
        entry.lastUsed = Date.now();
        job.resolve(entry);
      }
    } finally {
      this.pumping = false;
    }
  }
  private async request(shop: Shop, message: Record<string, unknown>) {
    const entry = await this.reserve(shop);
    try {
      await entry.ready;
      const id = randomUUID();
      const result = await new Promise<any>((resolve) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          resolve(null);
        }, 40000);
        this.pending.set(id, {
          shop: shop.id,
          resolve: (value) => {
            clearTimeout(timer);
            this.pending.delete(id);
            resolve(value);
          },
        });
        entry.child.send({ ...message, id }, (err) => {
          if (err) this.pending.get(id)?.resolve(null);
        });
      });
      if (!result) throw new PlatformError(503, 'UPDATE_RETRY');
      this.failures.delete(shop.id);
      return result;
    } finally {
      entry.busy--;
      entry.lastUsed = Date.now();
      this.pump();
    }
  }
  async update(shop: Shop, update: { update_id: number }) {
    const key = `${shop.id}:${update.update_id}`;
    if ((this.seen.get(key) ?? 0) > Date.now()) return;
    let task = this.updates.get(key);
    if (!task) {
      task = (async () => {
        const result = await this.request(shop, { type: 'telegram_update', update });
        if (!result.ok) throw new PlatformError(503, 'UPDATE_RETRY');
        this.seen.set(key, Date.now() + 300000);
        while (this.seen.size > 2000) this.seen.delete(this.seen.keys().next().value!);
      })().finally(() => this.updates.delete(key));
      this.updates.set(key, task);
    }
    return task;
  }
  async http(
    shop: Shop,
    method: string,
    path: string,
    headers: Record<string, unknown>,
    body: Buffer,
    remote: string,
  ): Promise<Reply> {
    return this.request(shop, {
      type: 'api_request',
      method,
      path,
      headers,
      body: body.toString('base64'),
      remote,
    });
  }
  stop(id: string, force = false) {
    const e = this.entries.get(id);
    if (!e || (e.busy && !force) || e.stopping) return false;
    e.stopping = true;
    e.child.kill('SIGTERM');
    return true;
  }
  evict() {
    for (const [id, e] of this.entries)
      if (!e.busy && Date.now() - e.lastUsed > this.config.idleWorkerMs) this.stop(id);
    for (const [id, until] of this.seen) if (until < Date.now()) this.seen.delete(id);
  }
  failure(id: string, code: string) {
    if (this.failures.size >= 500) this.failures.delete(this.failures.keys().next().value!);
    this.failures.set(id, { code, at: new Date().toISOString() });
  }
  health(id: string) {
    const e = this.entries.get(id);
    return {
      warm: Boolean(e),
      ready: e?.readyDone ?? false,
      last_runtime_error: this.failures.get(id) ?? null,
    };
  }
  async flushActivity() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (const jobs of [this.purchases, this.activity])
        for (const [id, event] of [...jobs]) {
          const shop = this.entries.get(id)?.shop ?? (await this.registry.get(id));
          await this.registry.mutate('activity', id, shop.owner_id, {
            trusted_super: true,
            kind: jobs === this.purchases ? 'purchase' : 'customer',
            event,
          });
          if (jobs.get(id) === event) jobs.delete(id);
        }
    } finally {
      this.flushing = false;
    }
  }
  async close() {
    this.stopping = true;
    clearInterval(this.timer);
    for (const job of this.waiting.splice(0)) {
      clearTimeout(job.timer);
      job.reject(new PlatformError(503, 'HOST_RESTARTING'));
    }
    await this.flushActivity().catch(() => {});
    for (const id of this.entries.keys()) this.stop(id, true);
  }
}
