import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from '../store.mjs';
import { createPetServer } from '../server.mjs';
import { validateCatalog, composeParams, DEFAULT_PARAMS } from '../catalog.mjs';
const base=JSON.parse(readFileSync(new URL('../rewards.json',import.meta.url),'utf8'));
const key=()=>randomUUID();
const buy=(id,cost)=>({rewardId:id,expectedCost:cost,idempotencyKey:key()});
const grant=(delta=100)=>({delta,reason:'认真阅读',idempotencyKey:key()});
const fresh=t=>{const s=createStore(':memory:',base);t.after(()=>s.close());return s;};
const throws=(fn,status)=>assert.throws(fn,e=>e.status===status);

test('初始四个槽位免费，参数从原生成器默认值组合',t=>{const s=fresh(t),p=s.snapshot();assert.equal(p.balance,0);assert.equal(p.lifetime,0);assert.equal(p.owned.length,4);assert.deepEqual(p.params,DEFAULT_PARAMS);assert.equal(p.rewards.length,20);});
test('加分、自动成长礼物、兑换余额与累计成长分分离',t=>{const s=fresh(t);s.points(grant(50));assert.ok(s.snapshot().owned.includes('coat-cream'));s.purchase(buy('coat-grey',25));assert.equal(s.snapshot().balance,25);assert.equal(s.snapshot().lifetime,50);s.equip('coat-grey');assert.equal(s.snapshot().params.coatId,'greyTabby');});
test('相同加分请求重放只执行一次，ID 用于不同内容会被拒绝',t=>{const s=fresh(t),g=grant(10);s.points(g);s.points(g);assert.equal(s.snapshot().balance,10);throws(()=>s.points({...g,delta:20}),409);assert.equal(s.snapshot().balance,10);});
test('购买重放和不同请求 ID 重复购买均不重复扣款',t=>{const s=fresh(t);s.points(grant(60));const b=buy('coat-grey',25);s.purchase(b);s.purchase(b);s.purchase(buy('coat-grey',25));assert.equal(s.snapshot().balance,35);assert.equal(s.exportData().ledger.filter(r=>r.kind==='purchase').length,1);});
test('不足余额、未达成长门槛、未知奖励都不能兑换',t=>{const s=fresh(t);throws(()=>s.purchase(buy('coat-calico',40)),409);s.points(grant(80));s.points(grant(-75));throws(()=>s.purchase(buy('coat-calico',40)),409);throws(()=>s.purchase(buy('not-a-cat',1)),404);assert.equal(s.snapshot().balance,5);});
test('未解锁的外形、姿态及互动不能直接使用',t=>{const s=fresh(t);throws(()=>s.equip('shape-round'),403);throws(()=>s.equip('pose-banana'),403);throws(()=>s.play('trick-jump'),403);s.points(grant(20));s.purchase(buy('trick-jump',15));assert.equal(s.play('trick-jump').action,'jump');throws(()=>s.equip('trick-jump'),400);});
test('重新装备重置整个槽位，不泄漏上一次的蓬松/异瞳参数',t=>{const s=fresh(t);s.points(grant(200));s.purchase(buy('shape-fluffy',50));s.equip('shape-fluffy');assert.equal(s.snapshot().params.fluffy,true);s.equip('shape-original');assert.equal(s.snapshot().params.fluffy,false);s.purchase(buy('eyes-odd',60));s.equip('eyes-odd');assert.equal(s.snapshot().params.oddEyes,true);s.equip('eyes-amber');assert.equal(s.snapshot().params.oddEyes,false);});
test('积分更正不降低成长或回收已有奖励，不能透支',t=>{const s=fresh(t);s.points(grant(30));s.points(grant(-10));assert.equal(s.snapshot().lifetime,30);assert.ok(s.snapshot().owned.includes('coat-cream'));throws(()=>s.points(grant(-21)),409);assert.equal(s.snapshot().balance,20);});
test('拒绝小数、字符串、超额积分、空原因',t=>{const s=fresh(t);for(const delta of [0,1.1,'10',10001,NaN,Infinity])throws(()=>s.points({...grant(),delta}),400);throws(()=>s.points({...grant(),reason:' '}),400);assert.equal(s.snapshot().balance,0);});
test('目录严格校验 ID、动作、参数白名单、颜色、数量与原型污染',()=>{
  const cases=[c=>c.rewards.push(c.rewards[0]),c=>c.rewards[0].params.coatId='invalid',c=>c.rewards[1].params.headSize=99,c=>c.rewards[2].params.eyeColor='javascript:alert(1)',c=>c.rewards[5].action='eval',c=>c.rewards[4].params.points=1000,c=>delete c.rewards[0].starter,c=>c.rewards[0].cost=5,c=>c.rewards[0].unlockAt=-1,c=>c.extra=true];
  for(const change of cases){const c=structuredClone(base);change(c);throws(()=>validateCatalog(c),400);}
  const c=structuredClone(base);c.rewards[1].params=JSON.parse('{"__proto__":{"polluted":true}}');throws(()=>validateCatalog(c),400);assert.equal({}.polluted,undefined);
});
test('目录修改保留稳定 ID；无效修改全量回滚',t=>{const s=fresh(t),before=s.catalog();const changed=structuredClone(before);changed.rewards=changed.rewards.filter(r=>r.id!=='coat-grey');throws(()=>s.saveCatalog(changed),409);assert.deepEqual(s.catalog(),before);const ok=structuredClone(before);ok.rewards.find(r=>r.id==='coat-grey').cost=5;s.saveCatalog(ok);assert.equal(s.catalog().rewards.find(r=>r.id==='coat-grey').cost,5);});
test('确认价格过期或伪造更低价格不能扣款',t=>{const s=fresh(t);s.points(grant(100));throws(()=>s.purchase(buy('coat-grey',1)),409);const c=s.catalog();c.rewards.find(r=>r.id==='coat-grey').cost=30;s.saveCatalog(c);throws(()=>s.purchase(buy('coat-grey',25)),409);assert.equal(s.snapshot().balance,100);});
test('进度、解锁、配置修改、请求幂等记录在重启后保留',()=>{const dir=mkdtempSync(join(tmpdir(),'meow-persist-'));try{const path=join(dir,'pet.sqlite'),g=grant(100);let s=createStore(path,base);s.points(g);s.purchase(buy('coat-calico',40));s.equip('coat-calico');const c=s.catalog();c.rewards.find(r=>r.id==='trick-jump').cost=3;s.saveCatalog(c);s.close();s=createStore(path,base);assert.equal(s.snapshot().balance,60);assert.equal(s.snapshot().params.coatId,'calico');assert.equal(s.catalog().rewards.find(r=>r.id==='trick-jump').cost,3);s.points(g);assert.equal(s.snapshot().balance,60);s.close();}finally{rmSync(dir,{recursive:true,force:true});}});
test('导出含完整流水但不包含账户凭据',t=>{const s=fresh(t);for(let i=0;i<105;i++)s.points(grant(1));const result=s.exportData();assert.equal(result.profile.ledger.length,100);assert.equal(result.ledger.filter(r=>r.kind==='earn').length,105);assert.ok(!JSON.stringify(result).includes('tokenHash'));assert.ok(!JSON.stringify(result).includes('credentials'));});

async function fixture(t) {
  const app=await createPetServer({dbPath:':memory:'});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(()=>app.close());
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  async function request(path,{role='none',method='GET',data,headers={},cookie,csrf}={}) {
    const session=roles[role]||{};
    // Fetch normalizes Host. Use an actual raw HTTP request for rebinding tests.
    if(headers.Host)return await new Promise((resolve,reject)=>{const req=http.get(origin+path,{headers},res=>{let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(data),headers:res.headers}));});req.on('error',reject);});
    const response=await fetch(origin+path,{method,headers:{...(data===undefined?{}:{'Content-Type':'application/json','X-Meow-Client':'points-pet','X-CSRF-Token':csrf??session.csrf??''}),Cookie:cookie??session.cookie??'',...headers},...(data===undefined?{}:{body:typeof data==='string'?data:JSON.stringify(data)})});
    return {status:response.status,data:await response.json(),headers:response.headers};
  }
  const roles={};
  const result=await request('/api/parent/setup',{method:'POST',data:{setupToken:app.setupToken,pin:'864209',childCode:'2468',childName:'测试小朋友',petName:'小橘'}});
  assert.equal(result.status,200);
  roles.parent={cookie:result.headers.get('set-cookie').split(';')[0],csrf:result.data.csrf};
  const login=await request('/api/child/login',{method:'POST',data:{code:'2468'}});
  assert.equal(login.status,200);roles.child={cookie:login.headers.get('set-cookie').split(';')[0],csrf:login.data.csrf};
  return {app,request,roles,origin};
}
test('HTTP：未登录与孩子会话均不能加分或读取家长导出',async t=>{const {request}=await fixture(t);for(const role of ['none','child']){assert.equal((await request('/api/parent/points',{role,method:'POST',data:grant(100)})).status,401);assert.equal((await request('/api/parent/export',{role})).status,401);}assert.equal((await request('/api/state',{role:'child'})).data.balance,0);});
test('HTTP：家长/孩子会话隔离，需正确 CSRF 才能执行写操作',async t=>{const {request}=await fixture(t);assert.equal((await request('/api/parent/points',{role:'parent',method:'POST',data:grant(),csrf:'wrong'})).status,403);assert.equal((await request('/api/purchase',{role:'parent',method:'POST',data:buy('pose-stretch',10)})).status,401);assert.equal((await request('/api/parent/points',{role:'parent',method:'POST',data:grant(30)})).status,200);const state=await request('/api/state',{role:'child'});assert.equal(state.data.balance,30);assert.ok(!('params' in state.data.rewards[0]));});
test('HTTP：完整加分、购买、装扮、动作、查询配置链路',async t=>{const {request}=await fixture(t);await request('/api/parent/points',{role:'parent',method:'POST',data:grant(100)});for(const [rewardId,expectedCost]of [['coat-calico',40],['trick-jump',0]])assert.equal((await request('/api/purchase',{role:'child',method:'POST',data:{rewardId,expectedCost,idempotencyKey:key()}})).status,200);assert.equal((await request('/api/equip',{role:'child',method:'POST',data:{rewardId:'coat-calico'}})).status,200);assert.equal((await request('/api/play',{role:'child',method:'POST',data:{rewardId:'trick-jump'}})).data.action,'jump');const c=(await request('/api/pet/config',{role:'child'})).data;assert.equal(c.params.coatId,'calico');assert.equal(c.actions.length,14);assert.ok(c.actions.some(a=>a.action==='jump'));assert.ok(c.actions.some(a=>a.action==='idle'));});
test('HTTP：并发购买不会造成透支，重复请求只扣一次',async t=>{const {request}=await fixture(t);await request('/api/parent/points',{role:'parent',method:'POST',data:grant(80)});await request('/api/parent/points',{role:'parent',method:'POST',data:grant(-30)});const results=await Promise.all([request('/api/purchase',{role:'child',method:'POST',data:buy('coat-grey',25)}),request('/api/purchase',{role:'child',method:'POST',data:buy('coat-calico',40)})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const p=(await request('/api/state',{role:'child'})).data;assert.ok(p.balance===25||p.balance===10);assert.equal(p.lifetime,80);const g=grant(5);const parallel=await Promise.all(Array.from({length:8},()=>request('/api/parent/points',{role:'parent',method:'POST',data:g})));assert.ok(parallel.every(r=>r.status===200));assert.equal((await request('/api/state',{role:'child'})).data.balance,p.balance+5);});
test('HTTP：拒绝跨来源请求、伪造 Host、非 JSON 与多余字段',async t=>{const {request}=await fixture(t);assert.equal((await request('/api/parent/points',{role:'parent',method:'POST',data:grant(),headers:{Origin:'https://evil.example'}})).status,403);assert.equal((await request('/api/status',{headers:{Host:'evil.example:8792'}})).status,403);assert.equal((await request('/api/parent/points',{role:'parent',method:'POST',data:grant(),headers:{'Content-Type':'text/plain'}})).status,415);assert.equal((await request('/api/parent/points',{role:'parent',method:'POST',data:grant(),headers:{'X-Meow-Client':''}})).status,403);assert.equal((await request('/api/purchase',{role:'child',method:'POST',data:{...buy('coat-grey',25),cost:0,balance:100000}})).status,400);});
test('HTTP：未拥有的奖励不能通过接口直接装备/播放',async t=>{const {request}=await fixture(t);assert.equal((await request('/api/equip',{role:'child',method:'POST',data:{rewardId:'coat-white'}})).status,403);assert.equal((await request('/api/play',{role:'child',method:'POST',data:{rewardId:'trick-spin'}})).status,403);});
test('HTTP：错误密码限速；Cookie 采用 HttpOnly/SameSite',async t=>{const {request}=await fixture(t);for(let i=0;i<5;i++)assert.equal((await request('/api/parent/login',{method:'POST',data:{code:'000000'}})).status,401);assert.equal((await request('/api/parent/login',{method:'POST',data:{code:'864209'}})).status,429);const login=await request('/api/child/login',{method:'POST',data:{code:'2468'}});assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);});
test('HTTP：退出及 15 分钟过期会真正吊销会话',async t=>{const {app,request}=await fixture(t);await request('/api/child/logout',{role:'child',method:'POST',data:{}});assert.equal((await request('/api/state',{role:'child'})).status,401);app.store.db.prepare("UPDATE sessions SET expires=0 WHERE role='parent'").run();assert.equal((await request('/api/parent/points',{role:'parent',method:'POST',data:grant()})).status,401);});
test('HTTP：修改孩子进入码吊销已有孩子会话，密码不以明文储存',async t=>{const {app,request}=await fixture(t);assert.equal((await request('/api/parent/credentials',{role:'parent',method:'PUT',data:{currentPin:'864209',childCode:'3579'}})).status,200);assert.equal((await request('/api/state',{role:'child'})).status,401);assert.equal((await request('/api/child/login',{method:'POST',data:{code:'2468'}})).status,401);assert.equal((await request('/api/child/login',{method:'POST',data:{code:'3579'}})).status,200);for(const c of app.store.db.prepare('SELECT * FROM credentials').all()){assert.equal(c.hash.length,128);assert.equal(c.salt.length,32);assert.ok(!c.hash.includes('864209'));}});
test('HTTP：初始化只能执行一次，静态服务不泄露数据库/源码',async t=>{const {request}=await fixture(t);assert.equal((await request('/api/parent/setup',{method:'POST',data:{setupToken:'guess',pin:'123456',childCode:'1234',childName:'x',petName:'x'}})).status,403);for(const path of ['/data/pet.sqlite','/server.mjs','/../pet/server.mjs','/api/not-real'])assert.ok([401,404].includes((await request(path)).status));});
