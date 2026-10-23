import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
process.env.TELEGRAM_BOT_TOKEN = '123456789:TEST_TOKEN_NOT_A_REAL_BOT';
process.env.BOT_USERNAME = 'wwc_test_bot';
process.env.ADMIN_USER_ID = '123';
process.env.SUPABASE_URL = 'https://database.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'TEST_SERVICE_KEY_NOT_REAL_123456789';
process.env.LOG_LEVEL = 'error';
const { Bot, Composer } = await import('grammy');
const cache = await import('../src/services/cache.ts');
const dbContext = await import('../src/db/db_context.ts');
const settings = await import('../src/services/settings.ts');
const { t } = await import('../src/i18n/index.ts');
const { LOCALES } = await import('../config/index.ts');
const { serial } = await import('../src/services/serial.ts');
const { fetchProducts, purchase, fetchMyPrices } = await import('../src/services/apiConnect.ts');
const { buildOrderDeliveredChunks } = await import('../src/services/orderRender.ts');
const { handleHealthRequest } = await import('../src/services/resellerApiHttp.ts');
const { inheritedTenantEnvironment, tenantWebhookSecret, validWebhookSecret } =
  await import('../src/tenants/security.ts');
const { customizeBot } = await import('../src/handlers/admin/customize.ts');
const { adminBot } = await import('../src/handlers/admin/index.ts');
const { platformMiddleware, platformText }=await import('../src/platform/policy.ts');
const { copyEntries }=await import('../src/services/copyCatalog.ts');
const { addCopyButton }=await import('../src/services/copyButtons.ts');
const { registerStart } = await import('../src/handlers/start.ts');
const { registerTopup } = await import('../src/handlers/topup.ts');
const ui = await import('../src/services/interfaceCustomization.ts');
const { startEditDelivery, maybeStartDeliveryFormFromApi, handleDeliveryFormMessage } =
  await import('../src/services/postPurchaseDelivery.ts');
let sent = [],
  requests = [],
  values = {},
  dbRows = {},
  overrides = new Map(),
  nextId = 10;
let external = () => {
  throw Error('Unexpected external request');
};
const json = (body, status = 200, headers = {}) =>
  new Response(status === 304 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init.method ?? (input instanceof Request ? input.method : 'GET');
  let body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  requests.push({ host: url.hostname, path: url.pathname, search: url.search, method, body });
  if (url.hostname === 'api.telegram.org') {
    sent.push({ method: url.pathname.split('/').at(-1), ...body });
    const action = url.pathname.split('/').at(-1);
    return json({
      ok: true,
      result:
        action === 'answerCallbackQuery' || action === 'deleteMessage'
          ? true
          : {
              message_id: nextId++,
              chat: { id: 123, type: 'private' },
              date: 0,
              text: body?.text ?? '',
              from: { id: 987, is_bot: true, first_name: 'Test' },
            },
    });
  }
  if (url.hostname === 'database.test.invalid' || url.hostname === 'tenant.test.invalid') {
    if (url.pathname.endsWith('/rpc/runtime_settings_snapshot'))
      return json({ revision: 0, values });
    if (url.pathname.endsWith('/rpc/runtime_revisions'))
      return json({ settings: 0, catalog_static: 0, catalog_availability: 0 });
    if (url.pathname.endsWith('/rpc/confirm_referral_atomic')) return json({ confirmed: false });
    if (url.pathname.endsWith('/rpc/consume_rate_limit')) return json({ ok: true, remaining: 4 });
    if (url.pathname.endsWith('/rpc/reserve_payment_quote'))
      return json({
        id: 3,
        exact_amount: Number(body.p_base) + 0.0001,
        expires_at: new Date(Date.now() + 1800000).toISOString(),
      });
    if (url.pathname.endsWith('/settings')) {
      if (method === 'POST') {
        overrides.set(body.key, body.value);
        values[body.key] = body.value;
        return json([body]);
      }
      if (method === 'DELETE') {
        const key = url.searchParams.get('key')?.slice(3);
        delete values[key];
        overrides.delete(key);
        return new Response(null, { status: 204 });
      }
      return json([]);
    }
    const table = url.pathname.split('/').at(-1);
    const rows = dbRows[table] ?? [];
    // Model product CRUD and pagination so editor tests exercise the actual
    // grammY routing and Supabase queries, including the selected row.
    if (['products', 'product_items', 'user_price_overrides'].includes(table)) {
      const matches = (row) =>
        [...url.searchParams].every(([key, value]) => {
          if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
          if (value === 'is.null') return row[key] == null;
          return true;
        });
      const selectedRows = rows.filter(matches);
      if (method === 'PATCH') {
        for (const row of selectedRows) Object.assign(row, body);
        return json(selectedRows);
      }
      if (method === 'DELETE') {
        dbRows[table] = rows.filter((row) => !matches(row));
        return new Response(null, { status: 204 });
      }
      if (method === 'GET' || method === 'HEAD') {
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? rows.length);
        const page = selectedRows.slice(offset, offset + limit);
        const headers = {
          'content-range': `${offset}-${offset + page.length - 1}/${selectedRows.length}`,
        };
        if (method === 'HEAD') return new Response(null, { status: 200, headers });
        const object = new Headers(init.headers).get('accept')?.includes('vnd.pgrst.object');
        return json(object ? (page[0] ?? null) : page, 200, headers);
      }
    }
    if (method === 'PATCH') {
      return json(rows[0] ?? null);
    }
    if (method === 'POST') {
      if (table === 'delivery_form_sessions') dbRows[table] = [body];
      return json(body);
    }
    if (method === 'DELETE') {
      dbRows[table] = [];
      return new Response(null, { status: 204 });
    }
    const object = new Headers(init.headers).get('accept')?.includes('vnd.pgrst.object');
    return json(object ? (rows[0] ?? null) : rows);
  }
  return external(url, init);
};
function reset() {
  cache.clearAll();
  settings.clearLocalCache();
  sent = [];
  requests = [];
  values = {};
  dbRows = {};
  overrides = new Map();
}
afterEach(reset);

function editorProduct(id, patch = {}) {
  return {
    id,
    category_id: 1,
    name: `Product ${id}`,
    price: 2,
    stock: 7,
    active: true,
    catalog_hidden: false,
    unlimited_stock: false,
    is_pinned: false,
    stashed_sort_order: null,
    sort_order: id,
    emoji: '📦',
    emoji_id: null,
    referral_required_count: 0,
    description: null,
    note: null,
    warranty: null,
    tutorial_text: null,
    tutorial_file_id: null,
    tutorial_file_type: null,
    tutorial_url: null,
    delivery_form_enabled: false,
    delivery_fields: [],
    ...patch,
  };
}
const latestCard = () => sent.findLast((message) => message.text && message.reply_markup);
const cardButtons = () => latestCard()?.reply_markup.inline_keyboard.flat() ?? [];
const databaseWrites = () =>
  requests.filter(
    (r) =>
      r.host === 'database.test.invalid' &&
      ['POST', 'PATCH', 'DELETE'].includes(r.method) &&
      !/\/rpc\/(runtime_settings_snapshot|runtime_revisions)$/.test(r.path),
  );
function harness(
  composer,
  { admin = true, lang = 'en', selected = true, session = { qty: {} } } = {},
) {
  const user = {
    telegram_id: admin ? 123 : 456,
    language: lang,
    language_selected: selected,
    balance: 20,
    currency: 'USDT',
    username: 'test',
    first_name: 'Test',
  };
  const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN, {
    botInfo: {
      id: 987,
      is_bot: true,
      first_name: 'Test',
      username: 'wwc_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
    },
    client: { fetch: globalThis.fetch },
  });
  ui.installInterfaceCustomization(bot.api);
  bot.use(async (ctx, next) => {
    ctx.session = session;
    ctx.user = user;
    ctx.lang = user.language;
    ctx.t = (key, vars) => t(ctx.lang, key, vars);
    await settings.ensureLoaded();
    await ui.withInterfaceLanguage(ctx.lang, next);
  });
  bot.use(composer);
  let update = 0;
  const send = async (text, extra = {}) => {
    const base = { update_id: ++update };
    const from = { id: user.telegram_id, is_bot: false, first_name: 'Test' };
    const message = {
      message_id: ++nextId,
      chat: { id: user.telegram_id, type: 'private' },
      date: 0,
      from,
      text,
      ...extra,
    };
    if (text.startsWith('/'))
      message.entities = [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }];
    await bot.handleUpdate({ ...base, message });
  };
  const click = async (data) =>
    bot.handleUpdate({
      update_id: ++update,
      callback_query: {
        id: 'q' + update,
        from: { id: user.telegram_id, is_bot: false, first_name: 'Test' },
        chat_instance: 'test',
        data,
        message: {
          message_id: 1,
          date: 0,
          chat: { id: user.telegram_id, type: 'private' },
          text: 'Card',
        },
      },
    });
  return { bot, user, session, send, click };
}
test('Arabic legacy customization cannot replace English deposit text', async () => {
  values = {
    'text.payment.invalid_amount': 'هذا نص عربي',
    'text.en.payment.minimum': 'Minimum {minimum} USD',
  };
  await settings.refreshSettings();
  assert.equal(t('en', 'payment.invalid_amount'), LOCALES.en['payment.invalid_amount']);
  assert.equal(t('ar', 'payment.invalid_amount'), 'هذا نص عربي');
  assert.equal(t('en', 'payment.minimum', { minimum: 2 }), 'Minimum 2 USD');
});
test('All new payment templates have matching placeholders in three languages', () => {
  for (const key of Object.keys(LOCALES.en).filter((k) => k.startsWith('payment.'))) {
    const tokens = (s) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort();
    assert.deepEqual(tokens(LOCALES.ar[key]), tokens(LOCALES.en[key]), key);
    assert.deepEqual(tokens(LOCALES.vi[key]), tokens(LOCALES.en[key]), key);
    assert.doesNotMatch(LOCALES.en[key], /[\u0600-\u06ff]/u);
  }
});
test('Saved language survives a new session and /start does not ask again', async () => {
  const c = new Composer();
  registerStart(c);
  const h = harness(c, { selected: true, lang: 'en' });
  await h.send('/start');
  await h.send('/start');
  assert.ok(sent.some((m) => m.text?.includes('Welcome')));
  assert.ok(
    !sent.some((m) =>
      m.reply_markup?.inline_keyboard
        ?.flat()
        .some((b) => b.callback_data?.startsWith('startlang:')),
    ),
  );
});
test('First language choice persists language_selected in the database', async () => {
  const c = new Composer();
  registerStart(c);
  const h = harness(c, { selected: false });
  await h.send('/start');
  assert.ok(
    sent.some((m) =>
      m.reply_markup?.inline_keyboard?.flat().some((b) => b.callback_data === 'startlang:en'),
    ),
  );
  await h.click('startlang:en');
  assert.equal(h.user.language_selected, true);
  assert.ok(requests.some((r) => r.method === 'PATCH' && r.body?.language_selected === true));
  sent = [];
  await h.send('/start');
  assert.ok(
    !sent.some((m) =>
      m.reply_markup?.inline_keyboard
        ?.flat()
        .some((b) => b.callback_data?.startsWith('startlang:')),
    ),
  );
});
test('English manual deposit amount prompt and receipt remain English', async () => {
  const c = new Composer();
  registerTopup(c);
  dbRows.payment_methods = [
    {
      id: 1,
      name: 'Manual',
      instructions: 'تعليمات عربية',
      provider: 'manual',
      min_amount: 1,
      active: true,
    },
  ];
  const h = harness(c);
  await h.click('topup:method:1');
  await h.click('topup:request:1');
  const prompt = sent.find((m) => m.text?.includes('deposit'));
  assert.ok(prompt);
  assert.doesNotMatch(prompt.text, /[\u0600-\u06ff]/u);
});
test('Customization panel exposes folders and blocks non-admin users', async () => {
  const h = harness(customizeBot);
  await h.send('/customize');
  const buttons = sent.at(-1).reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some((b) => b.text.includes('Start')));
  assert.ok(buttons.some((b) => b.text.includes('Deposits')));
  assert.ok(buttons.some((b) => b.text.includes('Referrals')));
  sent = [];
  const denied = harness(customizeBot, { admin: false });
  await denied.send('/customize');
  assert.equal(sent.length, 0);
});
test('Editing a button uses draft, save and per-language reset', async () => {
  const h = harness(customizeBot);
  await h.click('uix:entry:0:en');
  await h.click('uix:edit:0:en:text');
  await h.send('My Shop');
  assert.equal(overrides.size, 0);
  await h.click('uix:save');
  assert.equal(overrides.get('text.en.btn.shop'), 'My Shop');
  assert.equal(t('en', 'btn.shop'), 'My Shop');
  assert.notEqual(t('ar', 'btn.shop'), 'My Shop');
  await h.click('uix:reset:0:en');
  assert.equal(overrides.has('text.en.btn.shop'), false);
});
test('Text placeholders cannot accidentally be removed through the editor', async () => {
  const h = harness(customizeBot);
  let selected;
  for (let page = 0; page < 30 && !selected; page++) {
    await h.click('uix:folder:3:' + page);
    selected = sent
      .at(-1)
      .reply_markup.inline_keyboard.flat()
      .find((b) => /الحد الأدنى|minimum/i.test(b.text));
  }
  assert.ok(selected);
  const index = selected.callback_data.split(':')[2];
  await h.click('uix:edit:' + index + ':en:text');
  await h.send('Minimum without a variable');
  assert.ok(sent.at(-1).text.includes('{minimum}'));
  assert.equal(h.session.customizeFlow.draft, undefined);
  await h.send('Deposit minimum: {minimum}');
  assert.equal(h.session.customizeFlow.draft, 'Deposit minimum: {minimum}');
});
test('Catalog pagination handles a server that clamps pages to 100 products', async () => {
  external = (url) => {
    const offset = Number(url.searchParams.get('offset') ?? 0);
    return json({
      products: Array.from({ length: Math.min(100, Math.max(0, 230 - offset)) }, (_, i) => ({
        id: offset + i + 1,
        name_en: 'P',
        store_price: 1,
        stock: 3,
      })),
      total: 230,
    });
  };
  const result = await fetchProducts({
    api_key: 'test',
    api_url: 'https://supplier.test.invalid',
    connected: true,
    connected_at: '',
  });
  assert.equal(result.ok, true);
  assert.equal(result.complete, true);
  assert.equal(result.products.length, 230);
});
test('A repeating partial API response never proves the tail was deleted', async () => {
  external = () =>
    json({ products: [{ id: 1, name_en: 'P', store_price: 1, stock: 3 }], total: 1 });
  const result = await fetchProducts({
    api_key: 'partial',
    api_url: 'https://supplier.test.invalid',
    connected: true,
    connected_at: '',
  });
  assert.equal(result.ok, true);
  assert.equal(result.complete, false);
});
test('API clients normalize the current server response and preserve request IDs', async () => {
  external = (url, init) => {
    if (url.pathname === '/my_prices')
      return json({ custom_products: [{ product_id: '1', your_price: 2 }] });
    const body = JSON.parse(init.body);
    assert.equal(body.request_id, 'stable-test');
    return json({
      items: ['ACCOUNT'],
      total: 4,
      balance_after: 6,
      order_id: 'TEST',
      status: 'paid',
    });
  };
  const conn = {
    api_key: 'test',
    api_url: 'https://supplier.test.invalid',
    connected: true,
    connected_at: '',
  };
  const result = await purchase(conn, '1', 1, 'test', 'stable-test');
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.codes, ['ACCOUNT']);
  assert.equal(result.data.new_balance, 6);
  assert.equal((await fetchMyPrices(conn)).prices.length, 1);
});
test('Concurrent catalog readers share one in-flight fetch and cannot poison an invalidated cache', async () => {
  let count = 0,
    resolve;
  const work = () => {
    count++;
    return new Promise((r) => (resolve = r));
  };
  const a = cache.remember('single', 1000, work),
    b = cache.remember('single', 1000, work);
  await Promise.resolve();
  assert.equal(count, 1);
  cache.del('single');
  resolve({ value: 1 });
  await Promise.all([a, b]);
  assert.equal(cache.get('single'), undefined);
});
test('Caches and clients are isolated by the complete database credential', async () => {
  cache.set('same', 'main');
  await dbContext.runWithTenantContext(
    'https://tenant.test.invalid',
    'same-first-twenty-characters-A',
    1,
    async () => {
      cache.set('same', 'A');
    },
  );
  await dbContext.runWithTenantContext(
    'https://tenant.test.invalid',
    'same-first-twenty-characters-B',
    1,
    async () => assert.equal(cache.get('same'), undefined),
  );
  assert.equal(cache.get('same'), 'main');
});
test('Per-user serial queues wait for completion rather than releasing on a timeout', async () => {
  let release;
  const order = [];
  const a = serial('user', async () => {
    order.push(1);
    await new Promise((r) => (release = r));
    order.push(2);
  });
  const b = serial('user', async () => order.push(3));
  await Promise.resolve();
  assert.deepEqual(order, [1]);
  release();
  await Promise.all([a, b]);
  assert.deepEqual(order, [1, 2, 3]);
});
test('Long delivery messages respect Telegram limits without dropping data', () => {
  const payload = Array.from({ length: 20 }, (_, i) => String(i).repeat(3000));
  const chunks = buildOrderDeliveredChunks(payload);
  assert.ok(chunks.length > 20);
  assert.ok(chunks.every((c) => c.inlineBlock.length < 2100));
  assert.ok(chunks[0].isFirst);
  assert.ok(chunks.at(-1).isLast);
});
test('Health route accepts GET/HEAD and does not swallow webhook POST /', () => {
  const res = { writeHead() {}, end() {} };
  assert.equal(
    handleHealthRequest({ headers: { host: 'localhost' }, url: '/', method: 'GET' }, res),
    true,
  );
  assert.equal(
    handleHealthRequest({ headers: { host: 'localhost' }, url: '/', method: 'POST' }, res),
    false,
  );
});
test('Tenant environment excludes main payment secrets and webhook signatures are checked', () => {
  const result = inheritedTenantEnvironment({
    PATH: '/bin',
    BINANCE_PAY_API_SECRET: 'SECRET',
    BYBIT_API_KEY: 'SECRET',
    SUPABASE_SERVICE_ROLE_KEY: 'SECRET',
    OPENAI_API_KEY: 'SECRET',
  });
  assert.deepEqual(result, { PATH: '/bin' });
  assert.ok(validWebhookSecret(tenantWebhookSecret('TEST_TOKEN'), 'TEST_TOKEN'));
  assert.equal(validWebhookSecret(undefined, 'TEST_TOKEN'), false);
  assert.equal(validWebhookSecret('wrong', 'TEST_TOKEN'), false);
});
test('A buyer cannot edit another buyer’s saved delivery submission', async () => {
  dbRows.order_delivery_submissions = [
    { order_id: 1, user_id: 999, product_id: 1, payload: { password: 'PRIVATE' } },
  ];
  const h = harness(new Composer());
  const fake = { user: h.user, session: h.session };
  assert.equal(await startEditDelivery({ ctx: fake, orderId: 1 }), false);
  assert.equal(h.session.userFlow, undefined);
});
test('English chain top-ups ask for a real amount and reserve the exact quote', async () => {
  const c = new Composer();
  registerTopup(c);
  dbRows.payment_methods = [
    {
      id: 2,
      name: 'USDT TRC20',
      provider: 'usdt_trc20',
      address: 'TEST-ADDRESS',
      min_amount: 1,
      active: true,
    },
  ];
  const h = harness(c);
  await h.click('topup:method:2');
  assert.equal(h.session.userFlow.type, 'chain_quote_amount');
  await h.send('10');
  assert.equal(h.session.userFlow.type, 'chain_topup');
  assert.equal(h.session.userFlow.data.quote_id, 3);
  assert.equal(h.session.userFlow.data.unique_amount, 10.0001);
  assert.ok(sent.at(-1).text.includes('10.0001'));
  assert.doesNotMatch(sent.at(-1).text, /[\u0600-\u06ff]/u);
});
test('Old administrative mutation commands reject a non-admin before any writes', async () => {
  const { adminBot } = await import('../src/handlers/admin/index.ts');
  const h = harness(adminBot, { admin: false });
  for (const command of [
    'setproductemoji 1 x',
    'clearproductemoji 1',
    'setproductunlimited 1 on',
    'setproducttutorial 1 test',
    'addproductitems 1 test',
    'countproductitems 1',
    'clearproductitems 1',
    'setbottutorial test',
    'showbottutorial',
    'forcesub off',
    'api',
  ])
    await h.send('/' + command);
  const reads = ['/rpc/runtime_settings_snapshot', '/rpc/runtime_revisions'];
  const mutations = requests.filter(
    (r) =>
      ['POST', 'PATCH', 'DELETE'].includes(r.method) &&
      r.host === 'database.test.invalid' &&
      !reads.some((path) => r.path.endsWith(path)),
  );
  assert.deepEqual(mutations, []);
  assert.ok(sent.every((m) => m.text?.includes('Admin only')));
});
test('The full bot routes the editor input to its save button', async () => {
  reset();
  dbRows.users = [
    {
      telegram_id: 123,
      language: 'en',
      language_selected: true,
      balance: 20,
      currency: 'USDT',
      username: 'test',
      first_name: 'Test',
    },
  ];
  const { buildBot } = await import('../src/bot.ts');
  const bot = await buildBot({ isTenant: true });
  bot.botInfo = {
    id: 987,
    is_bot: true,
    first_name: 'Test',
    username: 'wwc_test_bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  };
  let id = 200;
  const from = { id: 123, is_bot: false, first_name: 'Test' };
  await bot.handleUpdate({
    update_id: ++id,
    callback_query: {
      id: 'full1',
      from,
      data: 'uix:edit:0:en:text',
      chat_instance: 'test',
      message: { message_id: 1, chat: { id: 123, type: 'private' }, date: 0, text: 'Card' },
    },
  });
  await bot.handleUpdate({
    update_id: ++id,
    message: {
      message_id: 2,
      chat: { id: 123, type: 'private' },
      date: 0,
      from,
      text: 'Full routing label',
    },
  });
  await bot.handleUpdate({
    update_id: ++id,
    callback_query: {
      id: 'full2',
      from,
      data: 'uix:save',
      chat_instance: 'test',
      message: { message_id: 1, chat: { id: 123, type: 'private' }, date: 0, text: 'Card' },
    },
  });
  assert.equal(overrides.get('text.en.btn.shop'), 'Full routing label');
});
test('API checkout delivery forms resume and private fields never enter the help URL', async () => {
  const product = {
    id: 22,
    name: 'Subscription',
    delivery_form_enabled: true,
    delivery_fields: [
      { key: 'email', label: 'Email', required: true },
      { key: 'password', label: 'Password', required: true },
    ],
    delivery_vendor_chat_id: null,
  };
  dbRows.products = [product];
  dbRows.orders = [{ id: 202, user_id: 123, product_id: 22 }];
  const c = new Composer();
  c.on('message:text', (ctx) => handleDeliveryFormMessage(ctx));
  const h = harness(c);
  await maybeStartDeliveryFormFromApi({
    api: h.bot.api,
    product,
    orderId: 202,
    orderPublicId: 'ORD-TEST',
    buyerTelegramId: 123,
    buyerLang: 'en',
  });
  assert.equal(dbRows.delivery_form_sessions[0].data.data.order_id, 202);
  await h.send('buyer@example.test');
  assert.equal(h.session.userFlow.type, 'delivery_form');
  await h.send('PASSWORD-MUST-NOT-ENTER-URL');
  assert.equal(h.session.userFlow, undefined);
  const urls = sent
    .flatMap((m) => m.reply_markup?.inline_keyboard?.flat() ?? [])
    .filter((b) => b.url)
    .map((b) => decodeURIComponent(b.url));
  assert.ok(urls.length);
  assert.ok(
    urls.every(
      (url) => !url.includes('PASSWORD-MUST-NOT-ENTER-URL') && !url.includes('buyer@example.test'),
    ),
  );
  assert.deepEqual(dbRows.delivery_form_sessions, []);
});
test('Two users in the same group have separate checkout and form sessions', async () => {
  const { sessionMiddleware } = await import('../src/middleware/session.ts');
  const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN, {
    botInfo: { id: 987, is_bot: true, first_name: 'Test', username: 'wwc_test_bot' },
  });
  const seen = [];
  bot.use(sessionMiddleware);
  bot.on('message:text', (ctx) => {
    ctx.session.qty[1] = (ctx.session.qty[1] ?? 0) + 1;
    seen.push(ctx.session.qty[1]);
  });
  let id = 1000;
  for (const user of [111, 222, 111])
    await bot.handleUpdate({
      update_id: ++id,
      message: {
        message_id: id,
        date: 0,
        chat: { id: -100123, type: 'supergroup', title: 'Test' },
        from: { id: user, is_bot: false, first_name: 'Test' },
        text: 'test',
      },
    });
  assert.deepEqual(seen, [1, 1, 2]);
});

test('Admin products are named buttons with their saved Unicode or Premium icon', async () => {
  dbRows.products = [
    editorProduct(1, { name: 'LARA Premium', emoji: '💎', emoji_id: '5197474765387864959' }),
    editorProduct(2, { name: 'VPN', emoji: '🔐' }),
    editorProduct(3, {
      name: 'Hidden service',
      active: false,
      stock: 0,
      emoji_id: '5197474765387864960',
    }),
  ];
  const h = harness(adminBot, { lang: 'ar' });
  await h.click('adm:prod');
  const products = cardButtons().filter((b) => /^adm:prod:edit:/.test(b.callback_data ?? ''));
  assert.equal(products.length, 3);
  assert.equal(products[0].text, 'LARA Premium');
  assert.equal(products[0].icon_custom_emoji_id, '5197474765387864959');
  assert.equal(products[1].text, '🔐 VPN');
  assert.equal(products[1].icon_custom_emoji_id, undefined);
  assert.match(products[2].text, /Hidden service.*مخفي/);
  assert.equal(products[2].icon_custom_emoji_id, '5197474765387864960');
  assert.match(latestCard().text, /اختر المنتج/);
  assert.ok(!cardButtons().some((b) => /adm:prod:(up|del|stock:set):/.test(b.callback_data ?? '')));
  assert.deepEqual(databaseWrites(), []);
  // The persisted emoji survives a new session; it is not an ephemeral UI override.
  await harness(adminBot, { lang: 'en' }).click('adm:prod');
  assert.equal(cardButtons()[0].icon_custom_emoji_id, '5197474765387864959');
});

test('Product picker paginates and returns to the selected page including hidden products', async () => {
  dbRows.products = Array.from({ length: 18 }, (_, i) => editorProduct(i + 1));
  const h = harness(adminBot);
  await h.click('adm:prod');
  assert.equal(
    cardButtons().filter((b) => b.callback_data?.startsWith('adm:prod:edit:')).length,
    8,
  );
  assert.ok(cardButtons().some((b) => b.callback_data === 'adm:prod:list:1'));
  await h.click('adm:prod:list:2');
  assert.deepEqual(
    cardButtons()
      .filter((b) => b.callback_data?.startsWith('adm:prod:edit:'))
      .map((b) => b.callback_data),
    ['adm:prod:edit:17:2', 'adm:prod:edit:18:2'],
  );
  await h.click('adm:prod:edit:17:2');
  assert.match(latestCard().text, /Product 17/);
  assert.ok(cardButtons().some((b) => b.callback_data === 'adm:prod:list:2'));
  await h.click('adm:prod:list:2');
  assert.match(latestCard().text, /Page 3 \/ 3/);
  // A previously sent page remains usable after its last rows have disappeared.
  dbRows.products.splice(16);
  await h.click('adm:prod:list:2');
  assert.match(latestCard().text, /Page 2 \/ 2/);
  assert.ok(cardButtons().some((b) => b.callback_data === 'adm:prod:edit:9:1'));
});

test('Every existing product edit feature remains reachable inside its named section', async () => {
  dbRows.products = [editorProduct(7, { name: '<VPN> & _Safe_', emoji_id: '5197474765387864959' })];
  dbRows.user_price_overrides = [{ telegram_id: 456, product_id: 7, price: 1 }];
  dbRows.supplier_product_links = [
    { local_product_id: 7, supplier_product_id: 'supplier<&7', auto_sync_stock: true },
  ];
  const h = harness(adminBot);
  await h.click('adm:prod:edit:7:0');
  assert.match(latestCard().text, /&lt;VPN&gt; &amp; _Safe_/);
  const found = new Set(cardButtons().map((b) => b.callback_data));
  const folders = cardButtons().filter((b) => b.callback_data?.startsWith('adm:prod:section:'));
  assert.equal(folders.length, 8);
  for (const folder of folders) {
    await h.click(folder.callback_data);
    if (folder.callback_data.includes(':advanced:')) {
      assert.match(latestCard().text, /supplier&lt;&amp;7/);
      assert.match(latestCard().text, /Supplier stock sync: ON/);
    }
    for (const button of cardButtons()) {
      found.add(button.callback_data);
      assert.ok(Buffer.byteLength(button.callback_data ?? '', 'utf8') <= 64);
    }
    assert.equal(h.session.adminProductEditor.productId, 7);
  }
  for (const action of [
    'name:set',
    'price:set',
    'stock:set',
    'unl:tog',
    'items:add',
    'items:clr',
    'desc:set',
    'desc:clr',
    'note:settxt',
    'note:clr',
    'war:set',
    'war:clr',
    'emoji:set',
    'emoji:clr',
    'color',
    'profit:set',
    'profit:clr',
    'ref:set',
    'ref:clr',
    'cpclr',
    'tut:settxt',
    'tut:setfile',
    'tut:seturl',
    'tut:clrfile',
    'tut:clr',
    'del:tog',
    'del:instr',
    'del:fields',
    'del:succ',
    'del:vendor',
    'del:vlabel',
    'del:clr',
    'pin',
    'up',
    'dn',
    'top',
    'bot',
    'tog',
    'id:set',
    'del',
    'share',
  ])
    assert.ok(found.has(`adm:prod:${action}:7:0`), action);
  assert.ok(found.has('adm:prod:items:view:7:0:0'));
  assert.ok(found.has('adm:ord:p:7:0'));
  assert.deepEqual(databaseWrites(), [], 'Browsing a product must not reset its stock');
  assert.equal(dbRows.products[0].stock, 7);
});

test('Price button edits only the selected product and sends a fresh editor after text input', async () => {
  dbRows.products = [editorProduct(1), editorProduct(2)];
  const h = harness(adminBot);
  await h.click('adm:prod:edit:2:0');
  await h.click('adm:prod:section:pricing:2:0');
  await h.click('adm:prod:price:set:2:0');
  assert.ok(cardButtons().some((b) => b.callback_data === 'adm:prod:back:2:0'));
  await h.send('-1');
  assert.equal(dbRows.products[1].price, 2);
  assert.ok(h.session.adminFlow, 'Invalid values must not consume the edit');
  sent = [];
  await h.send('4.25');
  assert.equal(dbRows.products[0].price, 2);
  assert.equal(dbRows.products[1].price, 4.25);
  assert.equal(h.session.adminFlow, undefined);
  assert.equal(h.session.adminProductEditor.section, 'pricing');
  assert.equal(latestCard().method, 'sendMessage', 'Cannot edit the incoming user message');
  assert.match(latestCard().text, /4\.25 USDT/);
});

test('Cancel, Back, page navigation and switching products discard the old pending edit', async () => {
  dbRows.products = [editorProduct(1), editorProduct(2)];
  const h = harness(adminBot);
  await h.click('adm:prod:edit:1:0');
  await h.click('adm:prod:section:texts:1:0');
  await h.click('adm:prod:desc:set:1:0');
  await h.click('adm:prod:back:1:0');
  assert.equal(h.session.adminFlow, undefined);
  assert.equal(h.session.adminProductEditor.section, 'texts');
  await h.send('This must not be saved');
  assert.equal(dbRows.products[0].description, null);
  await h.click('adm:prod:desc:set:1:0');
  await h.send('/cancel');
  assert.equal(h.session.adminProductEditor.section, 'texts');
  assert.equal(h.session.adminFlow, undefined);
  await h.click('adm:prod:name:set:1:0');
  await h.click('adm:prod:list:0');
  assert.equal(h.session.adminFlow, undefined);
  await h.click('adm:prod:edit:2:0');
  await h.click('adm:prod:name:set:2:0');
  await h.send('Renamed product');
  assert.equal(dbRows.products[0].name, 'Product 1');
  assert.equal(dbRows.products[1].name, 'Renamed product');
  assert.equal(h.session.adminProductEditor.productId, 2);
  await h.click('adm:root');
  assert.equal(h.session.adminProductEditor, undefined);
});

test('Visibility and unlimited stock buttons update the selected row and stay in their section', async () => {
  dbRows.products = [editorProduct(1), editorProduct(2)];
  const h = harness(adminBot);
  await h.click('adm:prod:edit:2:0');
  await h.click('adm:prod:section:placement:2:0');
  await h.click('adm:prod:tog:2:0');
  assert.equal(dbRows.products[0].active, true);
  assert.equal(dbRows.products[1].active, false);
  assert.equal(h.session.adminProductEditor.section, 'placement');
  assert.ok(
    cardButtons().some((b) => b.callback_data === 'adm:prod:tog:2:0' && /Show/.test(b.text)),
  );
  await h.click('adm:prod:section:stock:2:0');
  await h.click('adm:prod:unl:tog:2:0');
  assert.equal(dbRows.products[1].unlimited_stock, true);
  assert.equal(dbRows.products[0].unlimited_stock, false);
  assert.equal(h.session.adminProductEditor.section, 'stock');
  assert.match(latestCard().text, /∞/);
});

test('Product deletion needs a confirmation button and returns to a usable page', async () => {
  dbRows.products = [editorProduct(1), editorProduct(2)];
  const h = harness(adminBot);
  await h.click('adm:prod:edit:2:0');
  await h.click('adm:prod:section:advanced:2:0');
  await h.click('adm:prod:del:2:0');
  assert.equal(dbRows.products.length, 2);
  assert.ok(cardButtons().some((b) => b.callback_data === 'adm:prod:del:ok:2:0'));
  await h.click('adm:prod:back:2:0');
  assert.equal(dbRows.products.length, 2);
  await h.click('adm:prod:del:2:0');
  await h.click('adm:prod:del:ok:2:0');
  assert.deepEqual(
    dbRows.products.map((p) => p.id),
    [1],
  );
  assert.ok(cardButtons().some((b) => b.callback_data === 'adm:prod:edit:1:0'));
  await h.click('adm:prod:edit:2:0');
  assert.match(latestCard().text, /no longer exists/);
  assert.ok(cardButtons().some((b) => b.callback_data === 'adm:prod:list:0'));
});

test('A tutorial file returns to that product and keeps its saved Premium emoji', async () => {
  dbRows.products = [editorProduct(4, { emoji_id: '5197474765387864959' })];
  const h = harness(adminBot);
  await h.click('adm:prod:edit:4:0');
  await h.click('adm:prod:section:tutorial:4:0');
  await h.click('adm:prod:tut:setfile:4:0');
  assert.ok(cardButtons().some((b) => b.callback_data === 'adm:prod:back:4:0'));
  await h.send('', {
    text: undefined,
    document: { file_id: 'fake_tutorial', file_unique_id: 'fake_unique', file_name: 'Guide.pdf' },
  });
  assert.equal(dbRows.products[0].tutorial_file_id, 'fake_tutorial');
  assert.equal(dbRows.products[0].tutorial_file_type, 'document');
  assert.equal(dbRows.products[0].emoji_id, '5197474765387864959');
  assert.equal(h.session.adminProductEditor.section, 'tutorial');
  assert.equal(latestCard().method, 'sendMessage');
});

test('Product menus and direct mutation callbacks remain admin only', async () => {
  dbRows.products = [editorProduct(1)];
  const h = harness(adminBot, { admin: false });
  for (const data of [
    'adm:prod',
    'adm:prod:edit:1:0',
    'adm:prod:section:stock:1:0',
    'adm:prod:back:1:0',
    'adm:prod:unl:tog:1:0',
    'adm:prod:del:ok:1:0',
    'adm:prod:items:sync:1:0',
  ]) {
    sent = [];
    await h.click(data);
    assert.ok(sent.some((m) => m.method === 'answerCallbackQuery' && /Admin only/.test(m.text)));
  }
  assert.deepEqual(databaseWrites(), []);
  assert.equal(dbRows.products.length, 1);
});

test('Full bot routes admin product selection, name input and Premium icons through the real middleware', async () => {
  dbRows.users = [
    {
      telegram_id: 123,
      language: 'ar',
      language_selected: true,
      balance: 20,
      currency: 'USDT',
      username: 'test',
      first_name: 'Test',
    },
  ];
  dbRows.products = [
    editorProduct(7, { name: 'Premium service', emoji_id: '5197474765387864959' }),
  ];
  const { buildBot } = await import('../src/bot.ts');
  const bot = await buildBot({ isTenant: true });
  bot.botInfo = {
    id: 987,
    is_bot: true,
    first_name: 'Test',
    username: 'wwc_test_bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  };
  let updateId = 900;
  const from = { id: 123, is_bot: false, first_name: 'Test' };
  const click = (data) =>
    bot.handleUpdate({
      update_id: ++updateId,
      callback_query: {
        id: `editor${updateId}`,
        from,
        data,
        chat_instance: 'editor',
        message: {
          message_id: 1,
          date: 0,
          chat: { id: 123, type: 'private' },
          text: 'Card',
        },
      },
    });
  await click('adm:prod');
  assert.equal(cardButtons()[0].icon_custom_emoji_id, '5197474765387864959');
  await click(cardButtons()[0].callback_data);
  assert.match(latestCard().text, /Premium service/);
  await click('adm:prod:name:set:7:0');
  await bot.handleUpdate({
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: 123, type: 'private' },
      from,
      text: 'Updated Premium service',
    },
  });
  assert.equal(dbRows.products[0].name, 'Updated Premium service');
  assert.equal(latestCard().method, 'sendMessage');
  await click('adm:prod:list:0');
  assert.equal(cardButtons()[0].text, 'Updated Premium service');
  assert.equal(cardButtons()[0].icon_custom_emoji_id, '5197474765387864959');
  const writes = databaseWrites().filter(
    (r) => !r.path.endsWith('/users') && !r.path.endsWith('/rpc/confirm_referral_atomic'),
  );
  assert.deepEqual(
    writes.map((r) => [r.path.split('/').at(-1), r.body]),
    [['products', { name: 'Updated Premium service' }]],
  );
});

const copyReference=(kind,key)=>'k'+ui.buttonId(kind+':'+key);
test('Original customization controls remain reachable from their folders',async()=>{
 const h=harness(customizeBot);await h.click('uix:folder:8:0');
 assert.ok(cardButtons().some(b=>b.callback_data==='adm:cust:channel'));
 assert.ok(cardButtons().some(b=>b.callback_data==='adm:cust:referral_channel'));
 assert.ok(cardButtons().some(b=>b.callback_data==='adm:reload'));
 await h.click('uix:folder:9:0');
 for(const action of ['adm:cust:color:pick','adm:cust:colorglyph','adm:cust:emoji','adm:cust:btnicon'])
  assert.ok(cardButtons().some(b=>b.callback_data===action),action);
});
test('Store guide and runtime notices are present in customization with all four languages',async()=>{
 const h=harness(customizeBot);await h.send('/customize');
 const buttons=cardButtons();assert.ok(buttons.some(b=>b.callback_data==='uix:folder:10:0'));assert.ok(buttons.some(b=>b.callback_data==='uix:folder:11:0'));
 for(const entry of copyEntries())for(const language of ['en','ar','vi','zh'])assert.ok(entry.defaults[language],entry.key+':'+language);
 await h.click('uix:folder:10:0');assert.ok(cardButtons().some(b=>b.callback_data.includes(':k')));
});
test('Saved guide text retains native bold and Premium emoji and reaches the actual guide',async()=>{
 const c=new Composer();c.use(customizeBot);c.use(platformMiddleware);const h=harness(c);
 const ref=copyReference('text','platform.help.0');
 await h.click('uix:edit:'+ref+':en:text');
 await h.send('Hello ✨ store',{entities:[{type:'bold',offset:0,length:5},{type:'custom_emoji',offset:6,length:1,custom_emoji_id:'5375338737028841420'}]});
 assert.equal(overrides.size,0);await h.click('uix:save');
 assert.match(t('en','platform.help.0'),/<b>Hello<\/b>/);assert.match(t('en','platform.help.0'),/5375338737028841420/);
 await h.click('guide:0');assert.match(sent.at(-1).text,/5375338737028841420/);assert.equal(sent.at(-1).parse_mode,'HTML');
 assert.notEqual(platformText('ar').help[0],platformText('en').help[0]);
});
test('Guide button Premium icon and color are used by its runtime keyboard',async()=>{
 const h=harness(customizeBot),ref=copyReference('button','platform.guide');
 await h.click('uix:edit:'+ref+':en:icon');await h.send('🏪',{entities:[{type:'custom_emoji',offset:0,length:2,custom_emoji_id:'5375338737028841420'}]});await h.click('uix:save');
 await h.click('uix:color:'+ref+':en:red');
 const {InlineKeyboard}=await import('grammy');
 const kb=addCopyButton(new InlineKeyboard(),'en','platform.guide','guide:root',true);
 await h.bot.api.sendMessage(123,'copy',{reply_markup:kb});
 const button=sent.at(-1).reply_markup.inline_keyboard[0][0];assert.equal(button.icon_custom_emoji_id,'5375338737028841420');assert.equal(button.style,'danger');
});
test('A saved picked button and its pending editor survive a fresh module instance',async()=>{
 const {InlineKeyboard}=await import('grammy');const c=new Composer();c.use(customizeBot);c.command('fixture',ctx=>ctx.reply('fixture',{reply_markup:new InlineKeyboard().text('Persistent action','audit:persistent')}));
 const h=harness(c);await h.send('/fixture');await h.click('uix:pick');await h.click('audit:persistent');
 const id=ui.buttonId('audit:persistent'),ref=copyReference('dynamic',id);
 await h.click('uix:edit:'+ref+':en:text');await h.send('Before restart');await h.click('uix:save');
 await h.click('uix:edit:'+ref+':en:text');const savedSession=JSON.parse(JSON.stringify(h.session));
 assert.ok(values['interface.catalog'].some(item=>item.id===id));
 const fresh=await import('../src/handlers/admin/customize.ts?audit-restart=1');assert.notEqual(fresh.customizeBot,customizeBot);
 const restarted=harness(fresh.customizeBot,{session:savedSession});await restarted.send('After restart');await restarted.click('uix:save');
 assert.equal(t('en','interface.'+id),'After restart');
 await restarted.bot.api.sendMessage(123,'fixture',{reply_markup:new InlineKeyboard().text('Persistent action','audit:persistent')});
 assert.equal(sent.at(-1).reply_markup.inline_keyboard[0][0].text,'After restart');
});
test('Navigation cancels pending edits and leaving pick mode does not capture unrelated buttons',async()=>{
 const h=harness(customizeBot);await h.click('uix:edit:0:en:text');await h.click('shop:root');assert.equal(h.session.customizeFlow,undefined);
 await h.send('Unrelated message');assert.equal(overrides.size,0);
 await h.click('uix:pick');assert.equal(h.session.customizePick,true);await h.click('uix:root');assert.equal(h.session.customizePick,false);
});
test('Reset removes a legacy setting override and decimal amounts are accepted without float rejection',async()=>{
 values={'text.referral.amount':2.22,'referral.amount':3};await settings.refreshSettings();
 const h=harness(customizeBot);await h.click('uix:folder:8:0');const button=cardButtons().find(b=>/قيمة مكافأة|Referral reward in USD/.test(b.text));
 assert.ok(button);const ref=button.callback_data.split(':')[2];await h.click('uix:edit:'+ref+':en:text');await h.send('1.10');await h.click('uix:save');
 assert.equal(values['text.referral.amount'],1.1);await h.click('uix:reset:'+ref+':en');
 assert.equal(values['text.referral.amount'],undefined);assert.equal(values['referral.amount'],undefined);
});
test('Oversized button labels and unknown notice placeholders never save',async()=>{
 const h=harness(customizeBot);await h.click('uix:edit:0:en:text');await h.send('x'.repeat(65));assert.equal(h.session.customizeFlow.draft,undefined);
 const ref=copyReference('text','notice.paused');await h.click('uix:edit:'+ref+':en:text');await h.send('Paused {hours} {strikes} {typo}');assert.equal(h.session.customizeFlow.draft,undefined);
});
