import {test,afterEach} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {randomBytes} from 'node:crypto';
process.env.TELEGRAM_BOT_TOKEN='123456789:TEST_TOKEN_NOT_REAL_123456789';process.env.BOT_USERNAME='fixture_bot';process.env.ADMIN_USER_ID='123';process.env.SUPABASE_URL='https://fixture.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='FAKE_NOT_REAL_SERVICE_KEY_123456789';
const sec=await import('../src/platform/security.ts'),policy=await import('../src/platform/policy.ts');const{WorkerPool}=await import('../src/platform/pool.ts');const{makePlatformServer}=await import('../src/platform/server.ts');const{Registry,effectivePlan}=await import('../src/platform/repository.ts');const{LOCALES}=await import('../config/index.ts');
const secret='fixture-shared-secret-over-32-characters';const config={databaseUrl:'https://fixture.supabase.co',databaseKey:'FAKE_NOT_REAL_SERVICE_KEY_123456789',sharedSecret:secret,encryptionKey:randomBytes(32),owners:[123],publicUrl:'https://platform.example',nssOrigin:'https://nss.example',nssUsername:'nss_fixture_bot',maxWorkers:1,maxShops:10,maxOwnerShops:1,heapMb:128,idleWorkerMs:30000,inactivityHours:72,stars:500,days:30,port:3000};const shop={id:'s_'+'a'.repeat(24),owner_id:456,owner_lang:'en',bot_id:987,bot_username:'child_fixture_bot',plan:'free',paid_until:null,status:'active',idle_strikes:0,last_active_at:new Date().toISOString(),secret_box:'encrypted'};
config.walletPriceUsd='5.00';
afterEach(()=>{for(const key of ['WWC_MANAGED','TENANT_PLAN','TENANT_PAID_UNTIL'])delete process.env[key];});
test('HMAC covers every request component; ciphertext is bound to its shop',()=>{
 const body=Buffer.from('{"actor_id":456}'),time=String(Math.floor(Date.now()/1000)),nonce='n'.repeat(30),sig=sec.signature(secret,'POST','/platform/v1/list',time,nonce,body);
 assert.ok(sec.verifySignature(secret,'POST','/platform/v1/list',time,nonce,body,sig));assert.ok(!sec.verifySignature(secret,'POST','/platform/v1/list',time,nonce,Buffer.from('{}'),sig));assert.ok(!sec.verifySignature(secret,'GET','/platform/v1/list',time,nonce,body,sig));assert.ok(!sec.verifySignature(secret,'POST','/platform/v1/list','1000000000',nonce,body,sig));
 const key=randomBytes(32),box=sec.seal({token:'private'},key,shop.id);assert.ok(!box.includes('private'));assert.deepEqual(sec.unseal(box,key,shop.id),{token:'private'});assert.throws(()=>sec.unseal(box,key,'different'));
 for(const bad of ['https://127.0.0.1','http://fixture.supabase.co','https://fixture.supabase.co.evil.test','https://fixture.supabase.co/api','https://u:p@fixture.supabase.co'])assert.throws(()=>sec.safeSupabaseUrl(bad));assert.equal(sec.safeSupabaseUrl('https://fixture.supabase.co/'),'https://fixture.supabase.co');
});

test('Wallet prices are explicit fixed-point dollars, with no Stars conversion',async()=>{
 const {walletPrice}=await import('../src/platform/pricing.ts');
 assert.equal(walletPrice(undefined),null);assert.equal(walletPrice(''),null);
 assert.equal(walletPrice('5'),'5.00');assert.equal(walletPrice('5.125'),'5.125');
 assert.equal(walletPrice('0.000001'),'0.000001');
 for(const invalid of ['0','-5','NaN','Infinity','1e2','5.0000001','1000001','bad'])assert.throws(()=>walletPrice(invalid),/WWC_SUBSCRIPTION_USD/);
});

test('Signed NSS wallet receipts activate without Stars and preserve the paid quote',async()=>{
 const nonces=new Set(),receipts=new Set();let writes=0;
 const r={config,db:{},get:async()=>shop,view:x=>x,
  rpc:async(name,{p_nonce})=>{if(nonces.has(p_nonce))return false;nonces.add(p_nonce);return true;},
  mutate:async(action,id,actor,payload)=>{assert.equal(action,'subscribe');assert.equal(actor,456);if(!receipts.has(payload.receipt)){receipts.add(payload.receipt);writes++;}return {...shop,plan:'paid',paid_until:'2099-01-01'};}};
 const pool={entries:new Map(),failures:new Map()};const {server}=makePlatformServer(r,pool);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 async function call(action,data){const path='/platform/v1/'+action,body=Buffer.from(JSON.stringify(data)),time=String(Math.floor(Date.now()/1000)),nonce=randomBytes(18).toString('hex');return fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',body,headers:{'x-wwc-time':time,'x-wwc-nonce':nonce,'x-wwc-signature':sec.signature(secret,'POST',path,time,nonce,body)}});}
 const receipt={actor_id:456,shop_id:shop.id,receipt:'nss:'+'c'.repeat(32),payment_method:'nss_wallet',currency:'USD',amount:'3.25',days:30};
 try{
  const plan=await (await call('config',{actor_id:456})).json();assert.equal(plan.wallet_price_usd,'5.00');assert.equal(plan.wallet_currency,'USD');
  assert.equal((await call('subscribe',receipt)).status,200);
  assert.equal((await call('subscribe',receipt)).status,200);assert.equal(writes,1);
  for(const patch of [{amount:'0'},{amount:'NaN'},{currency:'XTR'},{receipt:'tg:forged_wallet_receipt'},{days:0}])assert.equal((await call('subscribe',{...receipt,...patch})).status,400);
  assert.equal((await call('subscribe',{...receipt,actor_id:789})).status,403);assert.equal(writes,1);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('Runtime notices load only editable copy, cache it, and retain button styling',async()=>{
 const realFetch=globalThis.fetch;let reads=0;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.hostname!=='fixture.supabase.co')return realFetch(input,init);
  reads++;
  return new Response(JSON.stringify([
   {key:'text.en.notice.warning',value:'<b>Custom inactivity warning</b>'},
   {key:'text.en.notice.dashboard',value:'My dashboard'},
   {key:'btnicon.copy.notice.dashboard',value:{unicode:'🏠',custom_emoji_id:'5375338737028841420'}},
   {key:'color.copy.notice.dashboard',value:'green'}
  ]),{headers:{'content-type':'application/json'}});
 };
 const registry={config,secrets:()=>({databaseUrl:config.databaseUrl,databaseKey:config.databaseKey})};
 const app=makePlatformServer(registry,{entries:new Map(),failures:new Map()});
 try{
  const text=await app.shopNotices(shop);assert.equal(text.warning,'<b>Custom inactivity warning</b>');
  const button=text.button('dashboard','https://t.me/nss_fixture_bot');assert.equal(button.text,'My dashboard');assert.equal(button.icon_custom_emoji_id,'5375338737028841420');assert.equal(button.style,'success');
  await app.shopNotices(shop);assert.equal(reads,1);app.invalidate(shop.id);await app.shopNotices(shop);assert.equal(reads,2);
 }finally{globalThis.fetch=realFetch;app.server.close();}
});

test('One unavailable store does not block inactivity maintenance for other stores',async()=>{
 const {runMaintenance}=await import('../src/platform/server.ts');
 const stores=[{...shop,id:'unavailable',last_active_at:'2000-01-01'},{...shop,id:'healthy',last_active_at:'2000-01-01'}];
 const actions=[],sent=[];let drained=false;
 const registry={config,active:async()=>stores,secrets:()=>({botToken:'fake'}),mutate:async(action,id)=>{actions.push([action,id]);return {...shop,status:'idle',idle_strikes:1};}};
 const pool={flushActivity:async()=>{},stop:id=>actions.push(['stop',id])};
 const app={stats:async s=>{if(s.id==='unavailable')throw Error('fixture database unavailable');return {};},invalidate(){},
  shopNotices:async()=>({paused:'Paused {hours} {strikes}',button:(key,url)=>({text:key,url})}),drainActivationQueue:async()=>{drained=true;}};
 await runMaintenance(registry,pool,app,async(token,method,body)=>sent.push(body));
 assert.ok(actions.some(([action,id])=>action==='idle'&&id==='healthy'));
 assert.ok(!actions.some(([action,id])=>action==='idle'&&id==='unavailable'));
 assert.equal(sent.length,1);assert.equal(drained,true);
});
test('Free/expired permissions and product provenance cannot be forged with a local label',async()=>{
 process.env.WWC_MANAGED='1';process.env.TENANT_PLAN='free';assert.throws(()=>policy.requirePaidCapability(),/SUBSCRIPTION_REQUIRED/);assert.throws(()=>policy.requireProductPatch({stock:999}),/SUBSCRIPTION_REQUIRED/);policy.requireProductPatch({name:'Name',price:20,description:'Desc',emoji_id:'12345'});
 assert.equal(policy.allowedProduct({wwc_source_id:null}),false);assert.equal(policy.allowedProduct({wwc_source_id:'101',note:'local'}),false);assert.equal(policy.allowedProduct({wwc_source_id:'101',note:'[API_PRODUCT_ID:101]'}),true);
 await policy.trustedCatalog(async()=>policy.requirePaidCapability(),true);assert.equal(policy.importingNss(),false);process.env.TENANT_PLAN='paid';process.env.TENANT_PAID_UNTIL='2099-01-01';policy.requirePaidCapability();process.env.TENANT_PAID_UNTIL='2000-01-01';assert.throws(()=>policy.requirePaidCapability());assert.equal(effectivePlan({...shop,plan:'paid',paid_until:'2000-01-01'}),'free');
});
test('Every Chinese locale template exists and retains all English placeholders',()=>{for(const[k,v]of Object.entries(LOCALES.en)){assert.ok(LOCALES.zh[k],k);assert.deepEqual((v.match(/\{\w+\}/g)??[]).sort(),(LOCALES.zh[k].match(/\{\w+\}/g)??[]).sort(),k);}});
function child(){const p=new EventEmitter();p.stderr={resume(){}};p.send=(m,cb)=>{cb?.(null);if(m.type==='telegram_update')setTimeout(()=>p.emit('message',{type:'update_ack',id:m.id,ok:true}),2);};p.kill=()=>setImmediate(()=>p.emit('exit',0));setTimeout(()=>p.emit('message',{type:'ready'}),2);return p;}
test('Pool starts lazily, queues a different shop and preserves the hard process cap',async()=>{
 let launches=0;const r={config,get:async()=>shop,mutate:async()=>shop};const pool=new WorkerPool(r,config,()=>{launches++;return child();});
 try{
  assert.equal(launches,0);await pool.update(shop,{update_id:1});await pool.update(shop,{update_id:1});assert.equal(launches,1);
  const first=pool.entries.get(shop.id);first.busy=1;
  const queued=pool.update({...shop,id:'s_'+'b'.repeat(24)},{update_id:2});
  assert.equal(pool.queuedRequests,1);assert.equal(launches,1);
  first.busy=0;first.lastUsed=0;pool.evict();await queued;
  assert.equal(launches,2);assert.ok(pool.entries.size<=1);
 }finally{await pool.close();}
});
test('Twenty concurrent shops share one process slot without capacity retries or duplicate updates',async()=>{
 let live=0,peak=0,launches=0,delivered=0;
 const r={config,get:async()=>shop,mutate:async()=>shop};
 const pool=new WorkerPool(r,{...config,maxShops:20},()=>{
  const p=child();launches++;live++;peak=Math.max(peak,live);
  p.once('exit',()=>live--);const send=p.send;p.send=(m,cb)=>{if(m.type==='telegram_update')delivered++;send(m,cb);};return p;
 });
 try{
  const shops=Array.from({length:20},(_,i)=>({...shop,id:'s_'+(i+1).toString(16).padStart(24,'0')}));
  await Promise.all(shops.flatMap(s=>[pool.update(s,{update_id:1}),pool.update(s,{update_id:1})]));
  assert.equal(launches,20);assert.equal(peak,1);assert.equal(delivered,20);assert.equal(pool.queuedRequests,0);
 }finally{await pool.close();}
});
test('Pool queue has a hard bound, expires waiters and rejects them on shutdown',async()=>{
 const r={config,get:async()=>shop,mutate:async()=>shop};
 const pool=new WorkerPool(r,{...config,queueLimit:2,queueWaitMs:25},()=>child());
 try{
  await pool.update(shop,{update_id:1});pool.entries.get(shop.id).busy=1;
  const other=i=>({...shop,id:'s_'+String(i).repeat(24)});
  const first=pool.update(other(1),{update_id:2});const second=pool.update(other(2),{update_id:2});
  const expiry=Promise.all([assert.rejects(first,/WORKER_QUEUE_TIMEOUT/),assert.rejects(second,/WORKER_QUEUE_TIMEOUT/)]);
  await assert.rejects(pool.update(other(3),{update_id:2}),/WORKER_QUEUE_FULL/);await expiry;
  assert.equal(pool.queuedRequests,0);
  const pending=pool.update(other(4),{update_id:3});const stopped=assert.rejects(pending,/HOST_RESTARTING/);
  await pool.close();await stopped;
 }finally{await pool.close();}
});
test('Public registry views never include credentials or credential fingerprints',()=>{const r=new Registry(config),v=r.view({...shop,bot_token:'MUST_NOT_ESCAPE',token_fingerprint:'private-hash'});for(const secret of ['secret_box','MUST_NOT_ESCAPE','fingerprint','private-hash','encrypted'])assert.ok(!JSON.stringify(v).includes(secret));assert.ok(v.dashboard_url.includes('nss_fixture_bot?start=wwc_'));});
test('Controller rejects replay, forged actors and non-owner super actions before writes',async()=>{
 const nonces=new Set();let writes=0;const r={config,db:{},get:async()=>shop,list:async owner=>owner===456?[shop]:[],view:x=>x,secrets:()=>({botToken:'fake'}),rpc:async(name,{p_nonce})=>{if(nonces.has(p_nonce))return false;nonces.add(p_nonce);return true;},mutate:async()=>{writes++;return shop;}};const pool={entries:new Map(),failures:new Map(),stop(){}};const{server}=makePlatformServer(r,pool);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 async function call(action,value,nonce='x'.repeat(20)+Math.random().toString(16).slice(2)){const path='/platform/v1/'+action,body=Buffer.from(JSON.stringify(value)),time=String(Math.floor(Date.now()/1000));return fetch(base+path,{method:'POST',body,headers:{'x-wwc-time':time,'x-wwc-nonce':nonce,'x-wwc-signature':sec.signature(secret,'POST',path,time,nonce,body)}});}
 try{let res=await call('list',{actor_id:456});assert.equal(res.status,200);assert.equal((await res.json()).shops.length,1);assert.equal((await call('grant',{actor_id:456,shop_id:shop.id,receipt:'manual:fake-charge'})).status,403);assert.equal((await call('pause',{actor_id:789,shop_id:shop.id})).status,403);assert.equal(writes,0);const nonce='r'.repeat(30);assert.equal((await call('config',{actor_id:456},nonce)).status,200);assert.equal((await call('config',{actor_id:456},nonce)).status,409);assert.equal((await fetch(base+'/platform/v1/list',{method:'POST',body:'{}'})).status,401);}finally{await new Promise(r=>server.close(r));}
});
