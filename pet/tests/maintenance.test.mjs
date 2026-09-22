import test from 'node:test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createStore} from '../store.mjs';
import {createPetServer} from '../server.mjs';
import {restoreSpecialPrices} from '../upstreamRewards.mjs';
import {studioBuild} from '../studioBuild.mjs';
import {createUserContext,requireContext} from '../contracts/userContext.mjs';
import {createGrowthService} from '../services/growthService.mjs';
import {createModelRegistry} from '../runtime/modelRegistry.js';
import {createPetRuntime} from '../runtime/petRuntime.js';
import {createDeviceCameraProvider} from '../runtime/cameraProvider.js';
import {createSessionState} from '../ui/account/sessionState.js';
import {getFrameSize} from '../../src/camera/cameraOverlay.js';

const root=fileURLToPath(new URL('../..',import.meta.url));
const base=JSON.parse(fs.readFileSync(new URL('../rewards.json',import.meta.url),'utf8'));
const fresh=t=>{const s=createStore(':memory:',base);t.after(()=>s.close());s.growth.configure({age:6,mode:'school_basic',timeZone:'UTC'});return s;};
const expectStatus=(fn,status)=>assert.throws(fn,e=>e.status===status);

test('maintenance: custom reward identity cannot be inferred from Chinese description',()=>{
  const reward={id:'custom-family-jump',title:'家庭跳跃',category:'trick',action:'jump',cost:0,unlockAt:0,description:'家庭跳跃，默认开放，可直接使用。'};
  assert.deepEqual(restoreSpecialPrices({rewards:[reward]}).rewards,[reward]);
  const source=fs.readFileSync(new URL('../upstreamRewards.mjs',import.meta.url),'utf8');
  assert.match(source,/original-motion-/);
});

test('maintenance: malformed growth configuration is 400 and never mutates existing state',t=>{
  const s=fresh(t),before=s.snapshot(true);
  for(const input of [null,[],3,'',{}, {userId:'other'}])expectStatus(()=>s.growth.configure(input),input&&typeof input==='object'&&Object.keys(input).length===0&&!Array.isArray(input)?409:400);
  assert.deepEqual(s.snapshot(true),before);
});

test('maintenance: source adapter has explicit hooks and missing/duplicate anchors fail closed',()=>{
  const source=fs.readFileSync(new URL('../../src/main.js',import.meta.url),'utf8');
  const plugin=studioBuild(),id=path.join(root,'src/main.js');
  const transformed=plugin.transform(source,id).code;
  assert.match(transformed,/export const petStudio=createStudioAdapter/);
  assert.throws(()=>plugin.transform(source.replace('let worldX = 0;','let worldX=0;'),id),/适配点失配/);
  assert.throws(()=>plugin.transform(source+'\nlet worldX = 0;',id),/适配点失配/);
});

test('maintenance: camera frame has definite 3:4 size in landscape, iframe and portrait',()=>{
  for(const [w,h] of [[1024,768],[960,540],[768,1024],[320,480]]){
    const size=getFrameSize(w,h);assert.ok(size.width>0&&size.height>0);
    assert.ok(size.width<=w-64&&size.height<=h-148);
    assert.equal(size.width/size.height,.75);
  }
  assert.deepEqual(getFrameSize(0,0),{width:0,height:0});
});

test('maintenance: scope guard refuses foreign identities instead of returning local data',()=>{
  const c=createUserContext('child');assert.equal(requireContext(c),c);
  expectStatus(()=>requireContext({...c,profileId:'other'}),400);
  expectStatus(()=>requireContext({...c,userId:'local-parent'}),400);
  expectStatus(()=>requireContext(c,['parent']),403);
  const session=createSessionState('child');session.accept({context:c,csrf:'test',expires:123});
  assert.equal(session.context.profileId,'local-child');session.clear();assert.equal(session.context,null);assert.equal(session.csrf,'');
  assert.throws(()=>session.accept({context:createUserContext('parent'),csrf:'x'}));
});

test('maintenance: growth summary excludes replaced corrections, fills days and does not truncate at 100',t=>{
  const s=fresh(t),at=new Date().toISOString();
  for(let i=0;i<105;i++)s.growth.award({category:'health',title:'记录行动',delta:1,occurredAt:at,idempotencyKey:randomUUID()});
  let summary=s.growth.summary({days:7});
  assert.equal(summary.periodCount,105);assert.equal(summary.periodPoints,105);
  assert.equal(summary.dailyStats.length,7);assert.equal(summary.categoryStats.length,6);
  const original=s.growth.read(true).recent[0];
  s.growth.correct({recordId:original.id,points:3,reason:'纠正分值',idempotencyKey:randomUUID()});
  summary=s.growth.summary({days:7});assert.equal(summary.periodCount,105);assert.equal(summary.periodPoints,107);
  assert.equal(summary.weeklyStats.reduce((n,w)=>n+w.points,0),107);
  assert.equal(summary.dailyStats.reduce((n,d)=>n+d.count,0),105);
  assert.equal(createGrowthService(s).read(createUserContext('parent'),{days:7}).visualization.periodPoints,107);
  for(const days of [0,366,NaN,1.5,'7'])expectStatus(()=>s.growth.summary({days}),400);
});

test('maintenance: registered model and scene camera are used, cleanup is idempotent',()=>{
  const calls=[];const native={photo:{open(){calls.push('open');},close(){calls.push('close');},capture(){return 'png';},dispose(){calls.push('photo-dispose');},active:false},capture(){return {params:{}};}};
  const registry=createModelRegistry();
  const factory=()=>Object.fromEntries(['load','applyAppearance','playAction','setPose','update','stop','dispose'].map(k=>[k,(...args)=>calls.push([k,...args])]));
  registry.register('test-cat',factory);assert.throws(()=>registry.register('test-cat',factory));assert.throws(()=>registry.create('unknown',{}));
  const runtime=createPetRuntime(native,{modelId:'test-cat',registry});runtime.restore({params:{pose:'sit'}});runtime.playProgram({action:'idle'});runtime.update(.02);
  runtime.camera.start();assert.equal(runtime.camera.capture(),'png');runtime.camera.stop();runtime.dispose();runtime.dispose();
  assert.equal(calls.filter(v=>Array.isArray(v)&&v[0]==='dispose').length,1);
  assert.equal(calls.filter(v=>v==='photo-dispose').length,1);
  assert.ok(calls.some(v=>Array.isArray(v)&&v[0]==='applyAppearance'));assert.throws(()=>runtime.playProgram({}));
  const device=createDeviceCameraProvider();assert.equal(device.capabilities.deviceCamera,true);assert.equal(device.state,'idle');device.dispose();device.dispose();assert.equal(device.state,'disposed');
});

function patchFixture(t){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'meow-maintenance-update-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const patch=path.join(temp,'patch'),target=path.join(temp,'target');
  fs.mkdirSync(path.join(patch,'payload/pet/dist'),{recursive:true});fs.mkdirSync(path.join(target,'pet/data'),{recursive:true});
  fs.writeFileSync(path.join(target,'pet/data/pet.sqlite'),'SENTINEL');fs.writeFileSync(path.join(target,'pet-settings.json'),'{"customMarker":"preserve"}');
  fs.copyFileSync(new URL('../../scripts/apply_ubuntu_update.mjs',import.meta.url),path.join(patch,'apply.mjs'));
  fs.writeFileSync(path.join(patch,'payload/pet/dist/index.html'),'<html>test</html>');
  const files={'pet/dist/index.html':createHash('sha256').update('<html>test</html>').digest('hex')};
  const save=()=>fs.writeFileSync(path.join(patch,'manifest.json'),JSON.stringify({release:'test',files}));save();
  const run=()=>spawnSync(process.execPath,[path.join(patch,'apply.mjs'),target],{encoding:'utf8'});
  return {patch,target,files,save,run};
}

test('maintenance: update rejects undeclared files and bad hashes before writing target',t=>{
  const f=patchFixture(t),extra=path.join(f.patch,'payload/pet/dist/extra.txt');fs.writeFileSync(extra,'extra');
  assert.notEqual(f.run().status,0);assert.ok(!fs.existsSync(path.join(f.target,'update-backups')));fs.unlinkSync(extra);
  f.files['pet/dist/index.html']='0'.repeat(64);f.save();assert.notEqual(f.run().status,0);
  assert.equal(fs.readFileSync(path.join(f.target,'pet/data/pet.sqlite'),'utf8'),'SENTINEL');
});

test('maintenance: valid update installs nested server modules without overwriting family data',t=>{
  const f=patchFixture(t),file='pet/services/extra.mjs',value='export const marker=1;';
  fs.mkdirSync(path.join(f.patch,'payload/pet/services'),{recursive:true});fs.writeFileSync(path.join(f.patch,'payload',file),value);
  f.files[file]=createHash('sha256').update(value).digest('hex');f.save();const result=f.run();assert.equal(result.status,0,result.stderr);
  assert.equal(fs.readFileSync(path.join(f.target,file),'utf8'),value);
  assert.equal(fs.readFileSync(path.join(f.target,'pet/data/pet.sqlite'),'utf8'),'SENTINEL');
  assert.equal(fs.readFileSync(path.join(f.target,'pet-settings.json'),'utf8'),'{"customMarker":"preserve"}');
});

test('maintenance: authenticated summary and profile endpoints preserve role boundaries',async t=>{
  const app=await createPetServer({dbPath:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const response=await fetch(origin+'/api/parent/setup',{method:'POST',headers:{'Content-Type':'application/json','X-Meow-Client':'points-pet'},body:JSON.stringify({setupToken:app.setupToken,age:6,mode:'school_basic',timeZone:'UTC',pin:'864209',childCode:'2468',childName:'测试',petName:'小橘'})});
  assert.equal(response.status,200);const session=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];assert.equal(session.context.role,'parent');
  const get=p=>fetch(origin+p,{headers:{Cookie:cookie}});
  assert.equal((await get('/api/growth/summary')).status,401);
  const report=await (await get('/api/parent/growth/summary?days=30')).json();assert.equal(report.dailyStats.length,30);
  const me=await (await get('/api/parent/me')).json();assert.equal(me.context.profileId,'local-child');assert.equal(me.profile.childName,'测试');
  assert.equal((await get('/api/parent/me?profileId=other')).status,400);
  const bad=await fetch(origin+'/api/parent/growth/profile',{method:'PUT',headers:{Cookie:cookie,'Content-Type':'application/json','X-Meow-Client':'points-pet','X-CSRF-Token':session.csrf},body:'null'});assert.equal(bad.status,400);
});

test('maintenance: Ubuntu launcher preserves an explicitly configured loopback host',{skip:process.platform==='win32'},t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'meow-host-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  fs.mkdirSync(path.join(temp,'runtime'));fs.mkdirSync(path.join(temp,'pet/dist'),{recursive:true});
  fs.copyFileSync(new URL('../../Meow',import.meta.url),path.join(temp,'Meow'));
  fs.copyFileSync(new URL('../lan.mjs',import.meta.url),path.join(temp,'pet/lan.mjs'));
  fs.cpSync(new URL('../config/',import.meta.url),path.join(temp,'pet/config'),{recursive:true});
  fs.writeFileSync(path.join(temp,'pet/dist/index.html'),'test');fs.writeFileSync(path.join(temp,'pet-settings.json'),JSON.stringify({openBrowser:false}));
  fs.writeFileSync(path.join(temp,'runtime/node'),`#!/bin/bash\nif [[ "$1" == */pet/server.mjs ]]; then printf 'FINAL_HOST=%s\\n' "$MEOW_HOST"; else exec "${process.execPath}" "$@"; fi\n`,{mode:0o755});
  const result=spawnSync('bash',[path.join(temp,'Meow'),'--no-browser'],{env:{...process.env,MEOW_HOST:'127.0.0.1',MEOW_DATA_DIR:path.join(temp,'family'),MEOW_PORT:'8792',MEOW_PUBLIC_IP:''},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/FINAL_HOST=127\.0\.0\.1/);
});

test('maintenance: payload symlink is rejected without touching the installation',{skip:process.platform==='win32'},t=>{
  const f=patchFixture(t);fs.symlinkSync(path.join(f.target,'pet-settings.json'),path.join(f.patch,'payload/pet/dist/link.txt'));
  assert.notEqual(f.run().status,0);assert.ok(!fs.existsSync(path.join(f.target,'update-backups')));
  assert.equal(fs.readFileSync(path.join(f.target,'pet-settings.json'),'utf8'),'{"customMarker":"preserve"}');
});
