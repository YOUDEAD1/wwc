import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const rpc = async (name, args = []) =>
  (
    await scalar(
      `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`,
      args,
    )
  ).result;
before(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role;`);
  const files = (await fs.readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    try {
      if (f.startsWith('0044'))
        await db.exec(
          `insert into users(telegram_id,language,balance) values(100,'ar',7),(107,'en',-50)`,
        );
      await db.exec(
        await fs.readFile(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8'),
      );
    } catch (e) {
      throw Error(f + ': ' + e.message, { cause: e });
    }
  }
  await db.exec(
    `insert into users(telegram_id,balance) values(101,100),(102,100),(103,0),(104,0);insert into categories(id,name) values(900,'Test');insert into products(id,category_id,name,price,stock) values(901,900,'Local accounts',8,3),(902,900,'Hidden',1,10),(903,900,'Manual',5,5);insert into product_items(product_id,payload) values(901,'ACCOUNT-A'),(901,'ACCOUNT-B'),(901,'ACCOUNT-C');`,
  );
});
after(() => db.close());
test('Existing users retain language; new users choose once', async () => {
  const old = await scalar(
    `select column_default from information_schema.columns where table_name='users' and column_name='language_selected'`,
  );
  assert.equal(old.column_default, 'false');
  assert.equal(
    (await scalar('select language_selected from users where telegram_id=100')).language_selected,
    true,
  );
  assert.equal((await scalar('select language from users where telegram_id=100')).language, 'ar');
  assert.equal(
    (await scalar('select language_selected from users where telegram_id=101')).language_selected,
    false,
  );
});
test('All privileged RPCs reject anon and authenticated', async () => {
  const result = await db.query(
    `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))`,
  );
  assert.deepEqual(result.rows, []);
});
test('Secret-bearing and financial tables have RLS', async () => {
  for (const table of [
    'wallet_ledger',
    'gift_codes',
    'reseller_api_keys',
    'supplier_api_sources',
    'wallet_operations',
    'payment_quotes',
    'rate_limits',
  ])
    assert.equal(
      (await scalar(`select relrowsecurity from pg_class where relname=$1`, [table]))
        .relrowsecurity,
      true,
    );
});
test('Atomic wallet debit forbids overdrafts and repeated reference', async () => {
  await rpc('apply_wallet_change', [104, 10, 'test', 'initial']);
  await rpc('apply_wallet_change', [104, -8, 'test', 'debit']);
  assert.equal(Number(await rpc('apply_wallet_change', [104, -8, 'test', 'debit'])), 2);
  await assert.rejects(rpc('apply_wallet_change', [104, -8, 'test', 'second']), /INSUFFICIENT/);
  assert.equal(
    Number((await scalar('select balance from users where telegram_id=104')).balance),
    2,
  );
});
const order = (
  user,
  id,
  key,
  qty = 1,
  price = 8,
  total = price * qty,
  kind = 'wallet',
  pre = false,
  apiKey = null,
) => rpc('create_checkout_order', [user, id, qty, price, total, 0, null, key, kind, pre, apiKey]);
test('Checkout commits funds, order, inventory and replay together', async () => {
  const first = await order(101, 901, 'wallet-1');
  const repeated = await order(101, 901, 'wallet-1');
  const second = await order(102, 901, 'wallet-2');
  assert.equal(repeated.replayed, true);
  assert.equal(repeated.order.id, first.order.id);
  assert.deepEqual(first.order.allocated_items, ['ACCOUNT-A']);
  assert.deepEqual(second.order.allocated_items, ['ACCOUNT-B']);
  assert.equal(Number((await scalar('select stock from products where id=901')).stock), 1);
  assert.equal(
    Number((await scalar('select balance from users where telegram_id=101')).balance),
    92,
  );
});
test('Failed checkout rolls inventory and order back', async () => {
  await assert.rejects(order(103, 901, 'no-money'), /INSUFFICIENT/);
  assert.equal(Number((await scalar('select stock from products where id=901')).stock), 1);
  assert.equal(
    (await scalar(`select count(*)::int n from orders where checkout_key='no-money'`)).n,
    0,
  );
});
test('Hidden product and hidden category cannot be purchased by stale buttons', async () => {
  await db.exec(`update products set catalog_hidden=true where id=902`);
  await assert.rejects(order(101, 902, 'hidden', 1, 1), /PRODUCT_UNAVAILABLE/);
  await db.exec(`update categories set active=false where id=900`);
  await assert.rejects(order(101, 903, 'cat-hidden', 1, 5), /PRODUCT_UNAVAILABLE/);
  await db.exec(`update categories set active=true where id=900`);
});
test('Upstream out of stock is filtered from the compact catalog', async () => {
  await db.exec(`update products set api_auto_hidden=true where id=902`);
  const data = await rpc('catalog_availability');
  assert.equal(data.find((p) => p.id === 902).active, false);
});
test('Stock-only changes do not invalidate large product metadata', async () => {
  const a = await rpc('runtime_revisions');
  await db.exec('update products set stock=stock+1 where id=903');
  const b = await rpc('runtime_revisions');
  assert.equal(b.catalog_static, a.catalog_static);
  assert.ok(b.catalog_availability > a.catalog_availability);
  await db.exec(`update products set description='Changed metadata' where id=903`);
  const c = await rpc('runtime_revisions');
  assert.ok(c.catalog_static > b.catalog_static);
});
test('Settings snapshot omits tenant secrets and large supplier config', async () => {
  await db.exec(
    `insert into settings(key,value) values('tenant:test','{"secret":"test"}'),('api_shop_config','{"products":{}}'),('text.en.welcome.title','"Welcome"') on conflict(key) do update set value=excluded.value;`,
  );
  const data = await rpc('runtime_settings_snapshot');
  assert.equal(data.values['tenant:test'], undefined);
  assert.equal(data.values.api_shop_config, undefined);
  assert.equal(data.values['text.en.welcome.title'], 'Welcome');
});
test('Deposit approval credits once and reserves a transaction hash', async () => {
  const a = await scalar(
    `insert into deposits(user_id,method,amount) values(103,'Manual',10) returning id`,
  );
  const b = await scalar(
    `insert into deposits(user_id,method,amount) values(103,'Manual',10) returning id`,
  );
  await rpc('approve_deposit_atomic', [a.id, 10, 'TEST-PROOF']);
  const again = await rpc('approve_deposit_atomic', [a.id, 10, 'TEST-PROOF']);
  assert.equal(again.replayed, true);
  await assert.rejects(
    rpc('approve_deposit_atomic', [b.id, 10, 'TEST-PROOF']),
    /TRANSACTION_ALREADY_USED/,
  );
  assert.equal(
    Number((await scalar('select balance from users where telegram_id=103')).balance),
    10,
  );
});
test('Exact amount quotes are distinct and owned by one payer', async () => {
  const a = await rpc('reserve_payment_quote', [101, 'usdt_trc20', 'TEST-ADDRESS', 5]);
  const b = await rpc('reserve_payment_quote', [102, 'usdt_trc20', 'TEST-ADDRESS', 5]);
  assert.notEqual(Number(a.exact_amount), Number(b.exact_amount));
  const d = await scalar(
    `insert into deposits(user_id,method,amount,quote_id) values(102,'USDT',5,$1) returning id`,
    [a.id],
  );
  await assert.rejects(
    rpc('approve_deposit_atomic', [d.id, Number(a.exact_amount), 'WRONG-OWNER']),
    /QUOTE_OWNERSHIP/,
  );
  const own = await scalar(
    `insert into deposits(user_id,method,amount,quote_id) values(102,'USDT',5,$1) returning id`,
    [b.id],
  );
  await assert.rejects(
    rpc('approve_deposit_atomic', [own.id, 5, 'WRONG-AMOUNT']),
    /PAYMENT_AMOUNT_MISMATCH/,
  );
  await rpc('approve_deposit_atomic', [own.id, Number(b.exact_amount), 'EXACT-PAYMENT']);
});
test('Direct deposit creates one order and credits only surplus', async () => {
  const intent = {
    product_id: 903,
    product_name: 'Manual',
    qty: 1,
    unit_price: 5,
    total: 5,
    discount: 0,
    promo_id: null,
  };
  const d = await scalar(
    `insert into deposits(user_id,method,amount,order_intent) values(104,'Direct',7,$1) returning id`,
    [JSON.stringify(intent)],
  );
  const result = await rpc('approve_deposit_atomic', [d.id, 7, 'DIRECT-PROOF']);
  assert.ok(result.order.id);
  assert.equal(Number(result.balance), 4);
  assert.equal(
    (await rpc('approve_deposit_atomic', [d.id, 7, 'DIRECT-PROOF'])).order.id,
    result.order.id,
  );
});
test('Missing direct product refunds the full verified amount', async () => {
  const intent = {
    product_id: 999999,
    product_name: 'Gone',
    qty: 1,
    unit_price: 5,
    total: 5,
    discount: 0,
  };
  const d = await scalar(
    `insert into deposits(user_id,method,amount,order_intent) values(104,'Direct',7,$1) returning id`,
    [JSON.stringify(intent)],
  );
  const result = await rpc('approve_deposit_atomic', [d.id, 7, 'MISSING-PROOF']);
  assert.equal(result.refunded, true);
  assert.equal(Number(result.balance), 11);
});
test('Gift redemption obeys global and per-user limits atomically', async () => {
  await db.exec(`insert into gift_codes(code,amount,max_redemptions) values('TEST-GIFT',2,1)`);
  await rpc('redeem_gift_atomic', [103, 'TEST-GIFT']);
  await assert.rejects(rpc('redeem_gift_atomic', [104, 'TEST-GIFT']), /GIFT_LIMIT/);
});
test('Referral confirmation occurs once, not during account creation', async () => {
  await db.exec(`insert into users(telegram_id,pending_referral_by) values(105,101)`);
  assert.equal((await scalar('select count(*)::int n from referrals where referee_id=105')).n, 0);
  assert.equal((await rpc('confirm_referral_atomic', [105])).confirmed, true);
  assert.equal((await rpc('confirm_referral_atomic', [105])).confirmed, false);
  await db.exec(
    `insert into users(telegram_id,pending_referral_by,referral_invalidated) values(106,101,true)`,
  );
  assert.equal((await rpc('confirm_referral_atomic', [106])).confirmed, false);
});
test('Client-supplied referral exchange rates are rejected', async () => {
  await assert.rejects(rpc('convert_referrals_to_wallet', [101, 1, 999]), /REFERRAL_RATE_CHANGED/);
});
test('Atomic rate limit rejects attempts above the configured window', async () => {
  assert.equal((await rpc('consume_rate_limit', ['test', 1, 60000])).ok, true);
  assert.equal((await rpc('consume_rate_limit', ['test', 1, 60000])).ok, false);
});
test('Preorder stock is reserved once and a delivered order cannot release it', async () => {
  await db.exec(`insert into products(id,name,price,stock) values(910,'Preorder',2,0)`);
  const result = await order(101, 910, 'preorder', 1, 2, 2, 'wallet', true);
  assert.equal(result.order.is_preorder, true);
  assert.equal(await rpc('begin_order_delivery', [result.order.id]), true);
  await db.exec(
    `update orders set fulfillment_state='preorder' where id=$ORDER$`.replace(
      '$ORDER$',
      String(result.order.id),
    ),
  );
  assert.equal(await rpc('reserve_preorder_stock', [result.order.id]), false);
  await db.exec(`update products set stock=2 where id=910`);
  assert.equal(await rpc('reserve_preorder_stock', [result.order.id]), true);
  assert.equal(await rpc('reserve_preorder_stock', [result.order.id]), true);
  assert.equal((await scalar('select stock from products where id=910')).stock, 1);
  await db.exec(`update orders set fulfillment_state='delivered' where id=${result.order.id}`);
  await rpc('release_preorder_stock', [result.order.id]);
  assert.equal((await scalar('select stock from products where id=910')).stock, 1);
});
test('Tenant registry mutations keep all additions and renew the live record', async () => {
  const end = new Date(Date.now() + 86400000).toISOString();
  await rpc('tenant_registry_mutation', [
    'add',
    'a',
    JSON.stringify({ id: 'a', status: 'active', subscription_end: end }),
  ]);
  await rpc('tenant_registry_mutation', [
    'add',
    'b',
    JSON.stringify({ id: 'b', status: 'active', subscription_end: end }),
  ]);
  assert.deepEqual((await scalar(`select value from settings where key='tenant:list'`)).value, [
    'a',
    'b',
  ]);
  const renewed = await rpc('tenant_registry_mutation', [
    'extend',
    'a',
    JSON.stringify({ days: 3 }),
  ]);
  assert.ok(new Date(renewed.subscription_end) > new Date(end));
  await rpc('tenant_registry_mutation', ['status', 'a', JSON.stringify({ status: 'suspended' })]);
  assert.equal(
    (await scalar(`select value from settings where key='tenant:a'`)).value.status,
    'suspended',
  );
});
test('SQL statistics count all rows beyond the 1,000-row API cap and exclude refunds', async () => {
  await db.exec(
    `insert into orders(user_id,product_id,product_name,qty,unit_price,total,status) select 101,903,'Manual',1,1,1,'paid' from generate_series(1,1105);insert into orders(user_id,product_id,product_name,qty,unit_price,total,status) values(101,903,'Refund',1,999,999,'refunded')`,
  );
  const stats = await rpc('shop_statistics', [101]);
  assert.ok(Number(stats.orders) > 1100);
  assert.ok(Number(stats.revenue) < 1200);
  const products = await rpc('product_sales_statistics', [null, 50]);
  assert.ok(products.some((p) => p.units_sold > 1100 && p.last_sold_at));
});
test('Old negative balances and completed referral prices are not recalculated by the upgrade', async () => {
  assert.equal(
    Number((await scalar('select balance from users where telegram_id=107')).balance),
    -50,
  );
  const before = Number((await scalar('select balance from users where telegram_id=100')).balance);
  await db.exec(
    `insert into settings(key,value) values('text.referral.cost','1'),('text.referral.amount','50') on conflict(key) do update set value=excluded.value`,
  );
  assert.equal(
    Number((await scalar('select balance from users where telegram_id=100')).balance),
    before,
  );
});
test('Rerunning only the upgrade leaves all balances and history unchanged', async () => {
  const before = (await db.query('select telegram_id,balance from users order by telegram_id'))
    .rows;
  await db.exec(
    await fs.readFile(
      new URL('../supabase/migrations/0044_secure_checkout_and_runtime.sql', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(
    (await db.query('select telegram_id,balance from users order by telegram_id')).rows,
    before,
  );
});

test('Platform registry enforces ownership, capacity and idempotent subscriptions',async()=>{
 const add=(id,actor,bot)=>rpc('wwc_platform_mutate',['register',id,actor,JSON.stringify({max_owner_shops:1,bot_id:bot,bot_username:'fixture_'+bot,token_fingerprint:'t'+bot,database_fingerprint:'d'+bot,secret_box:'encrypted'})]);
 await add('shop-a',7001,8001);await add('shop-b',7002,8002);
 await assert.rejects(add('extra',7001,8003),/OWNER_SHOP_LIMIT/);
 await assert.rejects(rpc('wwc_platform_mutate',['activate','shop-a',7002,'{"max_active_shops":1}']),/FORBIDDEN/);
 await rpc('wwc_platform_mutate',['activate','shop-a',7001,'{"max_active_shops":1}']);
 await assert.rejects(rpc('wwc_platform_mutate',['activate','shop-b',7002,'{"max_active_shops":1}']),/HOST_CAPACITY/);
 const first=await rpc('wwc_platform_mutate',['subscribe','shop-a',7001,'{"days":30,"receipt":"charge:fixture-001"}']);
 const second=await rpc('wwc_platform_mutate',['subscribe','shop-a',7001,'{"days":30,"receipt":"charge:fixture-001"}']);assert.equal(first.paid_until,second.paid_until);
 await assert.rejects(rpc('wwc_platform_mutate',['subscribe','shop-b',7002,'{"days":30,"receipt":"charge:fixture-001"}']),/RECEIPT_CONFLICT/);
});
test('Persistent inactivity strikes lock the third pause; completed purchase resets them',async()=>{
 for(let i=0;i<3;i++){await db.exec("update wwc_platform_shops set status='active',last_active_at=now()-interval '4 days' where id='shop-a'");const row=await rpc('wwc_platform_mutate',['idle','shop-a',7001,'{"trusted_super":true,"hours":72}']);assert.equal(row.idle_strikes,i+1);if(i<2)await rpc('wwc_platform_mutate',['resume','shop-a',7001,'{"max_active_shops":10}']);}
 assert.equal((await scalar("select status from wwc_platform_shops where id='shop-a'")).status,'locked');await assert.rejects(rpc('wwc_platform_mutate',['resume','shop-a',7001,'{"max_active_shops":10}']),/OWNER_UNLOCK_REQUIRED/);
 await rpc('wwc_platform_mutate',['super_resume','shop-a',9001,'{"trusted_super":true,"max_active_shops":10}']);await db.exec("update wwc_platform_shops set idle_strikes=2 where id='shop-a'");
 await rpc('wwc_platform_mutate',['activity','shop-a',7001,'{"trusted_super":true,"kind":"purchase","event":"shop-a:order:1"}']);assert.equal((await scalar("select idle_strikes from wwc_platform_shops where id='shop-a'")).idle_strikes,0);
 await db.exec("update wwc_platform_shops set last_active_at=now()-interval '3 days' where id='shop-a'");const old=(await scalar("select last_active_at from wwc_platform_shops where id='shop-a'")).last_active_at;
 await rpc('wwc_platform_mutate',['activity','shop-a',7001,'{"trusted_super":true,"kind":"purchase","event":"shop-a:order:1"}']);assert.equal((await scalar("select last_active_at from wwc_platform_shops where id='shop-a'")).last_active_at.getTime(),old.getTime());
});
test('Nonces and controller singleton lease remain valid across process restarts',async()=>{
 assert.equal(await rpc('wwc_platform_nonce',['nonce-fixture-00000001']),true);assert.equal(await rpc('wwc_platform_nonce',['nonce-fixture-00000001']),false);
 assert.equal(await rpc('wwc_platform_lease_claim',['a']),true);assert.equal(await rpc('wwc_platform_lease_claim',['b']),false);await rpc('wwc_platform_lease_claim',['a',true]);assert.equal(await rpc('wwc_platform_lease_claim',['b']),true);
});
test('Chinese language and durable sessions coexist without resetting balances',async()=>{
 await db.exec("update users set language='zh' where telegram_id=101");assert.equal((await scalar('select language from users where telegram_id=101')).language,'zh');
 await db.exec(`insert into wwc_shop_sessions(key,value,expires_at) values('chat:one','{"qty":{"901":2}}',now()+interval '1 day')`);assert.equal((await scalar("select value from wwc_shop_sessions where key='chat:one'")).value.qty['901'],2);const stats=await rpc('shop_platform_statistics');assert.ok(Number(stats.users)>0);
});
test('Activation queue clears only on activation and expired sessions are pruned',async()=>{
 const queued=await rpc('wwc_platform_mutate',['queue','shop-b',7002,'{}']);assert.ok(queued.activation_requested_at);const active=await rpc('wwc_platform_mutate',['activate','shop-b',7002,'{"max_active_shops":10}']);assert.equal(active.activation_requested_at,null);
 await db.exec("insert into wwc_shop_sessions(key,value,expires_at) values('expired','{}',now()-interval '1 hour')");assert.equal(await rpc('wwc_shop_sessions_cleanup'),1);assert.equal((await scalar("select count(*)::int n from wwc_shop_sessions where key='chat:one'")).n,1);
});

test('Credential rotation updates a renamed bot and owner language without changing its license',async()=>{
 const before=(await db.query("select * from wwc_platform_shops where id='shop-a'")).rows[0];
 const after=await rpc('wwc_platform_mutate',['credentials','shop-a',7001,JSON.stringify({secret_box:'new-encrypted-box',token_fingerprint:'new-token-fingerprint',database_fingerprint:'new-project-fingerprint',bot_username:'renamed_fixture_bot',owner_lang:'zh'})]);
 assert.equal(after.bot_username,'renamed_fixture_bot');assert.equal(after.owner_lang,'zh');
 assert.equal(Date.parse(after.paid_until),new Date(before.paid_until).getTime());
 assert.equal(after.idle_strikes,before.idle_strikes);assert.equal(after.plan,before.plan);
});

test('Twenty independently owned stores activate at the configured capacity and the twenty-first is queued',async()=>{
 await db.exec('begin');
 try{
  await db.exec("update wwc_platform_shops set status='idle'");
  for(let i=1;i<=21;i++){
   const id='capacity-'+i,owner=20000+i;
   await rpc('wwc_platform_mutate',['register',id,owner,JSON.stringify({max_owner_shops:1,bot_id:30000+i,bot_username:'capacity_fixture_'+i,token_fingerprint:'capacity-token-'+i,database_fingerprint:'capacity-db-'+i,secret_box:'encrypted'})]);
   if(i<=20)await rpc('wwc_platform_mutate',['activate',id,owner,'{"max_active_shops":20}']);
  }
  assert.equal((await scalar("select count(*)::int n from wwc_platform_shops where status='active'")).n,20);
  const queued=await rpc('wwc_platform_mutate',['queue','capacity-21',20021,'{}']);
  assert.ok(queued.activation_requested_at);
  await assert.rejects(rpc('wwc_platform_mutate',['activate','capacity-21',20021,'{"max_active_shops":20}']),/HOST_CAPACITY/);
 }finally{await db.exec('rollback');}
});


test('Manager profiles and platform overview are service-only and clean only expired drafts',async()=>{
 assert.equal((await scalar("select relrowsecurity from pg_class where relname='wwc_manager_users'")).relrowsecurity,true);
 for(const role of ['anon','authenticated']){
  assert.equal((await scalar("select has_table_privilege($1,'wwc_manager_users','select') allowed",[role])).allowed,false);
  assert.equal((await scalar("select has_function_privilege($1,'wwc_manager_overview()','execute') allowed",[role])).allowed,false);
 }
 const prior=await rpc('wwc_manager_overview');
 await db.exec("insert into wwc_manager_users(telegram_id,language,language_chosen,draft_box,draft_expires_at) values(2001,'ar',true,'expired encrypted draft',now()-interval '1 minute'),(2002,'zh',true,'valid encrypted draft',now()+interval '10 minutes')");
 await rpc('wwc_manager_cleanup');
 assert.equal((await scalar('select draft_box from wwc_manager_users where telegram_id=2001')).draft_box,null);
 assert.equal((await scalar('select language from wwc_manager_users where telegram_id=2001')).language,'ar');
 assert.equal((await scalar('select draft_box from wwc_manager_users where telegram_id=2002')).draft_box,'valid encrypted draft');
 assert.deepEqual(await rpc('wwc_manager_overview'),prior);
});
