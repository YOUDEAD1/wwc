import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
test('Compiled free worker handles real admin updates and HTTP without live services', {timeout:45000}, async()=>{
  const root=new URL('../',import.meta.url),id='s_'+'a'.repeat(24);
  const child=fork(fileURLToPath(new URL('dist/src/tenant-worker.js',root)),[],{
    cwd:fileURLToPath(root),execArgv:['--max-old-space-size=128','--import',fileURLToPath(new URL('tests/fixtures/offline-worker.mjs',root))],
    env:{PATH:process.env.PATH,IS_TENANT:'true',WWC_MANAGED:'1',TENANT_ID:id,TENANT_PLAN:'free',BOT_TOKEN:'123456789:OFFLINE_TEST_TOKEN_123456789',BOT_USERNAME:'offline_child_bot',ADMIN_USER_ID:'123',SUPABASE_URL:'https://offlinefixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'OFFLINE_NOT_REAL_KEY_123456789',BOT_MODE:'webhook',PUBLIC_BASE_URL:'https://platform.example',TENANT_API_BASE_PATH:'/shop/'+id,TENANT_SOURCE_URL:'https://nss.example/gateway',TENANT_SOURCE_KEY:'OFFLINE_NOT_REAL',LOG_LEVEL:'error'},
    stdio:['ignore','pipe','pipe','ipc']});
  let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  const backlog=[],waiters=[];
  child.on('message',m=>{const w=waiters.find(x=>x.p(m));if(w){waiters.splice(waiters.indexOf(w),1);clearTimeout(w.timer);w.resolve(m);}else backlog.push(m);});
  const wait=p=>new Promise((resolve,reject)=>{const index=backlog.findIndex(p);if(index>=0)return resolve(backlog.splice(index,1)[0]);const w={p,resolve,timer:setTimeout(()=>reject(Error('Worker timeout '+logs)),20000)};waiters.push(w);});
  try{
    await wait(m=>m.type==='ready');
    const user={id:123,is_bot:false,first_name:'Fixture',language_code:'en'},chat={id:123,type:'private'};
    child.send({type:'telegram_update',id:'admin',update:{update_id:1,message:{message_id:1,date:1,chat,from:user,text:'/admin',entities:[{type:'bot_command',offset:0,length:6}]}}});
    assert.equal((await wait(m=>m.type==='update_ack'&&m.id==='admin')).ok,true);
    child.send({type:'telegram_update',id:'blocked',update:{update_id:2,callback_query:{id:'q1',from:user,chat_instance:'fixture',data:'adm:prod:add',message:{message_id:2,date:1,chat,text:'Admin'}}}});
    assert.equal((await wait(m=>m.type==='update_ack'&&m.id==='blocked')).ok,true);
    child.send({type:'api_request',id:'docs',method:'GET',path:'/api',headers:{},body:''});
    const response=await wait(m=>m.type==='api_result'&&m.id==='docs');assert.equal(response.status,200);assert.match(response.body,/\/shop\/s_/);
    child.send({type:'benchmark'});const metrics=await wait(m=>m.type==='benchmark');
    assert.ok(metrics.heap<128*1024*1024);assert.ok(metrics.sessions>=1);assert.ok(metrics.requests<100);assert.ok(metrics.telegram.includes('sendMessage'));
    await mkdir(new URL('verification/',root),{recursive:true});await writeFile(new URL('verification/worker-metrics.json',root),JSON.stringify({...metrics,offline:true,live_services_tested:false},null,2));
  }finally{for(const w of waiters)clearTimeout(w.timer);child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}
});
