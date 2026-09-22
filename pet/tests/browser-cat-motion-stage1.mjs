/** Focused production WebGL regression; not a physical iPad performance test. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readdirSync,mkdirSync,writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createPetServer } from '../server.mjs';
import { DEFAULT_PARAMS } from '../catalog.mjs';
import { AUTHORED_CLIPS } from '../../src/catMotion/clipCatalog.js';
import { MOTION_REWARDS } from '../motionPrograms.mjs';
const app=await createPetServer({dbPath:':memory:'});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${app.server.address().port}`,out=new URL('../test-results/',import.meta.url);
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true});
const page=await context.newPage(),errors=[],checks=[],reports=[];page.setDefaultTimeout(45000);
page.on('pageerror',e=>errors.push(e.message));
const mark=x=>{checks.push(x);console.log('PASS',x);};
const shot=(name)=>page.screenshot({path:fileURLToPath(new URL(name+'.png',out))});
try {
 await page.goto(origin+'/parent.html');
 for(const [name,value]of Object.entries({setupToken:app.setupToken,pin:'864209',childCode:'2468',childName:'动作测试',petName:'小橘'}))await page.locator(`#setup-form [name=${name}]`).fill(value);
 await page.locator('#setup-form [name=age]').selectOption('6');await page.locator('#setup-form [name=mode]').selectOption('school_basic');
 await page.locator('#setup-form button[type=submit]').click();await page.locator('#workspace').waitFor({state:'visible'});
 await page.locator('[data-parent-tab=catalog]').click();await page.locator('[data-motion-add-rewards]').click();
 await page.waitForFunction(()=>/已添加|示例动作奖励已存在/.test(document.querySelector('#panel-catalog [role=status]')?.textContent||''));
 await page.locator('[data-action=new-preset]').click();await page.locator('#preset-form [name=category]').selectOption('trick');
 for(const clip of AUTHORED_CLIPS)assert.equal(await page.locator(`#preset-param-action option[value="${clip.id}"]`).count(),1);
 await page.locator('#preset-param-action').selectOption('paw');await page.locator('#preset-play').click();
 await page.locator('#preset-preview[data-motion-playing=true]').waitFor();
 const preview=await page.locator('#preset-preview').evaluate(e=>e.getMotionDiagnostics());assert.equal(preview.bones,19);
 await shot('motion-stage1-parent');mark('parent action picker exposes six new clips and plays the existing 19-bone cat');
 // Leave the unsaved draft page; all account assertions use the same local test store.
 const sceneFile=readdirSync(new URL('../dist/assets/',import.meta.url)).find(n=>/^scene-.*\.js$/.test(n));assert.ok(sceneFile);
 await page.route('**/cat-motion-lab',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;background:#f3edde;font:18px system-ui;color:#294139}#label{position:absolute;left:24px;top:20px;z-index:5}#lab{height:768px;position:relative}canvas{width:100%;height:100%}.motion-bar,.tablet-controls,.room-tools{display:none}</style><div id="label">Meow 骨骼动作一阶段 · 原地练习</div><div id="lab"></div><script type="module">import{createPetScene}from'/assets/${sceneFile}';window.scene=createPetScene(document.querySelector('#lab'));scene.setParams(${JSON.stringify({...DEFAULT_PARAMS,pose:'standing'})});window.testParams=${JSON.stringify(DEFAULT_PARAMS)};window.ready=true;</script></html>`}));
 await page.goto(origin+'/cat-motion-lab');await page.waitForFunction(()=>window.ready);
 const initial=await page.evaluate(()=>scene.getMotionDiagnostics());assert.equal(initial.bones,19);
 for(const clip of [{id:'walk',name:'行走'},{id:'jump',name:'跳跃'},{id:'sit',name:'坐下'},...AUTHORED_CLIPS]) {
   const sample=await page.evaluate(c=>{
     document.querySelector('#label').textContent=`${c.name} · 骨骼动作练习（未接物体）`;
     scene.stop(true);scene.play(c.id,{duration:2.4,transition:.2,intensity:1});
     const runtime=scene.getMotionRuntime();runtime.resume();
     for(let i=0;i<24;i++)runtime.update(.02);
     const a=scene.getMotionDiagnostics();
     for(let i=0;i<40;i++)runtime.update(.02);
     runtime.pause();const b=scene.getMotionDiagnostics();
     return {a,b};
   },clip);
   assert.equal(sample.b.geometryId,initial.geometryId);assert.equal(sample.b.positionVersion,initial.positionVersion);
   assert.equal(sample.b.bones,19);assert.ok(sample.b.boneLengthError<1e-6);assert.ok(sample.b.deformed.every(Number.isFinite));
   const changed=sample.a.boneQuaternions.filter((q,i)=>q.some((x,j)=>Math.abs(x-sample.b.boneQuaternions[i][j])>1e-5)).length;
   assert.ok(changed>=4,`${clip.id}: ${changed} joints changed`);
   if(AUTHORED_CLIPS.some(c=>c.id===clip.id))assert.equal(sample.b.source,'meow-authored');
   reports.push({clip:clip.id,changedBones:changed,boneLengthError:sample.b.boneLengthError,source:sample.b.source,geometryId:sample.b.geometryId});
   await page.waitForTimeout(120);await shot('motion-stage1-'+clip.id);
 }
 mark('six new and three original clips deform real bones without remeshing or changing vertex buffers');
 const scheduling=await page.evaluate(()=>{
   scene.stop(true);scene.play('walk',{duration:4});const m=scene.getMotionRuntime();m.resume();
   for(let i=0;i<40;i++)m.update(.02);const before=m.getState().current.elapsed;
   let contacts=0;const off=m.on('paw_contact',()=>contacts++);
   m.play('paw',{duration:.8},undefined,{priority:10,resumePrevious:true});
   for(let i=0;i<45;i++)m.update(.02);m.pause();const resumed=m.getState();
   const t=resumed.current.elapsed;m.update(10);const frozen=m.getState().current.elapsed;
   m.setTarget('frontLFoot',{x:1,y:2,z:3});const reserved=m.getState().targetsApplied;
   off();m.cancel();return {before,resumed,t,frozen,contacts,reserved,active:m.active};
 });
 assert.equal(scheduling.resumed.current.action,'walk');assert.ok(scheduling.t>=scheduling.before);
 assert.equal(scheduling.t,scheduling.frozen);assert.equal(scheduling.contacts,1);assert.equal(scheduling.reserved,false);assert.equal(scheduling.active,false);
 mark('real preview supports interruption/resume, pause, once-only contact cues and reserved targets');
 // Extreme parameter smoke: no claim of fully realistic joint volume or foot IK.
 for(const legLength of [.1,3]) {
   const extreme=await page.evaluate(length=>{
     scene.setParams({...window.testParams,pose:'standing',legLength:length});scene.play('climb-up',{duration:2.4,intensity:1});
     const m=scene.getMotionRuntime();for(let i=0;i<30;i++)m.update(.02);m.pause();return scene.getMotionDiagnostics();
   },legLength).catch(async error=>{throw error;});
   assert.ok(extreme.deformed.every(Number.isFinite));assert.ok(extreme.boneLengthError<1e-6);
 }
 mark('short- and long-leg variants preserve finite deformation and fixed bone lengths');
 // Verify production home integration, including the existing local access checks.
 const catalog=app.store.catalog();for(const reward of MOTION_REWARDS)if(!catalog.rewards.some(r=>r.id===reward.id))catalog.rewards.push(reward);app.store.saveCatalog(catalog);
 app.store.points({delta:500,reason:'动作回归测试',idempotencyKey:randomUUID()});
 const reward=app.store.catalog().rewards.find(r=>r.id==='motion-paw');
 app.store.purchase({rewardId:reward.id,expectedCost:reward.cost,idempotencyKey:randomUUID()});
 const balance=app.store.snapshot().balance;
 await page.goto(origin+'/');await page.locator('#code').fill('2468');await page.locator('#login-form button').click();await page.locator('#pet-scene[data-ready=true]').waitFor();
 const frame=page.frames().find(f=>f.url().includes('/studio.html'));assert.ok(frame);
 await frame.evaluate(()=>window.meowHome.overlay(true));
 const home=await frame.evaluate(r=>{
   let contacts=0;const off=meowMotion.on('paw_contact',()=>contacts++);
   meowMotion.play(r.action,r.motion);window.__step(80,.02);off();
   let denied=false;try{meowMotion.play('climb-up',{});}catch{denied=true;}
   return {scheduler:meowMotion.getState(),source:window.__getAnimation().state?.source,contacts,denied,
     bones:Number(document.querySelector('#viewport').dataset.motionSkinBones)};
 },reward);
 assert.equal(home.bones,19);assert.equal(home.contacts,1);assert.equal(home.denied,true);
 assert.equal(app.store.snapshot().balance,balance);mark('production home uses the shared runtime and keeps locked actions and family balances intact');
 await shot('motion-stage1-home');
 assert.deepEqual(errors,[]);
 writeFileSync(new URL('motion-stage1-report.json',out),JSON.stringify({checks,reports,scheduling,home,errors,notes:'Chromium software WebGL. Authored in-place pose clips, not physics/IK or physical-iPad validation.'},null,2));
} catch(error) {
 await shot('motion-stage1-failure').catch(()=>{});writeFileSync(new URL('motion-stage1-error.txt',out),String(error.stack)+'\n'+JSON.stringify(errors));throw error;
} finally {await browser.close();await app.close();}
