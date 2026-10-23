import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { platformConfig } from './config.js';
import { Registry, database, type Shop, type Credentials } from './repository.js';
import { WorkerPool } from './pool.js';
import { PlatformError, verifySignature, seal, fingerprint, safeSupabaseUrl } from './security.js';
import { telegram } from './telegram.js';
import { notices } from './notices.js';
import { walletPrice } from './pricing.js';
import { ManagerContent } from './manager/content.js';
import { StoreManager } from './manager/bot.js';
import { tenantWebhookSecret, validWebhookSecret } from '../tenants/security.js';
export async function readBody(req: IncomingMessage, max = 262144) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const c of req) {
    length += c.length;
    if (length > max) throw new PlatformError(413, 'REQUEST_TOO_LARGE');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
export function reply(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(status === 503 ? { 'retry-after': '5' } : {}),
  });
  res.end(JSON.stringify(value));
}
export function makePlatformServer(registry: Registry, pool: WorkerPool) {
  const config = registry.config,
    shops = new Map<string, { value: Shop; until: number }>(),
    statsCache = new Map<string, { value: any; until: number }>(),
    statsTasks = new Map<string, Promise<any>>(),
    shopTasks = new Map<string, Promise<Shop>>(),
    limits = new Map<string, { count: number; until: number }>();
  const managerContent = new ManagerContent(registry);
  const noticeCache = new Map<string, { until: number; rows: Map<string, unknown> }>();
  async function shopNotices(shop: Shop) {
    let cached = noticeCache.get(shop.id);
    if (!cached || cached.until < Date.now()) {
      const keys = Object.keys(notices('en')).flatMap((key) => [
        'text.' + shop.owner_lang + '.notice.' + key,
        'text.notice.' + key,
      ]);
      for (const key of ['dashboard', 'subscribe'])
        keys.push('btnicon.copy.notice.' + key, 'color.copy.notice.' + key);
      const credentials = registry.secrets(shop);
      const rows = new Map<string, unknown>();
      try {
        const result = await database(credentials.databaseUrl, credentials.databaseKey)
          .from('settings')
          .select('key,value')
          .in('key', keys);
        if (!result.error) for (const row of result.data ?? []) rows.set(row.key, row.value);
      } catch {
        /* A failed optional copy lookup must not fail activation. */
      }
      cached = { until: Date.now() + 60000, rows };
      if (noticeCache.size >= 500) noticeCache.delete(noticeCache.keys().next().value!);
      noticeCache.set(shop.id, cached);
    }
    const text = notices(shop.owner_lang, (key, lang) => {
      const value = cached!.rows.get('text.' + lang + '.' + key);
      return typeof value === 'string' ? value : undefined;
    });
    return {
      ...text,
      button: (key: 'dashboard' | 'subscribe', url: string) => {
        const icon = cached!.rows.get('btnicon.copy.notice.' + key) as
          | { unicode?: string; custom_emoji_id?: string }
          | undefined;
        const color = cached!.rows.get('color.copy.notice.' + key);
        const style = ({ green: 'success', blue: 'primary', red: 'danger' } as const)[
          color as 'green' | 'blue' | 'red'
        ];
        const id = icon?.custom_emoji_id;
        return {
          text: text[key],
          url,
          ...(id && /^\d{5,25}$/.test(id) ? { icon_custom_emoji_id: id } : {}),
          ...(style ? { style } : {}),
        };
      },
    };
  }
  const invalidate = (id: string) => {
    shops.delete(id);
    statsCache.delete(id);
    noticeCache.delete(id);
  };
  async function getShop(id: string) {
    const c = shops.get(id);
    if (c && c.until > Date.now()) return c.value;
    let task = shopTasks.get(id);
    if (!task) {
      task = registry
        .get(id)
        .then((value) => {
          if (shops.size > config.maxShops + 50) shops.delete(shops.keys().next().value!);
          shops.set(id, { value, until: Date.now() + 60000 });
          return value;
        })
        .finally(() => shopTasks.delete(id));
      shopTasks.set(id, task);
    }
    return task;
  }
  async function stats(shop: Shop) {
    const cached = statsCache.get(shop.id);
    if (cached && cached.until > Date.now()) return cached.value;
    if (statsTasks.has(shop.id)) return statsTasks.get(shop.id)!;
    const task = (async () => {
      const s = registry.secrets(shop),
        db = database(s.databaseUrl, s.databaseKey);
      const { data, error } = await db.rpc('shop_platform_statistics');
      if (error) throw new PlatformError(503, 'SHOP_DATABASE_UNAVAILABLE');
      const webhook = await telegram<any>(s.botToken, 'getWebhookInfo');
      const value = {
        ...data,
        ...pool.health(shop.id),
        working:
          shop.status === 'active' &&
          !pool.failures.has(shop.id) &&
          webhook.url === `${config.publicUrl}/webhook/tenant/${shop.id}`,
        pending_updates: webhook.pending_update_count ?? 0,
        telegram_last_error_at: webhook.last_error_date ?? null,
        measured_at: new Date().toISOString(),
      };
      if (statsCache.size > 500) statsCache.delete(statsCache.keys().next().value!);
      statsCache.set(shop.id, { value, until: Date.now() + 60000 });
      return value;
    })().finally(() => statsTasks.delete(shop.id));
    statsTasks.set(shop.id, task);
    return task;
  }
  async function activate(shop: Shop) {
    if (['locked', 'suspended'].includes(shop.status))
      throw new PlatformError(403, 'OWNER_UNLOCK_REQUIRED');
    const s = registry.secrets(shop),
      db = database(s.databaseUrl, s.databaseKey);
    const a = await db.rpc('runtime_revisions'),
      b = await db.rpc('shop_platform_statistics');
    if (a.error || b.error) throw new PlatformError(409, 'RUN_STORE_SQL_FIRST');
    try {
      await telegram(s.botToken, 'getChat', { chat_id: shop.owner_id });
    } catch {
      throw new PlatformError(409, 'OPEN_YOUR_BOT_AND_SEND_START_FIRST');
    }
    await telegram(s.botToken, 'setWebhook', {
      url: `${config.publicUrl}/webhook/tenant/${shop.id}`,
      secret_token: tenantWebhookSecret(s.botToken),
      drop_pending_updates: false,
      max_connections: 1,
      allowed_updates: ['message', 'callback_query', 'chat_member', 'pre_checkout_query'],
    });
    const changed = await registry.mutate('activate', shop.id, shop.owner_id, {
      max_active_shops: config.maxShops,
    });
    invalidate(shop.id);
    const t = await shopNotices(shop);
    await telegram(s.botToken, 'sendMessage', {
      chat_id: shop.owner_id,
      text: t.activated,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            t.button(
              'dashboard',
              `https://t.me/${config.managerUsername || config.nssUsername}?start=wwc_${shop.id}`,
            ),
          ],
          [
            t.button(
              'subscribe',
              `https://t.me/${config.managerUsername || config.nssUsername}?start=wwcsub_${shop.id}`,
            ),
          ],
        ],
      },
    }).catch(() => {});
    return changed;
  }
  let managerHandler: ((update: any) => Promise<void>) | undefined;
  function result(status: number, body: Record<string, any>) {
    return { status, body };
  }
  async function execute(
    action: string,
    actor: number,
    body: Record<string, any> = {},
    origin: 'bridge' | 'manager' = 'bridge',
  ) {
    if (!Number.isSafeInteger(actor) || actor <= 0) throw new PlatformError(400, 'INVALID_ACTOR');
    const admin = config.owners.includes(actor);
    if (
      origin === 'manager' &&
      ![
        'config',
        'list',
        'schema',
        'register',
        'info',
        'dashboard',
        'activate',
        'resume',
        'pause',
        'super_resume',
        'grant',
      ].includes(action)
    )
      throw new PlatformError(403, 'FORBIDDEN');
    if (action === 'config') {
      if (config.managerToken || config.managerUsername) await managerContent.load();
      const policy = managerContent.policy();
      return result(200, {
        ok: true,
        stars: config.stars,
        wallet_price_usd: policy.price,
        wallet_currency: 'USD',
        days: policy.days,
        max_shops: config.maxShops,
      });
    }
    if (action === 'list') {
      const offset = Math.max(0, Math.min(Number(body.offset) || 0, 100000)),
        all = await registry.list(body.all && admin ? undefined : actor, offset);
      return result(200, {
        ok: true,
        shops: all.map((s) => registry.view(s)),
        next_offset: all.length === 50 ? offset + 50 : null,
      });
    }
    if (action === 'schema') {
      let sql: string;
      try {
        sql = await readFile(
          fileURLToPath(new URL('../../../supabase/schema.sql', import.meta.url)),
          'utf8',
        );
      } catch {
        sql = await readFile(
          fileURLToPath(new URL('../../supabase/schema.sql', import.meta.url)),
          'utf8',
        );
      }
      return result(200, { ok: true, filename: 'WWC-STORE-SETUP.sql', sql });
    }
    if (action === 'register') {
      const token = String(body.bot_token ?? '').trim();
      if (!/^\d{6,15}:[A-Za-z0-9_-]{25,80}$/.test(token))
        throw new PlatformError(400, 'INVALID_BOT_TOKEN');
      const databaseUrl = safeSupabaseUrl(String(body.database_url ?? '')),
        databaseKey = String(body.database_key ?? '').trim();
      if (databaseUrl === new URL(config.databaseUrl).origin)
        throw new PlatformError(400, 'SEPARATE_STORE_DATABASE_REQUIRED');
      if (
        databaseKey.length < 30 ||
        databaseKey.length > 4096 ||
        !String(body.source_key ?? '').startsWith('sk_')
      )
        throw new PlatformError(400, 'INVALID_CREDENTIALS');
      const sourceUrl = new URL(String(body.source_url ?? ''));
      if (
        sourceUrl.origin !== config.nssOrigin ||
        sourceUrl.protocol !== 'https:' ||
        sourceUrl.username ||
        sourceUrl.password
      )
        throw new PlatformError(400, 'INVALID_NSS_SOURCE');
      const me = await telegram<{ id: number; username: string }>(token, 'getMe');
      if (!me.username) throw new PlatformError(400, 'BOT_USERNAME_MISSING');
      if (
        me.username.toLowerCase() === config.nssUsername.toLowerCase() ||
        token === config.managerToken
      )
        throw new PlatformError(400, 'PLATFORM_BOT_CANNOT_BE_A_STORE');
      const old = await registry.db
        .from('wwc_platform_shops')
        .select('*')
        .eq('bot_id', me.id)
        .maybeSingle();
      if (old.error) throw new PlatformError(503, 'REGISTRY_UNAVAILABLE');
      if (old.data && Number(old.data.owner_id) !== actor)
        throw new PlatformError(403, 'BOT_ALREADY_REGISTERED');
      if (body.replacement_id && old.data?.id !== body.replacement_id)
        throw new PlatformError(400, 'USE_THE_SAME_STORE_BOT');
      const id = old.data?.id ?? 's_' + randomUUID().replace(/-/g, '').slice(0, 24);
      const keys: Credentials = {
        botToken: token,
        databaseUrl,
        databaseKey,
        sourceUrl: sourceUrl.toString().replace(/\/$/, ''),
        sourceKey: body.source_key,
      };
      const payload = {
        bot_id: me.id,
        bot_username: me.username,
        owner_lang: ['en', 'ar', 'vi', 'zh'].includes(body.lang) ? body.lang : 'en',
        token_fingerprint: fingerprint(token),
        database_fingerprint: fingerprint(databaseUrl),
        secret_box: seal(keys, config.encryptionKey, id),
        max_owner_shops: config.maxOwnerShops,
      };
      if (old.data && pool.entries.get(id)?.busy)
        throw new PlatformError(409, 'WAIT_FOR_STORE_REQUESTS');
      if (old.data) pool.stop(id);
      const shop = await registry.mutate(old.data ? 'credentials' : 'register', id, actor, payload);
      invalidate(id);
      return result(old.data ? 200 : 201, { ok: true, shop: registry.view(shop) });
    }
    const id = String(body.shop_id ?? ''),
      shop = await registry.get(id);
    if (shop.owner_id !== actor && !admin) throw new PlatformError(403, 'FORBIDDEN');
    if (action === 'info') return result(200, { ok: true, shop: registry.view(shop) });
    if (action === 'dashboard') {
      let data;
      try {
        data = await stats(shop);
      } catch {
        data = { available: false, error: 'SHOP_DATABASE_UNAVAILABLE', working: false };
      }
      return result(200, { ok: true, shop: registry.view(shop), stats: data });
    }
    if (action === 'activate') {
      try {
        return result(200, { ok: true, shop: registry.view(await activate(shop)) });
      } catch (e) {
        if (!(e instanceof PlatformError) || e.code !== 'HOST_CAPACITY') throw e;
        const queued = await registry.mutate('queue', id, actor);
        invalidate(id);
        return result(202, { ok: true, queued: true, shop: registry.view(queued) });
      }
    }
    if (['resume', 'pause', 'super_resume'].includes(action)) {
      if (action === 'super_resume' && !admin) throw new PlatformError(403, 'FORBIDDEN');
      let changed = await registry.mutate(action, id, actor, {
        trusted_super: admin,
        max_active_shops: config.maxShops,
      });
      if (action !== 'pause') {
        try {
          changed = await activate(changed);
        } catch (e) {
          await registry.mutate('pause', id, actor, { trusted_super: admin });
          throw e;
        }
      } else pool.stop(id);
      invalidate(id);
      return result(200, { ok: true, shop: registry.view(changed) });
    }
    if (action === 'subscribe' || action === 'grant') {
      if (action === 'grant' && !admin) throw new PlatformError(403, 'FORBIDDEN');
      let walletReceipt = false;
      if (action === 'subscribe' && body.payment_method === 'nss_wallet') {
        try {
          walletReceipt =
            body.currency === 'USD' &&
            typeof body.amount === 'string' &&
            walletPrice(body.amount) !== null &&
            /^nss:[a-f0-9]{32}$/.test(String(body.receipt ?? ''));
        } catch {
          walletReceipt = false;
        }
        if (!walletReceipt) throw new PlatformError(400, 'INVALID_RECEIPT');
      }
      if (
        action === 'subscribe' &&
        ((!walletReceipt && (!Number.isInteger(body.stars) || body.stars < 1)) ||
          !Number.isInteger(body.days) ||
          body.days < 1 ||
          body.days > 365)
      )
        throw new PlatformError(400, 'INVALID_RECEIPT');
      if (!/^[A-Za-z0-9_:-]{8,200}$/.test(String(body.receipt ?? '')))
        throw new PlatformError(400, 'INVALID_RECEIPT');
      const changed = await registry.mutate('subscribe', id, actor, {
        trusted_super: action === 'grant' && admin,
        days: action === 'grant' ? config.days : body.days,
        receipt: body.receipt,
      });
      invalidate(id);
      pool.entries
        .get(id)
        ?.child.send({ type: 'platform_config', plan: 'paid', paidUntil: changed.paid_until });
      return result(200, { ok: true, shop: registry.view(changed) });
    }
    throw new PlatformError(404, 'NOT_FOUND');
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://platform');
      if (req.method === 'GET' && url.pathname === '/health')
        return reply(res, 200, {
          ok: true,
          warm_workers: pool.entries.size,
          worker_limit: config.maxWorkers,
          active_shop_limit: config.maxShops,
          queued_requests: pool.queuedRequests,
        });
      if (url.pathname === '/webhook/manager' && req.method === 'POST') {
        if (
          !managerHandler ||
          !config.managerToken ||
          !validWebhookSecret(
            String(req.headers['x-telegram-bot-api-secret-token'] ?? ''),
            config.managerToken,
          )
        )
          throw new PlatformError(403, 'FORBIDDEN');
        const update = JSON.parse((await readBody(req, 65536)).toString());
        if (!Number.isSafeInteger(update.update_id)) throw new PlatformError(400, 'INVALID_UPDATE');
        await managerHandler(update);
        return reply(res, 200, { ok: true });
      }
      const webhook = /^\/webhook\/tenant\/(s_[a-f0-9]{24})$/.exec(url.pathname);
      if (webhook && req.method === 'POST') {
        const shop = await getShop(webhook[1]!);
        if (
          !validWebhookSecret(
            String(req.headers['x-telegram-bot-api-secret-token'] ?? ''),
            registry.secrets(shop).botToken,
          )
        )
          throw new PlatformError(403, 'FORBIDDEN');
        if (shop.status !== 'active') return reply(res, 200, { ok: true, paused: true });
        const update = JSON.parse((await readBody(req)).toString());
        if (!Number.isSafeInteger(update.update_id)) throw new PlatformError(400, 'INVALID_UPDATE');
        await pool.update(shop, update);
        return reply(res, 200, { ok: true });
      }
      const shopApi = /^\/shop\/(s_[a-f0-9]{24})(\/[^\s]*)$/.exec(url.pathname);
      if (shopApi && ['GET', 'POST', 'OPTIONS'].includes(req.method ?? '')) {
        const ip = req.socket.remoteAddress ?? '',
          key = ip + ':' + shopApi[1];
        let c = limits.get(key);
        if (!c || c.until < Date.now()) {
          c = { count: 0, until: Date.now() + 60000 };
          limits.set(key, c);
        }
        if (++c.count > 120) throw new PlatformError(429, 'RATE_LIMITED');
        if (limits.size > 5000) limits.delete(limits.keys().next().value!);
        const shop = await getShop(shopApi[1]!);
        if (shop.status !== 'active') throw new PlatformError(403, 'STORE_PAUSED');
        const result = await pool.http(
          shop,
          req.method!,
          shopApi[2]! + url.search,
          {
            authorization: req.headers.authorization,
            'x-api-key': req.headers['x-api-key'],
            'content-type': req.headers['content-type'],
            'if-none-match': req.headers['if-none-match'],
            host: 'platform',
          },
          await readBody(req, 65536),
          ip,
        );
        res.writeHead(result.status, result.headers);
        res.end(result.body);
        return;
      }
      if (req.method !== 'POST' || !url.pathname.startsWith('/platform/v1/') || url.search)
        throw new PlatformError(404, 'NOT_FOUND');
      const bytes = await readBody(req),
        time = String(req.headers['x-wwc-time'] ?? ''),
        nonce = String(req.headers['x-wwc-nonce'] ?? '');
      if (
        !verifySignature(
          config.sharedSecret,
          'POST',
          url.pathname,
          time,
          nonce,
          bytes,
          String(req.headers['x-wwc-signature'] ?? ''),
        )
      )
        throw new PlatformError(401, 'INVALID_SIGNATURE');
      if (!(await registry.rpc('wwc_platform_nonce', { p_nonce: nonce })))
        throw new PlatformError(409, 'REPLAY_REJECTED');
      const body = JSON.parse(bytes.toString()) as Record<string, any>;
      const answer = await execute(
        url.pathname.slice('/platform/v1/'.length),
        Number(body.actor_id),
        body,
      );
      return reply(res, answer.status, answer.body);
    } catch (e) {
      if (e instanceof PlatformError) return reply(res, e.status, { ok: false, error: e.code });
      reply(res, e instanceof SyntaxError ? 400 : 503, {
        ok: false,
        error: e instanceof SyntaxError ? 'INVALID_JSON' : 'SERVICE_UNAVAILABLE',
      });
    }
  });
  server.maxConnections = 64;
  server.requestTimeout = 75000;
  server.headersTimeout = 10000;
  async function drainActivationQueue() {
    const count = await registry.db
      .from('wwc_platform_shops')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active');
    if (count.error || (count.count ?? config.maxShops) >= config.maxShops) return;
    const jobs = await registry.db
      .from('wwc_platform_shops')
      .select('*')
      .not('activation_requested_at', 'is', null)
      .in('status', ['setup', 'idle'])
      .order('activation_requested_at')
      .limit(config.maxShops - (count.count ?? 0));
    if (jobs.error) return;
    for (const job of jobs.data ?? [])
      try {
        await activate(job as Shop);
      } catch (e) {
        if (e instanceof PlatformError && e.code === 'HOST_CAPACITY') break;
        await registry.mutate('unqueue', job.id, Number(job.owner_id));
      }
  }
  return {
    server,
    stats,
    invalidate,
    drainActivationQueue,
    shopNotices,
    execute,
    managerContent,
    attachManager: (handler: (update: any) => Promise<void>) => {
      managerHandler = handler;
    },
  };
}
export async function runMaintenance(
  registry: Registry,
  pool: WorkerPool,
  app: ReturnType<typeof makePlatformServer>,
  notify: typeof telegram = telegram,
) {
  const config = registry.config;
  await pool.flushActivity().catch(() => {});
  for (const shop of await registry.active()) {
    try {
      const age = Date.now() - Date.parse(shop.last_active_at);
      if (age < (config.inactivityHours - 24) * 3600000) continue;
      const keys = registry.secrets(shop),
        t = await app.shopNotices(shop);
      if (age >= config.inactivityHours * 3600000) {
        const stats = await app.stats(shop);
        if (
          stats.last_purchase_at &&
          Date.parse(stats.last_purchase_at) > Date.parse(shop.last_purchase_at ?? '1970-01-01')
        ) {
          await registry.mutate('activity', shop.id, shop.owner_id, {
            trusted_super: true,
            kind: 'purchase',
            event: `${shop.id}:recovered:${stats.last_purchase_at}`,
          });
          continue;
        }
        const changed = await registry.mutate('idle', shop.id, shop.owner_id, {
          trusted_super: true,
          hours: config.inactivityHours,
        });
        app.invalidate(shop.id);
        pool.stop(shop.id);
        if (changed.status !== 'active')
          await notify(keys.botToken, 'sendMessage', {
            chat_id: shop.owner_id,
            text: t.paused
              .replace('{hours}', String(config.inactivityHours))
              .replace('{strikes}', String(changed.idle_strikes)),
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  t.button(
                    'dashboard',
                    `https://t.me/${config.managerUsername || config.nssUsername}?start=wwc_${shop.id}`,
                  ),
                ],
              ],
            },
          }).catch(() => {});
      } else if (!shop.warned_at) {
        await registry.mutate('warn', shop.id, shop.owner_id, { trusted_super: true });
        await notify(keys.botToken, 'sendMessage', {
          chat_id: shop.owner_id,
          text: t.warning,
          parse_mode: 'HTML',
        }).catch(() => {});
      }
    } catch {
      console.warn('WWC maintenance deferred for one store.');
    }
  }
  await app.drainActivationQueue();
  if (config.managerToken) await registry.rpc('wwc_manager_cleanup', {});
}
export async function main() {
  const config = platformConfig(),
    registry = new Registry(config),
    owner = randomUUID();
  if (!(await registry.rpc('wwc_platform_lease_claim', { p_owner: owner })))
    throw Error('Another controller holds the platform lease');
  const pool = new WorkerPool(registry, config),
    app = makePlatformServer(registry, pool);
  if (config.managerToken) {
    try {
      const manager = new StoreManager(registry, pool, app.execute, app.managerContent);
      await manager.initialize();
      app.attachManager((update) => manager.handle(update));
    } catch (e) {
      await pool.close();
      await registry
        .rpc('wwc_platform_lease_claim', { p_owner: owner, p_release: true })
        .catch(() => {});
      throw e;
    }
  }
  let busy = false,
    closing = false;
  const lease = setInterval(() => {
    void registry
      .rpc('wwc_platform_lease_claim', { p_owner: owner })
      .then((ok) => {
        if (!ok) return shutdown();
      })
      .catch(() => shutdown());
  }, 30000);
  const flush = setInterval(() => {
    void pool.flushActivity().catch(() => {});
  }, 60000);
  const maintenance = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await runMaintenance(registry, pool, app);
    } catch {
      console.warn('WWC maintenance deferred; database response unavailable.');
    } finally {
      busy = false;
    }
  }, 300000);
  async function shutdown() {
    if (closing) return;
    closing = true;
    clearInterval(lease);
    clearInterval(flush);
    clearInterval(maintenance);
    app.server.close();
    await pool.close();
    await registry
      .rpc('wwc_platform_lease_claim', { p_owner: owner, p_release: true })
      .catch(() => {});
    process.exitCode = 0;
  }
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  app.server.listen(config.port, '0.0.0.0', () =>
    console.info(`WWC ready; warm worker limit ${config.maxWorkers}`),
  );
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch(() => {
    console.error('WWC startup failed. Check platform environment, SQL and singleton deployment.');
    process.exitCode = 1;
  });
