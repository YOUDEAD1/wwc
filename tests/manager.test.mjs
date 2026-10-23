import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Bot } from 'grammy';
import { Registry } from '../src/platform/repository.ts';
import { PlatformError, unseal, verifySignature } from '../src/platform/security.ts';
import { StoreManager } from '../src/platform/manager/bot.ts';
import {
  ManagerContent,
  catalog,
  validateCopy,
  placeholders,
  languages,
} from '../src/platform/manager/content.ts';
import { ManagerProfiles } from '../src/platform/manager/profiles.ts';
import { NssBridge } from '../src/platform/manager/nss.ts';
import { entitiesToHtml } from '../src/platform/manager/format.ts';
import { makePlatformServer } from '../src/platform/server.ts';
import { tenantWebhookSecret } from '../src/tenants/security.ts';
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const config = {
  databaseUrl: 'https://managerfixture.supabase.co',
  databaseKey: 'FAKE_MANAGER_KEY_NOT_REAL_123456789',
  encryptionKey: randomBytes(32),
  managerToken: '123456789:OFFLINE_MANAGER_TOKEN_NOT_REAL_123456789',
  managerUsername: 'fixture_manager_bot',
  sharedSecret: 'fake-manager-secret-over-32-characters',
  owners: [9001],
  nssOrigin: 'https://nss.example',
  nssUsername: 'nss_fixture_bot',
  publicUrl: 'https://platform.example',
  maxWorkers: 1,
  maxShops: 20,
  days: 30,
  walletPriceUsd: '5.00',
  stars: 500,
};
const SHOP = 's_' + 'a'.repeat(24),
  shop = {
    id: SHOP,
    owner_id: 1001,
    bot_username: 'child_fixture_bot',
    bot_url: 'https://t.me/child_fixture_bot',
    status: 'active',
    plan: 'free',
    idle_strikes: 0,
  };
function fixture() {
  const settings = new Map(),
    profiles = new Map(),
    requests = [],
    api = [],
    calls = [],
    nssCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(String(input));
    if (u.hostname !== 'managerfixture.supabase.co') return realFetch(input, init);
    requests.push({ url: u.toString(), method: init.method });
    const table = u.pathname.split('/').at(-1),
      method = init.method ?? 'GET',
      body = init.body ? JSON.parse(init.body) : null;
    let data = null;
    if (table === 'settings') {
      if (method === 'POST') {
        for (const row of Array.isArray(body) ? body : [body]) settings.set(row.key, row.value);
        data = [];
      } else if (method === 'DELETE') {
        settings.delete(u.searchParams.get('key').slice(3));
        data = [];
      } else data = [...settings].map(([key, value]) => ({ key, value }));
    } else if (table === 'wwc_manager_users') {
      if (method === 'POST') {
        profiles.set(body.telegram_id, body);
        data = [];
      } else data = profiles.get(Number(u.searchParams.get('telegram_id')?.slice(3))) ?? null;
    } else if (table === 'wwc_manager_overview')
      data = { total: 20, active: 20, free: 19, paid: 1, other: 0 };
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  };
  const registry = new Registry(config),
    pool = { entries: new Map(), queuedRequests: 0 };
  const bot = new Bot(config.managerToken, {
    botInfo: {
      id: 123456789,
      is_bot: true,
      first_name: 'Manager',
      username: config.managerUsername,
    },
  });
  bot.api.config.use(async (_prev, method, payload) => {
    api.push({ method, payload });
    return {
      ok: true,
      result:
        method === 'sendMessage' || method === 'editMessageText'
          ? {
              message_id: api.length,
              date: 1,
              chat: { id: payload.chat_id, type: 'private' },
              text: payload.text,
            }
          : true,
    };
  });
  const execute = async (action, actor, body, origin) => {
    calls.push({ action, actor, body, origin });
    if (
      ['info', 'dashboard', 'activate', 'pause', 'resume', 'grant', 'super_resume'].includes(
        action,
      ) &&
      actor !== 1001 &&
      actor !== 9001
    )
      throw new PlatformError(403, 'FORBIDDEN');
    if (['grant', 'super_resume'].includes(action) && actor !== 9001)
      throw new PlatformError(403, 'FORBIDDEN');
    return {
      status: 200,
      body:
        action === 'schema'
          ? { sql: '-- fixture SQL' }
          : action === 'list'
            ? { shops: [shop], next_offset: null }
            : action === 'config'
              ? { wallet_price_usd: '5.00', days: 30 }
              : {
                  shop,
                  stats: {
                    users: 4,
                    orders: 2,
                    revenue: 12,
                    known_supplier_profit: 3,
                    working: true,
                    warm: true,
                  },
                },
    };
  };
  const q = {
    token: 'c'.repeat(32),
    shop_id: SHOP,
    bot_username: shop.bot_username,
    state: 'wallet_quote',
    amount: '5.00',
    days: 30,
    balance: '100.00',
    expires_at: '2099-01-01',
    expired: false,
  };
  const nss = {
    call: async (action, actor, data) => {
      nssCalls.push({ action, actor, data });
      return action === 'source'
        ? { source_url: 'https://nss.example/gateway', source_key: 'sk_fixture' }
        : {
            ok: true,
            balance: '100.00',
            checkout:
              action === 'wallet_confirm'
                ? { ...q, state: 'applied', balance_after: '95.00', reference: 'NSS-' + q.token }
                : q,
          };
    },
  };
  const content = new ManagerContent(registry),
    manager = new StoreManager(registry, pool, execute, content, { bot, nss });
  let id = 1;
  async function send(text, uid = 1001, entities) {
    return manager.handle({
      update_id: id++,
      message: {
        message_id: id,
        date: 1,
        from: { id: uid, is_bot: false, first_name: '<Fixture>', language_code: 'en' },
        chat: { id: uid, type: 'private' },
        text,
        ...(entities ? { entities } : {}),
      },
    });
  }
  async function click(data, uid = 1001) {
    return manager.handle({
      update_id: id++,
      callback_query: {
        id: String(id),
        from: { id: uid, is_bot: false, first_name: 'Fixture' },
        chat_instance: 'fixture',
        data,
        message: { message_id: id, date: 1, chat: { id: uid, type: 'private' }, text: 'previous' },
      },
    });
  }
  const shown = () =>
    api.filter((c) => ['sendMessage', 'editMessageText'].includes(c.method)).at(-1)?.payload;
  const choose = async (uid = 1001, lang = 'en') => {
    await send('/start', uid);
    await click('m:lang:' + lang, uid);
  };
  return {
    manager,
    content,
    registry,
    pool,
    settings,
    profiles,
    requests,
    api,
    calls,
    nssCalls,
    q,
    send,
    click,
    shown,
    choose,
  };
}
test('Every manager locale preserves fields; default text and callbacks fit Telegram limits', () => {
  for (const e of catalog)
    for (const l of languages) {
      validateCopy(e.key, e.values[l]);
      assert.deepEqual(placeholders(e.values[l]), placeholders(e.values.en), e.key + ' ' + l);
      if (e.button) assert.ok(e.values[l].length <= 64);
      assert.ok(Buffer.byteLength('m:setcolor:' + l + ':' + e.key + ':green') <= 64);
    }
});
test('Language is selected once, deep links survive selection and user HTML is escaped', async () => {
  const f = fixture();
  await f.send('/start wwc_' + SHOP);
  assert.match(f.shown().text, /Choose your language/);
  await f.click('m:lang:ar');
  assert.match(f.shown().text, /لوحة المتجر/);
  await f.send('/start');
  assert.match(f.shown().text, /&lt;Fixture&gt;/);
  assert.doesNotMatch(f.shown().text, /اختر لغتك/);
  await f.send('/start');
  assert.match(f.shown().text, /متجرك/);
  assert.equal(f.profiles.get(1001).language, 'ar');
  assert.ok(!f.profiles.get(1001).draft_box);
});
test('Manager setup encrypts credentials, sends SQL before activation, rejects public keys', async () => {
  const f = fixture();
  await f.choose();
  await f.click('m:begin');
  await f.send('222222222:' + 'x'.repeat(35));
  const row = f.profiles.get(1001);
  assert.ok(!row.draft_box.includes('x'.repeat(35)));
  assert.equal(
    unseal(row.draft_box, config.encryptionKey, 'manager:1001').token,
    '222222222:' + 'x'.repeat(35),
  );
  await f.send('https://storefixture.supabase.co');
  await f.send('sb_publishable_' + 'x'.repeat(35));
  assert.match(f.shown().text, /invalid/);
  assert.ok(!f.calls.some((c) => c.action === 'register'));
  await f.send('sb_secret_' + 'x'.repeat(35));
  assert.ok(f.calls.some((c) => c.action === 'register' && c.body.source_key === 'sk_fixture'));
  assert.ok(f.api.some((c) => c.method === 'sendDocument'));
  assert.match(f.shown().text, /Run the attached/);
  assert.ok(!f.calls.some((c) => c.action === 'activate'));
  assert.equal(f.profiles.get(1001).draft_box, null);
  assert.equal(f.api.filter((c) => c.method === 'deleteMessage').length, 4);
  await f.click('m:act:' + SHOP);
  assert.ok(f.calls.some((c) => c.action === 'activate'));
  assert.match(f.shown().text, /activated/);
});
test('Owner checks block forged console, grants and other store dashboards', async () => {
  const f = fixture();
  await f.choose();
  for (const data of [
    'm:console',
    'm:entry:en:welcome',
    'm:policyedit:usd',
    'm:confirm:grant:' + SHOP,
    'm:confirm:super_resume:' + SHOP,
  ]) {
    await f.click(data);
    assert.match(f.shown().text, /permission/);
  }
  await f.choose(1002);
  await f.click('m:dash:' + SHOP, 1002);
  assert.match(f.shown().text, /permission/);
  assert.ok(!f.calls.some((c) => c.action === 'grant'));
});
test('Wallet checkout uses NSS quote and same token on confirm without client amount', async () => {
  const f = fixture();
  await f.choose();
  await f.click('m:sub:' + SHOP);
  assert.match(f.shown().text, /\$5.00/);
  assert.ok(!f.nssCalls.some((c) => c.action === 'wallet_confirm'));
  await f.click('m:pay:' + f.q.token);
  assert.match(f.shown().text, /Subscription updated/);
  assert.equal(f.nssCalls.at(-1).action, 'wallet_confirm');
  assert.deepEqual(f.nssCalls.at(-1).data, { token: f.q.token });
  assert.ok(!f.calls.some((c) => c.action === 'subscribe'));
});
test('Content console previews, saves a single locale, supports Premium icon, color and price', async () => {
  const f = fixture();
  await f.choose(9001, 'ar');
  await f.click('m:edit:en:welcome', 9001);
  await f.send('Welcome {name} — test', 9001, [{ type: 'bold', offset: 0, length: 7 }]);
  assert.ok(!f.settings.has('text.en.manager.welcome'));
  await f.click('m:save', 9001);
  assert.equal(f.settings.get('text.en.manager.welcome'), '<b>Welcome</b> {name} — test');
  assert.ok(!f.settings.has('text.ar.manager.welcome'));
  await f.click('m:emoji:en:create', 9001);
  await f.send('✨', 9001, [
    { type: 'custom_emoji', offset: 0, length: 1, custom_emoji_id: '5375338737028841420' },
  ]);
  await f.click('m:save', 9001);
  assert.equal(f.settings.get('btnicon.manager.create').custom_emoji_id, '5375338737028841420');
  await f.click('m:setcolor:en:create:green', 9001);
  await f.click('m:lang:en', 9001);
  const button = f.shown().reply_markup.inline_keyboard[0][0];
  assert.equal(button.icon_custom_emoji_id, '5375338737028841420');
  assert.equal(button.style, 'success');
  await f.click('m:policyedit:usd', 9001);
  await f.send('3.125', 9001);
  assert.ok(!f.settings.has('manager.plan.usd'));
  await f.click('m:save', 9001);
  assert.equal(f.content.policy().price, '3.125');
});
test('Placeholder errors preserve old copy and cached navigation avoids per-click reads/writes', async () => {
  const f = fixture();
  await f.choose(9001);
  await f.click('m:edit:en:welcome', 9001);
  await f.send('Missing required name', 9001);
  assert.match(f.shown().text, /invalid/);
  assert.ok(!f.settings.has('text.en.manager.welcome'));
  await f.click('m:home', 9001);
  const count = f.requests.length;
  await f.click('m:home', 9001);
  await f.click('m:guide', 9001);
  await f.click('m:settings', 9001);
  assert.equal(f.requests.length, count);
});
test('Confirmation is bound to a persisted action and repeated update does not repeat a grant', async () => {
  const f = fixture();
  await f.choose(9001);
  await f.click('m:confirm:grant:' + SHOP, 9001);
  assert.ok(!f.calls.some((c) => c.action === 'grant'));
  await f.click('m:do', 9001);
  await f.click('m:do', 9001);
  assert.equal(f.calls.filter((c) => c.action === 'grant').length, 1);
  const update = {
    update_id: 9000,
    message: {
      message_id: 9000,
      date: 1,
      from: { id: 9001, is_bot: false, first_name: 'Fixture' },
      chat: { id: 9001, type: 'private' },
      text: '/start',
    },
  };
  const before = f.api.length;
  await Promise.all([f.manager.handle(update), f.manager.handle(update)]);
  await f.manager.handle(update);
  assert.equal(f.api.length, before + 1);
});
test('Encrypted draft is user-bound and expired drafts cannot resume', async () => {
  const f = fixture();
  await f.choose();
  await f.click('m:begin');
  const row = f.profiles.get(1001);
  assert.throws(() => unseal(row.draft_box, config.encryptionKey, 'manager:1002'));
  assert.equal(f.manager.profiles.draft({ ...row, draft_expires_at: '2000-01-01' }), null);
});
test('Formatter preserves UTF-16 Premium entity offsets and rejects unsafe markup', () => {
  assert.equal(
    entitiesToHtml('🛍️ ✨ Hello', [
      { type: 'custom_emoji', offset: 4, length: 1, custom_emoji_id: '5375338737028841420' },
      { type: 'bold', offset: 6, length: 5 },
    ]),
    '🛍️ <tg-emoji emoji-id="5375338737028841420">✨</tg-emoji> <b>Hello</b>',
  );
  for (const bad of [
    '<script>{name}</script>',
    '<a href="javascript:alert(1)">{name}</a>',
    '<b>{name}</i>',
    '<b onclick="a">{name}</b>',
  ])
    assert.throws(() => validateCopy('welcome', bad));
});
test('NSS bridge client signs exact private path and body without redirects', async () => {
  const bridge = new NssBridge(config);
  globalThis.fetch = async (input, init) => {
    assert.equal(input, 'https://nss.example/wwc/manager/v1/wallet_confirm');
    assert.equal(init.redirect, 'error');
    const h = init.headers;
    assert.ok(
      verifySignature(
        config.sharedSecret,
        'POST',
        '/wwc/manager/v1/wallet_confirm',
        h['x-wwc-time'],
        h['x-wwc-nonce'],
        Buffer.from(init.body),
        h['x-wwc-signature'],
      ),
    );
    assert.deepEqual(JSON.parse(String(init.body)), { token: 'c'.repeat(32), actor_id: 1001 });
    return new Response('{"ok":true}');
  };
  await bridge.call('wallet_confirm', 1001, { token: 'c'.repeat(32) });
});
test('Manager webhook requires its own Telegram secret and direct subscribe remains forbidden', async () => {
  const f = fixture(),
    app = makePlatformServer(f.registry, f.pool);
  let count = 0;
  app.attachManager(async () => {
    count++;
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + app.server.address().port + '/webhook/manager';
  try {
    assert.equal((await realFetch(url, { method: 'POST', body: '{"update_id":1}' })).status, 403);
    assert.equal(count, 0);
    assert.equal(
      (
        await realFetch(url, {
          method: 'POST',
          body: '{"update_id":1}',
          headers: { 'x-telegram-bot-api-secret-token': tenantWebhookSecret(config.managerToken) },
        })
      ).status,
      200,
    );
    assert.equal(count, 1);
    await assert.rejects(app.execute('subscribe', 1001, {}, 'manager'), /FORBIDDEN/);
  } finally {
    await new Promise((r) => app.server.close(r));
  }
});

test('Back navigation clears an editor draft instead of treating the next message as an old edit', async () => {
  const f = fixture();
  await f.choose(9001);
  await f.click('m:edit:en:welcome', 9001);
  assert.equal(f.manager.profiles.draft(f.profiles.get(9001)).step, 'copy');
  await f.click('m:folder:0:0', 9001);
  assert.equal(f.profiles.get(9001).draft_box, null);
  await f.send('A message after Back', 9001);
  assert.ok(!f.settings.has('text.en.manager.welcome'));
  assert.match(f.shown().text, /Your store/);
});
test('An uncertain payment response keeps the same checkout reference and never confirms again automatically', async () => {
  const f = fixture();
  await f.choose();
  await f.click('m:sub:' + SHOP);
  const before = f.nssCalls.length;
  f.manager.nss.call = async () => {
    throw new Error('synthetic timeout');
  };
  await f.click('m:pay:' + f.q.token);
  assert.match(f.shown().text, /reconciled/);
  assert.ok(
    f
      .shown()
      .reply_markup.inline_keyboard.flat()
      .some((b) => b.callback_data === 'm:status:' + f.q.token),
  );
  assert.equal(f.nssCalls.length, before);
});
test('Manager config quotes use the existing settings price and duration, with explicit disable', async () => {
  const f = fixture();
  f.settings.set('manager.plan.usd', '3.125');
  f.settings.set('manager.plan.days', 45);
  const app = makePlatformServer(f.registry, f.pool);
  const result = (await app.execute('config', 1001, {}, 'manager')).body;
  assert.equal(result.wallet_price_usd, '3.125');
  assert.equal(result.days, 45);
  await app.managerContent.set('manager.plan.usd', '0');
  assert.equal((await app.execute('config', 1001, {}, 'manager')).body.wallet_price_usd, null);
});
