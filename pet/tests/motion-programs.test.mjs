import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CLIPS, ACTION_IDS, MOTION_REWARDS, planMotion, timelineLayers, validateScript } from '../motionPrograms.mjs';
import { validateCatalog } from '../catalog.mjs';
import { createStore } from '../store.mjs';
const source=JSON.parse(readFileSync(new URL('../../src/mesh2motionClips.json',import.meta.url),'utf8'));
const base=JSON.parse(readFileSync(new URL('../rewards.json',import.meta.url),'utf8'));
const sequence={id:'custom-sequence',title:'我的连续动作',description:'先警觉，再走路，最后坐下。',category:'trick',cost:20,unlockAt:20,action:'sequence',motion:{speed:1,intensity:0.85,transition:0.25,script:[{clip:'idle-alert',cycles:1,speed:1},{clip:'walk',cycles:2,speed:1},{clip:'sit',cycles:1,speed:1}]}};
test('14 native clip IDs match the upstream 19-bone/555-frame dataset',()=>{
 assert.equal(source.boneOrder.length,19);assert.equal(source.clips.reduce((n,c)=>n+c.samples.length,0),555);
 assert.deepEqual(CLIPS.map(c=>c.id).sort(),source.clips.map(c=>c.id).sort());
});
test('every action creates finite bounded timelines with complete, normalized layers',()=>{
 for(const id of ACTION_IDS){const p=planMotion(id,{},sequence.motion.script);assert.ok(p.duration>0&&p.duration<=90);
  for(let i=0;i<=300;i++){const layers=timelineLayers(p,p.duration*i/300);assert.ok(layers.length>0&&layers.length<=2);assert.ok(Math.abs(layers.reduce((n,l)=>n+l.weight,0)-1)<1e-7);assert.ok(layers.every(l=>Number.isFinite(l.progress)&&l.progress>=0&&l.progress<=1));}
 }
});
test('overlap uses both neighbouring source clips; weights meet continuously',()=>{
 const p=planMotion('sequence',{},sequence.motion.script),s=p.segments[1];
 assert.equal(timelineLayers(p,s.start).at(-1).weight,0);
 assert.ok(Math.abs(timelineLayers(p,s.start+s.overlap/2).at(-1).weight-.5)<1e-8);
 assert.ok(Math.abs(timelineLayers(p,s.start+s.overlap).at(-1).weight-1)<1e-8);
});
test('scripts reject unknown code, URLs, nested scripts, excessive length and unsafe speed',()=>{
 for(const script of [[],Array(9).fill({clip:'walk'}),[{clip:'eval'}],[{clip:'walk',url:'https://invalid.test'}],[{clip:'sequence'}],[{clip:'walk',cycles:5}],[{clip:'jump',cycles:2}],[{clip:'walk',speed:NaN}],[{clip:'walk',speed:3}]])assert.throws(()=>validateScript(script));
 assert.throws(()=>validateScript(JSON.parse('[{"clip":"walk","__proto__":{}}]')));
 assert.throws(()=>validateScript(Array(8).fill({clip:'howl',cycles:4,speed:.5})));
});
test('all parent sample rewards and a custom script validate without changing starter slots',()=>{
 const c=validateCatalog({...base,rewards:[...base.rewards,...MOTION_REWARDS,sequence]});assert.equal(c.rewards.filter(r=>r.starter).length,4);
 for(const invalid of [{...sequence,motion:{script:[{clip:'not-real'}]}},{...sequence,action:'jump'},{...sequence,motion:{}},{...sequence,motion:{intensity:3}}])assert.throws(()=>validateCatalog({...base,rewards:[...base.rewards,invalid]}));
});
test('locked scripts cannot play; purchased scripts and their snapshots persist on disk',()=>{
 const dir=mkdtempSync(join(tmpdir(),'meow-motion-')),path=join(dir,'pet.sqlite');let s;
 try{s=createStore(path,base);s.saveCatalog({...base,rewards:[...base.rewards,sequence]});assert.throws(()=>s.play(sequence.id),e=>e.status===403);
 s.points({delta:30,reason:'完成阅读',idempotencyKey:randomUUID()});s.purchase({rewardId:sequence.id,expectedCost:20,idempotencyKey:randomUUID()});
 assert.deepEqual(s.play(sequence.id).motion.script,sequence.motion.script);const prior=s.snapshot();s.close();s=createStore(path,base);
 assert.deepEqual(s.snapshot(),prior);assert.deepEqual(s.play(sequence.id).motion.script,sequence.motion.script);
 const edited=s.catalog();edited.rewards.find(r=>r.id===sequence.id).motion.script=[{clip:'walk',cycles:1,speed:1}];s.saveCatalog(edited);
 const record=s.exportData().ledger.find(r=>r.rewardId===sequence.id&&r.kind==='purchase');assert.deepEqual(record.rewardSnapshot.motion.script,sequence.motion.script);
 assert.equal(s.snapshot().balance,10);assert.equal(s.catalog().rewards.find(r=>r.id==='trick-jump').action,'jump');
 }finally{s?.close();rmSync(dir,{recursive:true,force:true});}
});
