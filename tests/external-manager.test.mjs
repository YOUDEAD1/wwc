import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Registry } from '../src/platform/repository.ts';
import { makePlatformServer } from '../src/platform/server.ts';
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('External manager username uses shared subscription settings without its token', async () => {
  let reads = 0;
  globalThis.fetch = async () => {
    reads++;
    return new Response(
      JSON.stringify([
        { key: 'manager.plan.usd', value: '7.50' },
        { key: 'manager.plan.days', value: 45 },
      ]),
      { headers: { 'content-type': 'application/json' } },
    );
  };
  const config = {
    databaseUrl: 'https://fixture.supabase.co',
    databaseKey: 'OFFLINE_KEY_NOT_REAL',
    owners: [9001],
    encryptionKey: randomBytes(32),
    managerToken: '',
    managerUsername: 'fixture_manager_bot',
    nssUsername: 'fixture_nss_bot',
    walletPriceUsd: '5.00',
    days: 30,
    stars: 500,
    maxShops: 20,
  };
  const app = makePlatformServer(new Registry(config), { entries: new Map() });
  try {
    const result = await app.execute('config', 1001);
    assert.equal(result.body.wallet_price_usd, '7.50');
    assert.equal(result.body.days, 45);
    assert.equal(reads, 1);
    await app.execute('config', 1001);
    assert.equal(reads, 1, 'Repeated requests reuse the content cache');
  } finally {
    app.server.close();
  }
});

test('Worker dotenv override keeps host file secrets out of a child environment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wwc-dotenv-'));
  const dotenv = fileURLToPath(new URL('../node_modules/dotenv/config.js', import.meta.url));
  try {
    await writeFile(
      join(directory, '.env'),
      'MONGO_URI=HOST_PRIVATE_FIXTURE\nWWC_MANAGER_TOKEN=HOST_TOKEN_FIXTURE\n',
    );
    const code = `await import(${JSON.stringify(dotenv)}); process.stdout.write(JSON.stringify({mongo: process.env.MONGO_URI ?? null, manager: process.env.WWC_MANAGER_TOKEN ?? null}));`;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--input-type=module', '-e', code],
      {
        cwd: directory,
        env: { PATH: process.env.PATH, DOTENV_CONFIG_PATH: join(directory, 'tenant.env.disabled') },
      },
    );
    assert.deepEqual(JSON.parse(stdout), { mongo: null, manager: null });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
