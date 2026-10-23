// Preload for a REAL child worker. Every external request is intercepted here.
const sessions = new Map(),
  requests = [],
  telegram = [];
let requestBodyBytes = 0,
  responseBodyBytes = 0,
  productScreens = 0;
const productCount = Number(process.env.CAPACITY_FIXTURE_PRODUCTS ?? 0);
const ownerId = Number(process.env.ADMIN_USER_ID ?? 123);
const products = Array.from({ length: productCount }, (_, i) => ({
  id: i + 1,
  category_id: 1,
  name: 'Capacity product ' + (i + 1),
  description: 'A synthetic product for local resource measurement.',
  price: 5,
  stock: 10,
  active: true,
  catalog_hidden: false,
  api_auto_hidden: false,
  sort_order: i,
  is_pinned: false,
  unlimited_stock: false,
  wwc_source_id: String(i + 1),
  note: '[API_PRODUCT_ID:' + (i + 1) + ']',
}));
const json = (body) => {
  const value = JSON.stringify(body);
  responseBodyBytes += Buffer.byteLength(value);
  return new Response(value, { headers: { 'content-type': 'application/json' } });
};
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init.method ?? (input instanceof Request ? input.method : 'GET');
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
  requestBodyBytes += typeof init.body === 'string' ? Buffer.byteLength(init.body) : 0;
  requests.push({ host: url.hostname, path: url.pathname, method });
  if (url.hostname === 'api.telegram.org') {
    const action = url.pathname.split('/').at(-1);
    telegram.push(action);
    if (JSON.stringify(body).includes('Capacity product')) productScreens++;
    return json({
      ok: true,
      result:
        action === 'getMe'
          ? { id: 987, is_bot: true, first_name: 'Fixture', username: 'offline_child_bot' }
          : action.startsWith('send') || action.startsWith('edit')
            ? {
                message_id: telegram.length,
                date: 1,
                chat: { id: 123, type: 'private' },
                text: body.text ?? '',
              }
            : true,
    });
  }
  if (!/^offlinefixture\d*\.supabase\.co$/.test(url.hostname))
    throw Error('OFFLINE_TEST_UNEXPECTED_NETWORK');
  if (url.pathname.endsWith('/rpc/runtime_revisions'))
    return json({ settings: 1, catalog_static: 1, catalog_availability: 1 });
  if (url.pathname.endsWith('/rpc/runtime_settings_snapshot'))
    return json({ revision: 1, values: { 'store.name': 'Offline store' } });
  if (url.pathname.endsWith('/rpc/shop_platform_statistics'))
    return json({ users: 1, orders: 0, revenue: 0, known_supplier_profit: 0 });
  if (url.pathname.endsWith('/rpc/consume_rate_limit')) return json({ ok: true, remaining: 10 });
  if (url.pathname.endsWith('/rpc/catalog_availability'))
    return json(products.map(({ id, stock, active }) => ({ id, stock, active })));
  if (url.pathname.includes('/rpc/')) return json({ ok: true });
  const table = url.pathname.split('/').at(-1);
  if (table === 'settings') {
    const key = url.searchParams.get('key')?.slice(3);
    return json(
      method === 'GET'
        ? key === 'wwc.last_source_sync'
          ? [{ value: Date.now() }]
          : key === 'api_secret_path'
            ? [{ value: 'f'.repeat(32) }]
            : []
        : body,
    );
  }
  const object = new Headers(init.headers).get('accept')?.includes('vnd.pgrst.object');
  if (table === 'users') {
    const user = {
      id: 1,
      telegram_id: ownerId,
      username: 'owner_fixture',
      first_name: 'Fixture',
      language: 'en',
      language_selected: true,
      balance: 0,
      is_admin: true,
      is_banned: false,
    };
    return json(object ? user : [user]);
  }
  if (table === 'wwc_shop_sessions') {
    if (method === 'POST') {
      sessions.set(body.key, body);
      return json(body);
    }
    const value = sessions.get(url.searchParams.get('key')?.slice(3));
    return json(object ? (value ?? null) : value ? [value] : []);
  }
  if (table === 'products') {
    const from = Number(url.searchParams.get('offset') ?? 0),
      limit = Number(url.searchParams.get('limit') ?? 1000);
    return json(products.slice(from, from + limit));
  }
  if (table === 'categories' && productCount)
    return json([{ id: 1, name: 'Capacity category', sort_order: 0 }]);
  if (method === 'HEAD') return new Response(null, { headers: { 'content-range': '*/0' } });
  return json(object ? null : []);
};
const metrics = () => ({
  rss: process.memoryUsage().rss,
  heap: process.memoryUsage().heapUsed,
  requests: requests.length,
  telegram,
  sessions: sessions.size,
  requestBodyBytes,
  responseBodyBytes,
  productScreens,
});
if (process.send) {
  const send = process.send.bind(process);
  process.send = (value, ...args) =>
    send(value?.type === 'update_ack' ? { ...value, fixtureMetrics: metrics() } : value, ...args);
}
process.on('message', (m) => {
  if (m?.type === 'benchmark') process.send?.({ type: 'benchmark', ...metrics() });
});
