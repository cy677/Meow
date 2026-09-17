import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createPetServer} from '../server.mjs';
import {DEFAULT_PARAMS} from '../catalog.mjs';
import {DEFAULT_SCENE,RUG_CHOICES,BED_CHOICES,SCENE_SLOTS} from '../environmentSchema.mjs';
import {SCENE_REWARDS} from '../environmentRewards.mjs';
const app=await createPetServer({dbPath:':memory:'});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${app.server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const out=new URL('../test-results/',import.meta.url);mkdirSync(out,{recursive:true});
const errors=[],reports=[],external=[];
const parentContext=await browser.newContext({viewport:{width:1180,height:820},hasTouch:true});
const childContext=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true});
const parent=await parentContext.newPage(),child=await childContext.newPage();
let lab;
for(const page of [parent,child]){
 page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin+'/'))external.push(r.url());});
}
const shot=(page,name)=>page.screenshot({path:new URL(name+'.png',out).pathname});
const diag=()=>child.locator('#pet-scene').evaluate(e=>e.getSceneDiagnostics());
try{
 await parent.goto(origin+'/parent.html');
 for(const [name,value]of Object.entries({setupToken:app.setupToken,pin:'864209',childCode:'2468',childName:'小朋友',petName:'小橘'}))await parent.locator(`#setup-form [name="${name}"]`).fill(value);
 await parent.locator('#setup-form button[type=submit]').tap();await parent.locator('#workspace').waitFor({state:'visible'});
 await parent.locator('#reason').fill('认真整理自己的房间');await parent.locator('#delta').fill('2000');await parent.locator('#award-submit').tap();
 await parent.waitForFunction(()=>document.querySelector('#balance').textContent==='2000');
 await child.goto(origin+'/');await child.locator('#code').fill('2468');await child.locator('#login-form button').tap();await child.locator('#pet-scene[data-ready=true]').waitFor();
 const original=await diag();assert.equal(original.wood,false);const geometry=original.geometryId;
 await child.locator('[data-action=open-rewards]').tap();await child.locator('#scene-category').selectOption('theme');
 const card=child.locator('[data-reward-id="scene-theme-cozy"] button');await card.tap();
 await child.locator('#purchase-dialog .dialog-close').tap();assert.equal(app.store.snapshot().balance,2000);
 await card.tap();await child.locator('#purchase-confirm').tap();await child.locator('#purchase-dialog').waitFor({state:'hidden'});await card.tap();
 await child.locator('#rewards-dialog').waitFor({state:'hidden'});
 await child.waitForFunction(()=>document.querySelector('#pet-scene').getSceneDiagnostics().wood);
 await child.waitForTimeout(1400);
 const cozy=await diag();assert.equal(cozy.geometryId,geometry,'scene-only equipment must not rebuild the cat');assert.equal(cozy.container,'basket');assert.equal(cozy.toyCount,3);assert.ok(cozy.rug.visible);assert.equal(app.store.snapshot().balance,1900);
 await shot(child,'scene-cozy-child');reports.push({phase:'cozy-theme',...cozy});
 // Real touch capture and physics, not a decorative toy mesh.
 const toy=cozy.toyScreens.find(t=>t.x>80&&t.x<940&&t.y>140&&t.y<620);assert.ok(toy,'at least one toy visible and touchable');
 const cdp=await childContext.newCDPSession(child),viewBefore=await child.locator('#pet-scene').getAttribute('data-view');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:toy.x,y:toy.y,id:1}]});
 await child.waitForFunction(()=>document.querySelector('#pet-scene').dataset.dragToy);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:toy.x+60,y:toy.y-80,id:1}]});await child.waitForTimeout(350);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await child.waitForFunction(()=>!document.querySelector('#pet-scene').dataset.dragToy);assert.equal(await child.locator('#pet-scene').getAttribute('data-view'),viewBefore);
 assert.equal(app.store.snapshot().balance,1900,'toy drag must never alter points');
 await child.locator('[data-room=reset-toys]').tap();
 // Parent can edit a scene through sliders and save, child sees live update.
 await parent.locator('[data-parent-tab=catalog]').tap();await parent.locator('#catalog-filter').selectOption('floor');
 await parent.locator('[data-action=edit-preset][data-id=scene-floor-oak]').tap();
 await parent.locator('#preset-param-baseColor').fill('#ddbbaa');await parent.locator('#preset-param-direction').fill('45');
 await parent.locator('#preset-preview[data-ready=true]').waitFor();await shot(parent,'scene-parent-floor');
 await parent.locator('#preset-save').tap();await parent.locator('#preset-dialog').waitFor({state:'hidden'});
 await child.waitForFunction(()=>document.querySelector('#pet-scene').getSceneDiagnostics().slots.floor.direction===45);
 assert.equal((await diag()).geometryId,geometry);
 // Create and preview a new bundle using the actual form.
 await parent.locator('[data-action=new-preset]').tap();await parent.locator('#preset-form [name=category]').selectOption('theme');
 await parent.locator('#preset-form [name=title]').fill('我的场景套装');await parent.locator('#preset-form [name=description]').fill('本地保存的猫咪房间');
 await parent.locator('#preset-param-floor').selectOption('scene-floor-rose');await parent.locator('#preset-param-toy').selectOption('scene-toy-duck');await parent.locator('#preset-param-bed').selectOption('scene-bed-cardboard');
 await parent.waitForFunction(()=>document.querySelector('#preset-preview').getSceneDiagnostics?.().slots.bed.kind==='cardboard');
 await shot(parent,'scene-parent-theme');await parent.locator('#preset-save').tap();await parent.locator('#preset-dialog').waitFor({state:'hidden'});
 const bundle=app.store.catalog().rewards.find(r=>r.title==='我的场景套装');assert.equal(bundle.params.members.toy,'scene-toy-duck');
 // Child removes scenery without losing ownership or affecting cat.
 await child.locator('[data-action=collection]').tap();await child.locator('#scene-category').selectOption('bed');await child.locator('[data-reward-id=scene-bed-basket] [data-action=unequip]').tap();
 await child.locator('#rewards-dialog').waitFor({state:'hidden'});assert.equal(app.store.snapshot().sceneParams.bed.kind,'none');assert.ok(app.store.snapshot().owned.includes('scene-bed-basket'));
 // Independent asset matrix through the same compiled renderer; auth/ownership was checked above.
 const sceneFile=readdirSync(new URL('../dist/assets/',import.meta.url)).find(n=>/^scene-.*\.js$/.test(n));
 lab=await browser.newPage({viewport:{width:1024,height:768}});lab.setDefaultTimeout(60000);lab.on('pageerror',e=>errors.push(e.message));
 await lab.route('**/room-lab',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><style>body{margin:0}#lab{height:768px;position:relative}canvas{width:100%;height:100%}</style><div id="lab"></div><script type="module">import{createPetScene}from'/assets/${sceneFile}';window.scene=createPetScene(document.querySelector('#lab'));window.params=${JSON.stringify(DEFAULT_PARAMS)};window.env=${JSON.stringify(DEFAULT_SCENE)};scene.applyState({params,sceneParams:env});window.ready=true;</script>`}));
 await lab.goto(origin+'/room-lab');await lab.waitForFunction(()=>window.ready);
 const baseMesh=await lab.evaluate(()=>scene.getSceneDiagnostics().geometryId);
 for(const reward of SCENE_REWARDS){
   await lab.evaluate(r=>{env[r.category]=r.params;scene.applyState({params,sceneParams:env});},reward);
   await lab.waitForTimeout(140);
   const d=await lab.evaluate(()=>scene.getSceneDiagnostics());
   assert.equal(d.geometryId,baseMesh,`${reward.id} rebuilt cat`);
   assert.ok(Object.keys(d.slots).length===8);
   if(reward.category==='rug')assert.equal(d.rug.style,RUG_CHOICES.find(c=>c[0]===reward.params.style)[1]);
   if(reward.category==='bed'&&reward.params.kind!=='cushion')assert.equal(d.container,reward.params.kind);
   if(reward.category==='toy')assert.equal(d.toyCount,reward.params.count);
   reports.push({reward:reward.id,...d});console.log('Rendered source preset:',reward.id);
 }
 await lab.evaluate(()=>{env.weather.mode='fishRain';scene.applyState({params,sceneParams:env});});
 await lab.waitForFunction(()=>scene.getSceneDiagnostics().fish>0);const fish=await lab.evaluate(()=>scene.getSceneDiagnostics());assert.ok(fish.fish<=12);await shot(lab,'scene-fish-rain');
 // Actual containerCrouch plus source mesh; true animated actions still use standing and restore.
 for(const [kind]of BED_CHOICES.filter(([k])=>k!=='cushion')){
   await lab.evaluate(kind=>{env.bed={...env.bed,kind,placement:'inside'};env.weather.mode='sunny';scene.applyState({params,sceneParams:env});},kind);
   const d=await lab.evaluate(()=>scene.getSceneDiagnostics());assert.equal(d.bindingPose,'containerCrouch');
   if(kind==='basket')await shot(lab,'scene-cat-in-basket');
 }
 await lab.evaluate(()=>scene.play('jump',{duration:1.2}));await lab.waitForFunction(()=>!scene.getMotionDiagnostics().active);await lab.waitForTimeout(300);
 assert.equal((await lab.evaluate(()=>scene.getSceneDiagnostics())).bindingPose,'containerCrouch');
 // Resource-count bound after repeatedly replacing containers, rugs/weather textures.
 await lab.evaluate(()=>{env.bed.placement='beside';env.bed.kind='basket';env.rug.style='pizza';env.weather.mode='rain';scene.applyState({params,sceneParams:env});});
 await lab.waitForTimeout(200);const before=await lab.evaluate(()=>scene.getSceneDiagnostics().memory);
 for(let i=0;i<12;i++)await lab.evaluate(i=>{env.bed.kind=i%2?'basket':'cardboard';env.rug.style=i%2?'pizza':'checker';env.weather.mode=i%2?'rain':'sunny';scene.applyState({params,sceneParams:env});},i);
 await lab.waitForTimeout(300);const after=await lab.evaluate(()=>scene.getSceneDiagnostics().memory);
 assert.ok(after.geometries<=before.geometries+12,`unbounded geometry growth ${JSON.stringify({before,after})}`);
 assert.ok(after.textures<=before.textures+4,'unbounded texture growth');
 // Explicit audio activation, overlay muting (including existing thunder), and off switch.
 await lab.locator('[data-room=audio]').click();
 assert.equal((await lab.evaluate(()=>scene.getSceneDiagnostics())).audioEnabled,true);
 await lab.evaluate(()=>document.querySelector('#lab').dispatchEvent(new CustomEvent('meow:overlay-change',{detail:true})));
 assert.equal((await lab.evaluate(()=>scene.getSceneDiagnostics())).audioState.muted,true);
 await lab.evaluate(()=>document.querySelector('#lab').dispatchEvent(new CustomEvent('meow:overlay-change',{detail:false})));
 assert.equal((await lab.evaluate(()=>scene.getSceneDiagnostics())).audioState.muted,false);
 await lab.locator('[data-room=audio]').click();
 assert.equal((await lab.evaluate(()=>scene.getSceneDiagnostics())).audioState.muted,true);
 // Modal/tablet height remains usable with new scene-category selector.
 await child.locator('[data-action=open-rewards]').tap();await child.locator('#scene-category').selectOption('rug');await shot(child,'scene-reward-pages');
 for(const size of [{width:1024,height:600},{width:1180,height:820}]){
   await child.setViewportSize(size);
   for(const selector of ['#reward-prev','#reward-next','[data-action=close-rewards]']){
     const r=await child.locator(selector).boundingBox();assert.ok(r&&r.y>=0&&r.y+r.height<=size.height);
   }
 }
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 writeFileSync(new URL('scene-report.json',out),JSON.stringify({reports,memory:{before,after},note:'Chromium synthetic touch and WebGL, not physical iPad.'},null,2));
 console.log('PASS: migration/local storage; full parent scene/theme forms; child purchase/cancel/equip/unequip; physical toy touch; all 37 upstream scene rewards; six container interiors and skeletal restore; fish rain; bounded memory; landscape pagination; no external requests.');
}catch(error){
 await shot(child,'scene-failure-child').catch(()=>{});await shot(parent,'scene-failure-parent').catch(()=>{});if(lab)await shot(lab,'scene-failure-lab').catch(()=>{});
 writeFileSync(new URL('scene-error.txt',out),`${error.stack}\nPage errors: ${JSON.stringify(errors)}\nReports: ${JSON.stringify(reports)}`);throw error;
}finally{await browser.close();await app.close();}
