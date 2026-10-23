// Real compiled controller routing and child processes. All external services are mocked.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WorkerPool } from '../../dist/src/platform/pool.js';
import { makePlatformServer } from '../../dist/src/platform/server.js';
import { tenantWebhookSecret } from '../../dist/src/tenants/security.js';

const root = new URL('../../', import.meta.url),
  started = performance.now();
const deadline = setTimeout(() => {
  console.error('Capacity benchmark exceeded its deadline');
  process.exit(1);
}, 85000);
const shops = Array.from({ length: 20 }, (_, i) => ({
  id: 's_' + (i + 1).toString(16).padStart(24, '0'),
  owner_id: 1000 + i,
  owner_lang: 'en',
  bot_id: 3000 + i,
  bot_username: 'capacity_fixture_' + i,
  plan: 'free',
  paid_until: null,
  status: 'active',
  idle_strikes: 0,
  last_active_at: new Date().toISOString(),
}));
const config = {
  maxWorkers: 1,
  maxShops: 20,
  maxOwnerShops: 1,
  heapMb: 128,
  idleWorkerMs: 180000,
  queueLimit: 32,
  queueWaitMs: 15000,
  owners: [999],
  publicUrl: 'https://platform.example',
  nssUsername: 'nss_fixture_bot',
  inactivityHours: 72,
};
let registryReads = 0,
  peakProcesses = 0,
  peakQueue = 0,
  peakControllerRss = 0,
  peakCombinedRss = 0,
  incomingRequests = 0,
  incomingBodyBytes = 0,
  responseBodyBytes = 0;
const records = [],
  cold = [],
  warm = [],
  burst = [];
const credentials = (s) => ({
  botToken: String(s.bot_id) + ':OFFLINE_FIXTURE_TOKEN_NOT_REAL_123456789',
  databaseUrl: 'https://offlinefixture' + s.bot_id + '.supabase.co',
  databaseKey: 'OFFLINE_FIXTURE_DATABASE_KEY_NOT_REAL',
  sourceUrl: 'https://nss.example/gateway',
  sourceKey: 'OFFLINE_FIXTURE_SOURCE_KEY_NOT_REAL',
});
const registry = {
  config,
  get: async (id) => {
    registryReads++;
    const s = shops.find((s) => s.id === id);
    if (!s) throw Error('Unknown fixture store');
    return s;
  },
  secrets: credentials,
  mutate: async (_action, id) => shops.find((s) => s.id === id),
};
const pool = new WorkerPool(registry, config, (shop) => {
  const s = credentials(shop),
    record = { shop: shop.id, metrics: null };
  const child = fork(fileURLToPath(new URL('dist/src/tenant-worker.js', root)), [], {
    cwd: fileURLToPath(root),
    execArgv: [
      '--max-old-space-size=128',
      '--import',
      fileURLToPath(new URL('tests/fixtures/offline-worker.mjs', root)),
    ],
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      LOG_LEVEL: 'error',
      IS_TENANT: 'true',
      WWC_MANAGED: '1',
      TENANT_ID: shop.id,
      TENANT_PLAN: 'free',
      BOT_TOKEN: s.botToken,
      BOT_USERNAME: shop.bot_username,
      ADMIN_USER_ID: String(shop.owner_id),
      SUPABASE_URL: s.databaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: s.databaseKey,
      BOT_MODE: 'webhook',
      PUBLIC_BASE_URL: config.publicUrl,
      TENANT_API_BASE_PATH: '/shop/' + shop.id,
      TENANT_SOURCE_URL: s.sourceUrl,
      TENANT_SOURCE_KEY: s.sourceKey,
      CAPACITY_FIXTURE_PRODUCTS: '50',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  record.child = child;
  record.pid = child.pid;
  record.exit = new Promise((resolve) => child.once('exit', resolve));
  records.push(record);
  let logs = '';
  child.stdout.on('data', (b) => {
    logs += b;
    record.logs = logs;
  });
  child.stderr.on('data', (b) => {
    logs += b;
    record.logs = logs;
  });
  child.on('message', (m) => {
    if (m?.fixtureMetrics) record.metrics = m.fixtureMetrics;
  });
  child.on('exit', (code) => {
    if (code && logs) console.error(logs.slice(-1500));
  });
  return child;
});
const app = makePlatformServer(registry, pool);
const linuxRss = (pid) => {
  try {
    return (
      Number(/^VmRSS:\s+(\d+)/m.exec(readFileSync('/proc/' + pid + '/status', 'utf8'))?.[1] ?? 0) *
      1024
    );
  } catch {
    return 0;
  }
};
function sample() {
  const controller = process.memoryUsage().rss;
  peakControllerRss = Math.max(peakControllerRss, controller);
  const workers = [...pool.entries.values()];
  peakProcesses = Math.max(peakProcesses, workers.length);
  peakQueue = Math.max(peakQueue, pool.queuedRequests);
  peakCombinedRss = Math.max(
    peakCombinedRss,
    controller + workers.reduce((sum, e) => sum + linuxRss(e.child.pid), 0),
  );
}
const sampler = setInterval(sample, 20);
let base;
async function send(shop, updateId, action = '/start') {
  const user = {
      id: shop.owner_id,
      is_bot: false,
      first_name: 'Capacity fixture',
      language_code: 'en',
    },
    chat = { id: shop.owner_id, type: 'private' };
  const update = action.startsWith('/')
    ? {
        update_id: updateId,
        message: {
          message_id: updateId,
          date: 1,
          chat,
          from: user,
          text: action,
          entities: [{ type: 'bot_command', offset: 0, length: action.length }],
        },
      }
    : {
        update_id: updateId,
        callback_query: {
          id: 'capacity-' + updateId,
          from: user,
          chat_instance: 'fixture',
          data: action,
          message: { message_id: updateId, date: 1, chat, text: 'Products' },
        },
      };
  const body = JSON.stringify(update);
  incomingRequests++;
  incomingBodyBytes += Buffer.byteLength(body);
  sample();
  const began = performance.now();
  const res = await fetch(base + '/webhook/tenant/' + shop.id, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': tenantWebhookSecret(credentials(shop).botToken),
    },
    body,
  });
  const text = await res.text();
  responseBodyBytes += Buffer.byteLength(text);
  assert.equal(
    res.status,
    200,
    text + ' ' + (records.findLast((r) => r.shop === shop.id)?.logs ?? ''),
  );
  sample();
  return {
    latency_ms: performance.now() - began,
    metrics: records.findLast((r) => r.shop === shop.id)?.metrics,
  };
}
function delta(after, before) {
  return Object.fromEntries(
    ['requests', 'requestBodyBytes', 'responseBodyBytes'].map((key) => [
      key,
      after[key] - before[key],
    ]),
  );
}
function distribution(items) {
  const a = [...items].sort((x, y) => x - y);
  return {
    min: a[0],
    median: a[Math.floor(a.length / 2)],
    p95: a[Math.min(a.length - 1, Math.ceil(a.length * 0.95) - 1)],
    max: a.at(-1),
  };
}
try {
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + app.server.address().port;
  for (const [i, shop] of shops.entries()) {
    const first = await send(shop, 1);
    cold.push({ shop: shop.id, latency_ms: first.latency_ms, ...first.metrics });
    const prime = await send(shop, 2, 'shop:home');
    assert.ok(prime.metrics.productScreens > 0, 'Fixture must actually render products');
    let previous = prime.metrics;
    for (let j = 0; j < 5; j++) {
      const next = await send(shop, 3 + j, 'shop:home');
      warm.push({ latency_ms: next.latency_ms, ...delta(next.metrics, previous) });
      previous = next.metrics;
    }
  }
  const began = performance.now();
  const burstResults = await Promise.all(shops.map((s) => send(s, 100)));
  burst.push(...burstResults.map((x) => x.latency_ms));
  const burstWall = performance.now() - began;
  const requests = records.reduce((sum, r) => sum + (r.metrics?.requests ?? 0), 0),
    sent = records.reduce((sum, r) => sum + (r.metrics?.requestBodyBytes ?? 0), 0),
    received = records.reduce((sum, r) => sum + (r.metrics?.responseBodyBytes ?? 0), 0);
  assert.equal(peakProcesses, 1);
  assert.equal(burstResults.length, 20);
  assert.equal(pool.queuedRequests, 0);
  const result = {
    date_utc: new Date().toISOString(),
    offline: true,
    live_services_tested: false,
    shops: 20,
    products_per_shop: 50,
    max_warm_workers: 1,
    worker_heap_limit_mb: 128,
    queue_limit: 32,
    queue_wait_seconds: 15,
    launched_processes: records.length,
    peak_live_workers: peakProcesses,
    peak_queued_requests: peakQueue,
    controller_peak_rss_bytes: peakControllerRss,
    controller_plus_worker_peak_rss_bytes: peakCombinedRss,
    worker_peak_rss_bytes: Math.max(...records.map((r) => r.metrics?.rss ?? 0)),
    worker_peak_heap_bytes: Math.max(...records.map((r) => r.metrics?.heap ?? 0)),
    inbound_http_requests: incomingRequests,
    inbound_json_bytes: incomingBodyBytes,
    http_response_json_bytes: responseBodyBytes,
    worker_outbound_http_requests: requests,
    worker_outbound_json_bytes: sent,
    worker_inbound_json_bytes: received,
    controller_registry_reads_mocked: registryReads,
    cold_start_request_count: distribution(cold.map((r) => r.requests)),
    cold_start_latency_ms: distribution(cold.map((r) => r.latency_ms)),
    warm_action_request_count: distribution(warm.map((r) => r.requests)),
    warm_action_outbound_json_bytes: distribution(warm.map((r) => r.requestBodyBytes)),
    warm_action_inbound_json_bytes: distribution(warm.map((r) => r.responseBodyBytes)),
    warm_action_latency_ms: distribution(warm.map((r) => r.latency_ms)),
    twenty_simultaneous_updates: {
      successes: 20,
      capacity_retries: 0,
      wall_ms: burstWall,
      latency_ms: distribution(burst),
    },
    duration_ms: performance.now() - started,
    limitations: [
      'External Telegram/Supabase responses are synthetic, without production network latency.',
      'Controller registry is mocked; its database requests are excluded from worker HTTP totals.',
      'Request/response sizes count JSON bodies only; TLS, headers, file transfers and catalog source sync are excluded.',
      'This is browsing with 50 products, not real checkout/payment or 24-hour production load.',
    ],
  };
  await mkdir(new URL('verification/', root), { recursive: true });
  await writeFile(
    new URL('verification/platform-20-store-benchmark.json', root),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result));
} finally {
  clearInterval(sampler);
  await pool.close();
  await Promise.all(records.map((r) => r.exit));
  await new Promise((resolve) => app.server.close(resolve));
  clearTimeout(deadline);
}
