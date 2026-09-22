import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../store.mjs';
import {validateCatalog} from '../catalog.mjs';
import {MODEL_DEFINITIONS,MODEL_REWARDS,MODEL_SLOTS,modelSlot,equippedModels} from '../modelCatalog.mjs';
const base=JSON.parse(readFileSync(new URL('../rewards.json',import.meta.url)));
const fresh=t=>{const s=createStore(':memory:',base);t.after(()=>s.close());s.installSceneRewards();s.installModelRewards();return s;};
const fund=s=>{for(let i=0;i<3;i++)s.points({delta:500,reason:'测试模型奖励',idempotencyKey:randomUUID()});};
const buy=(s,id)=>s.purchase({rewardId:id,expectedCost:s.catalog().rewards.find(r=>r.id===id).cost,idempotencyKey:randomUUID()});

test('14 real model rewards use 10 independent bounded slots and validate',()=>{
 assert.equal(MODEL_REWARDS.length,14);assert.equal(MODEL_SLOTS.length,10);
 assert.equal(validateCatalog({...base,rewards:[...base.rewards,...MODEL_REWARDS]}).rewards.length,base.rewards.length+14);
 assert.equal(new Set(MODEL_REWARDS.map(r=>r.id)).size,14);
});
test('model migration preserves original ownership, exact ledger rows, prices and balances; idempotent',t=>{
 const s=createStore(':memory:',base);t.after(()=>s.close());fund(s);buy(s,'coat-grey');s.equip('coat-grey');
 const c=s.catalog();c.rewards.find(r=>r.id==='coat-grey').cost=123;s.saveCatalog(c);
 const before=s.snapshot(),rows=s.exportData().ledger;s.installModelRewards();const first=s.snapshot();s.installModelRewards();
 assert.deepEqual(s.snapshot(),first);assert.equal(first.balance,before.balance);assert.equal(first.lifetime,before.lifetime);assert.deepEqual(first.owned,before.owned);assert.deepEqual(first.equipped,before.equipped);
 assert.equal(s.catalog().rewards.find(r=>r.id==='coat-grey').cost,123);
 for(const row of rows)assert.deepEqual(s.exportData().ledger.find(r=>r.id===row.id),row);
});
test('all models reject unowned equip; car/ramp/bricks/furniture coexist; swapping and removal never charge again',t=>{
 const s=fresh(t);fund(s);for(const r of MODEL_REWARDS){assert.throws(()=>s.equip(r.id),e=>e.status===403);buy(s,r.id);s.equip(r.id);}
 let state=s.snapshot();assert.equal(state.models.length,10);assert.equal(state.models.filter(x=>['chick','bunny'].includes(x)).length,1);
 assert.ok(state.models.includes('truck')&&state.models.includes('ramp')&&state.models.includes('bricks-color'));
 const balance=state.balance;s.equip('kenney-car');s.unequip('model-ramp');state=s.snapshot();assert.ok(state.models.includes('car'));assert.ok(!state.models.includes('ramp'));assert.ok(state.owned.includes('kenney-ramp'));assert.equal(state.balance,balance);
 assert.throws(()=>s.unequip('__proto__'),e=>e.status===400);
 for(const r of state.rewards.filter(r=>r.category==='model'))assert.equal(r.equipped,state.equipped[r.modelSlot]===r.id);
});
test('model snapshots and prices cannot supply arbitrary paths, scripts, models or identity changes',t=>{
 const s=fresh(t);
 for(const patch of [{url:'https://evil.invalid/x.glb'},{modelId:'../../etc/passwd'},{modelId:'dog'},{script:'alert(1)'},{modelId:'bunny'}]){
  const c=s.catalog();Object.assign(c.rewards.find(r=>r.id==='kenney-chick').params,patch);assert.throws(()=>s.saveCatalog(c),e=>e.status===400);
 }
 const c=s.catalog();c.rewards.find(r=>r.id==='kenney-chick').cost=7;s.saveCatalog(c);s.installModelRewards();assert.equal(s.catalog().rewards.find(r=>r.id==='kenney-chick').cost,7);
 assert.deepEqual(equippedModels(c,{companion:'kenney-chick'},[]),[]);
});
test('model upgrade ID conflicts fail without partial catalogue or data mutations',t=>{
 const s=createStore(':memory:',base);t.after(()=>s.close());const c=s.catalog();c.rewards.push({...c.rewards.find(r=>r.id==='coat-grey'),id:'kenney-chick'});s.saveCatalog(c);const before=s.exportData();
 assert.throws(()=>s.installModelRewards(),e=>e.status===409);assert.deepEqual(s.catalog(),before.catalog);assert.equal(s.getSetting('modelRewardsVersion'),undefined);
});
test('model equipment does not invalidate a parent creation',t=>{
 const s=fresh(t);fund(s);const c=s.catalog();c.rewards.push({id:'test-creation',title:'测试作品',description:'保留家长完整作品',category:'creation',cost:0,unlockAt:0,preset:{params:{pose:'standing'}}});s.saveCatalog(c);s.equip('test-creation');buy(s,'kenney-table');s.equip('kenney-table');assert.equal(s.snapshot().creation.id,'test-creation');assert.equal(s.snapshot().rewards.find(r=>r.id==='kenney-table').equipped,true);s.unequip('furniture-table');assert.equal(s.snapshot().creation.id,'test-creation');
});
test('equipped models and parent price edits survive a real SQLite restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'meow-models-'));let s;
 try{const file=join(dir,'pet.sqlite');s=createStore(file,base);s.installModelRewards();fund(s);buy(s,'kenney-chick');s.equip('kenney-chick');const c=s.catalog();c.rewards.find(r=>r.id==='kenney-bunny').cost=9;s.saveCatalog(c);const before=s.snapshot();s.close();s=createStore(file,base);s.installModelRewards();assert.deepEqual(s.snapshot(),before);assert.equal(s.catalog().rewards.find(r=>r.id==='kenney-bunny').cost,9);}finally{s?.close();rmSync(dir,{recursive:true,force:true});}
});
test('vendored assets match audit hashes, preserve CC0, embed textures and contain real animal clips',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../../third_party/kenney/manifest.json',import.meta.url)));
 assert.equal(manifest.models.length,22);assert.equal(manifest.packs.length,4);
 for(const p of manifest.packs)assert.match(readFileSync(new URL(`../../third_party/kenney/${p.id}/License.txt`,import.meta.url),'utf8'),/Creative Commons Zero, CC0/);
 const files=new Set(manifest.models.map(m=>m.file));
 for(const def of MODEL_DEFINITIONS)for(const file of def.files||[def.file])assert.ok(files.has('public/'+file),file);
 for(const item of manifest.models){
  const buffer=readFileSync(new URL('../../'+item.file,import.meta.url));assert.equal(createHash('sha256').update(buffer).digest('hex'),item.sha256);
  assert.equal(buffer.readUInt32LE(8),buffer.length);const gltf=JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)));
  for(const ref of [...(gltf.buffers||[]),...(gltf.images||[])])assert.ok(!ref.uri||ref.uri.startsWith('data:'));
  if(item.pack==='cube-pets')for(const name of ['idle','walk','gesture-positive'])assert.ok(gltf.animations.some(a=>a.name===name));
 }
});
