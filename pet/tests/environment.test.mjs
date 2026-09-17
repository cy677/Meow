import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStore} from '../store.mjs';
import {validateCatalog,DEFAULT_PARAMS} from '../catalog.mjs';
import {SCENE_CATALOG_ADDITIONS,SCENE_STARTERS,SCENE_REWARDS,SCENE_THEMES} from '../environmentRewards.mjs';
import {SCENE_SLOTS,DEFAULT_SCENE,SCENE_FIELDS} from '../environmentSchema.mjs';
import {createPetServer} from '../server.mjs';
const base=JSON.parse(readFileSync(new URL('../rewards.json',import.meta.url)));
const award=(store,n=500)=>store.points({delta:n,reason:'完成家务，奖励积分',idempotencyKey:randomUUID()});
const buy=(s,id,key=randomUUID())=>s.purchase({rewardId:id,expectedCost:s.catalog().rewards.find(r=>r.id===id).cost,idempotencyKey:key});
const fresh=t=>{const s=createStore(':memory:',base);t.after(()=>s.close());s.installSceneRewards();return s;};
test('all original scene types and bundles validate, eight independent fallback slots',()=>{
 const c=validateCatalog({...base,rewards:[...base.rewards,...SCENE_CATALOG_ADDITIONS]});
 assert.equal(c.rewards.length,68);assert.equal(SCENE_STARTERS.length,8);
 for(const slot of SCENE_SLOTS)assert.equal(c.rewards.filter(r=>r.starter&&r.category===slot).length,1);
 assert.equal(SCENE_REWARDS.filter(r=>r.category==='rug').length,7);
 assert.equal(SCENE_REWARDS.filter(r=>r.category==='bed').length,7);
});
test('local migration is idempotent and does not reset progress or overwrite old catalog',t=>{
 const s=createStore(':memory:',base);t.after(()=>s.close());award(s,120);buy(s,'coat-grey');s.equip('coat-grey');
 const before=s.snapshot(),ledger=s.exportData().ledger;
 s.installSceneRewards();s.installSceneRewards();const after=s.snapshot();
 assert.equal(after.balance,before.balance);assert.equal(after.lifetime,before.lifetime);assert.equal(after.equipped.coat,'coat-grey');
 assert.deepEqual(after.params,before.params);assert.equal(after.rewards.length,68);assert.equal(after.owned.length,before.owned.length+8);
 for(const row of ledger)assert.deepEqual(s.exportData().ledger.find(x=>x.id===row.id),row);
 assert.deepEqual(after.sceneParams,DEFAULT_SCENE);
});
test('all eight scene categories reject unowned equip then buy/equip persists composition',t=>{
 const s=fresh(t);award(s);
 for(const slot of SCENE_SLOTS){
   const r=SCENE_REWARDS.find(r=>r.category===slot);
   assert.throws(()=>s.equip(r.id),e=>e.status===403);
   buy(s,r.id);s.equip(r.id);assert.equal(s.snapshot().equipped[slot],r.id);
   assert.deepEqual(s.snapshot().sceneParams[slot],r.params);
 }
 assert.deepEqual(s.snapshot().params,DEFAULT_PARAMS);
});
test('unequip selects the local fallback without refund or revoking ownership',t=>{
 const s=fresh(t);award(s);buy(s,'scene-bed-basket');s.equip('scene-bed-basket');
 const p=s.snapshot();s.unequip('bed');const n=s.snapshot();assert.equal(n.balance,p.balance);assert.ok(n.owned.includes('scene-bed-basket'));assert.equal(n.sceneParams.bed.kind,'none');
 assert.throws(()=>s.unequip('coat'),e=>e.status===400);
});
test('theme purchase atomically grants members once; equip applies all and single-slot change invalidates theme marker',t=>{
 const s=fresh(t);award(s);const theme=SCENE_THEMES[0],key=randomUUID();
 buy(s,theme.id,key);buy(s,theme.id,key);assert.equal(s.snapshot().balance,500-theme.cost);
 for(const id of Object.values(theme.params.members))assert.ok(s.snapshot().owned.includes(id));
 s.equip(theme.id);for(const [slot,id]of Object.entries(theme.params.members))assert.equal(s.snapshot().equipped[slot],id);
 s.unequip('rug');assert.equal(s.snapshot().equipped.theme,undefined);assert.equal(s.snapshot().sceneParams.rug.style,'none');
 const row=s.exportData().ledger.find(l=>l.kind==='purchase'&&l.rewardId===theme.id);
 assert.equal(row.memberSnapshots,undefined);
 assert.equal(row.rewardSnapshot.memberSnapshots.length,Object.keys(theme.params.members).length);
});
test('theme ownership is not bypassed through malformed members, nested bundle or changed members',t=>{
 const s=fresh(t);
 for(const params of [{members:{floor:'coat-orange'}},{members:{floor:SCENE_THEMES[0].id}},{members:{}},{members:{bogus:'scene-floor-oak'}}]){
   const c=s.catalog();c.rewards.push({...SCENE_THEMES[0],id:'custom-theme-invalid',params});assert.throws(()=>s.saveCatalog(c));
 }
 const c=s.catalog();c.rewards.find(r=>r.id===SCENE_THEMES[0].id).params.members.floor='scene-floor-blue';assert.throws(()=>s.saveCatalog(c),e=>e.status===409);
});
test('all scene fields reject invalid type, extra network/code fields and unsafe ranges',t=>{
 const s=fresh(t);
 for(const slot of SCENE_SLOTS){
   const c=s.catalog(),r=c.rewards.find(r=>r.category===slot&&!r.starter);
   r.params.url='https://example.invalid/payload';assert.throws(()=>s.saveCatalog(c),e=>e.status===400);
   const d=s.catalog(),item=d.rewards.find(r=>r.category===slot&&!r.starter);
   const numeric=SCENE_FIELDS[slot].find(f=>f.type==='number');item.params[numeric.key]=numeric.max+1;
   assert.throws(()=>s.saveCatalog(d),e=>e.status===400);
 }
 const c=s.catalog();c.rewards.find(r=>r.id==='scene-fog-soft').params.near=20;c.rewards.find(r=>r.id==='scene-fog-soft').params.far=8;
 assert.throws(()=>s.saveCatalog(c),e=>e.status===400);
});
test('zero-cost scene milestone only grants at threshold, never silently equips it',t=>{
 const s=fresh(t),c=s.catalog(),r=c.rewards.find(r=>r.id==='scene-rug-pizza');r.cost=0;r.unlockAt=10;s.saveCatalog(c);
 assert.ok(!s.snapshot().owned.includes(r.id));award(s,10);assert.ok(s.snapshot().owned.includes(r.id));assert.equal(s.snapshot().sceneParams.rug.style,'none');
});
test('disk restart preserves scene presets, bundle snapshots and equipped room; migration never reapplies defaults',()=>{
 const dir=mkdtempSync(join(tmpdir(),'meow-room-'));let s;
 try{
  const path=join(dir,'pet.sqlite');s=createStore(path,base);s.installSceneRewards();award(s);
  buy(s,'scene-theme-cozy');s.equip('scene-theme-cozy');
  const c=s.catalog();c.rewards.find(r=>r.id==='scene-floor-oak').params.grainDensity=1.2;s.saveCatalog(c);
  const before=s.snapshot(),history=s.exportData().ledger;s.close();
  s=createStore(path,base);s.installSceneRewards();assert.deepEqual(s.snapshot(),before);assert.deepEqual(s.exportData().ledger,history);
  const old=history.find(l=>l.rewardId==='scene-theme-cozy'&&l.kind==='purchase').rewardSnapshot.memberSnapshots.find(r=>r.id==='scene-floor-oak');
  assert.equal(old.params.grainDensity,.72);
 }finally{s?.close();rmSync(dir,{recursive:true,force:true});}
});
test('HTTP child scene writes are role/CSRF checked, returned config includes only equipped state',async t=>{
 const a=await createPetServer({dbPath:':memory:'});await new Promise(r=>a.server.listen(0,'127.0.0.1',r));t.after(()=>a.close());
 const origin=`http://127.0.0.1:${a.server.address().port}`,headers={'Content-Type':'application/json','X-Meow-Client':'points-pet'};
 const setup=await fetch(origin+'/api/parent/setup',{method:'POST',headers,body:JSON.stringify({setupToken:a.setupToken,pin:'864209',childCode:'2468',childName:'test',petName:'cat'})});assert.equal(setup.status,200);
 const login=await fetch(origin+'/api/child/login',{method:'POST',headers,body:JSON.stringify({code:'2468'})});const auth=await login.json();
 const h={...headers,Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':auth.csrf};
 for(const [path,data,status]of [
  ['/api/equip',{rewardId:'scene-floor-oak'},403],['/api/parent/presets',{},401],['/api/unequip',{slot:'__proto__'},400]
 ])assert.equal((await fetch(origin+path,{method:'POST',headers:h,body:JSON.stringify(data)})).status,status);
 assert.equal((await fetch(origin+'/api/unequip',{method:'POST',headers:{...h,'X-CSRF-Token':'bad'},body:JSON.stringify({slot:'rug'})})).status,403);
 const config=await(await fetch(origin+'/api/pet/config',{headers:h})).json();assert.deepEqual(config.sceneParams,DEFAULT_SCENE);
});
