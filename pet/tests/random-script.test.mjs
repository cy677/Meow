import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStore} from '../store.mjs';
const catalog=JSON.parse(readFileSync(new URL('../rewards.json',import.meta.url),'utf8'));

test('script membership persists independently of purchase, balance, outfit and photo access',t=>{
  const dir=mkdtempSync(join(tmpdir(),'meow-script-')),path=join(dir,'test.sqlite');
  let store=createStore(path,catalog);t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  assert.throws(()=>store.setRandomScript('pose-banana',true),e=>e.status===403);
  store.points({delta:500,reason:'测试奖励',idempotencyKey:randomUUID()});
  for(const id of ['pose-banana','trick-jump']){
    const reward=store.catalog().rewards.find(r=>r.id===id);
    store.purchase({rewardId:id,expectedCost:reward.cost,idempotencyKey:randomUUID()});
    assert.equal(store.snapshot().rewards.find(r=>r.id===id).inRandomScript,id==='trick-jump');
    const before=store.snapshot();
    store.setRandomScript(id,true);store.setRandomScript(id,true);
    assert.ok(store.snapshot().randomScript.some(r=>r.id===id));
    store.setRandomScript(id,false);
    const after=store.snapshot();
    assert.equal(after.balance,before.balance);assert.equal(after.lifetime,before.lifetime);
    assert.deepEqual(after.owned,before.owned);assert.deepEqual(after.equipped,before.equipped);
    assert.deepEqual(after.ledger,before.ledger);
    assert.ok(!after.randomScript.some(r=>r.id===id));
    assert.ok(after.access.poseOptions.some(p=>p.params.pose==='banana'));
  }
  store.setRandomScript('pose-banana',true);
  assert.throws(()=>store.setRandomScript('coat-orange',true),e=>e.status===400);
  assert.throws(()=>store.setRandomScript('pose-banana','false'),e=>e.status===400);
  store.close();store=createStore(path,catalog);
  assert.equal(store.snapshot().rewards.find(r=>r.id==='pose-banana').inRandomScript,true);
  assert.equal(store.snapshot().rewards.find(r=>r.id==='trick-jump').inRandomScript,false);
  assert.equal(store.play('trick-jump').action,'jump');
});
