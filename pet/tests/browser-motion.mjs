/** Actual WebGL skinned geometry and GUI/API integration; not a physical iPad benchmark. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createPetServer } from '../server.mjs';
import { CLIPS } from '../motionPrograms.mjs';
const app=await createPetServer({dbPath:':memory:'});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${app.server.address().port}`;
const out=new URL('../test-results/',import.meta.url);mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true});
const errors=[],reports=[];
const parent=await context.newPage();parent.setDefaultTimeout(60000);parent.on('pageerror',e=>errors.push(e.message));
const shot=(page,name)=>page.screenshot({path:fileURLToPath(new URL(name+'.png',out))});
let lab,videoContext;
try{
 await parent.goto(origin+'/parent.html');
 for(const [name,value]of Object.entries({setupToken:app.setupToken,pin:'864209',childCode:'2468',childName:'测试小朋友',petName:'小橘'}))await parent.locator(`#setup-form [name="${name}"]`).fill(value);
 await parent.locator('#setup-form button[type=submit]').tap();await parent.locator('#workspace').waitFor({state:'visible'});
 await parent.locator('[data-parent-tab=catalog]').tap();await parent.locator('[data-motion-add-rewards]').tap();
 await parent.waitForFunction(()=>{const text=document.querySelector('#panel-catalog [role=status]')?.textContent??'';return text.includes('示例动作奖励已存在')||text.includes('已添加');});
 const catalogCountAfterSamples=app.store.catalog().rewards.length;
 await parent.waitForFunction(expected=>document.querySelectorAll('#catalog-body tr').length===expected,catalogCountAfterSamples);
 await parent.locator('[data-action=new-preset]').tap();await parent.locator('#preset-form [name=category]').selectOption('trick');
 await parent.locator('#preset-form [name=title]').fill('连续骨骼动作');await parent.locator('#preset-form [name=description]').fill('警觉、行走、坐下，平滑衔接');
 await parent.locator('#preset-param-action').selectOption('sequence');await parent.locator('[data-script-add]').tap();
 await parent.locator('#preset-play').tap();await parent.locator('#preset-preview[data-motion-playing=true]').waitFor();
 const preview=await parent.locator('#preset-preview').evaluate(e=>e.getMotionDiagnostics());assert.equal(preview.bones,19);
 await shot(parent,'motion-parent-script');await parent.locator('#preset-save').tap();await parent.locator('#preset-dialog').waitFor({state:'hidden'});
 const custom=app.store.catalog().rewards.find(r=>r.title==='连续骨骼动作');assert.equal(custom.motion.script.length,4);assert.equal(custom.action,'sequence');
 assert.throws(()=>app.store.play(custom.id),e=>e.status===403);
 app.store.points({delta:100,reason:'用于浏览器测试',idempotencyKey:'motion-browser-award-key'});
 app.store.purchase({rewardId:custom.id,expectedCost:custom.cost,idempotencyKey:'motion-browser-buy-key'});
 const childContext=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true});const child=await childContext.newPage();child.setDefaultTimeout(60000);child.on('pageerror',e=>errors.push(e.message));
 await child.goto(origin+'/');await child.locator('#code').fill('2468');await child.locator('#login-form button').tap();await child.locator('#pet-scene[data-ready=true]').waitFor();
 await child.locator('[data-action=collection]').tap();await child.locator('[data-category=trick]').tap();await child.locator(`[data-action=play][data-id="${custom.id}"]`).tap();
 await child.locator('#rewards-dialog').waitFor({state:'hidden'});await child.locator('#pet-scene[data-motion-playing=true]').waitFor();
 const result=await (await childContext.request.get(origin+'/api/pet/config')).json();assert.deepEqual(result.actions.find(x=>x.id===custom.id).motion.script,custom.motion.script);
 await child.locator('[data-motion-stop]').tap();await child.locator('#pet-scene[data-motion-playing=false]').waitFor();
 const sceneFile=readdirSync(new URL('../dist/assets/',import.meta.url)).find(n=>/^scene-.*\.js$/.test(n));assert.ok(sceneFile);
 videoContext=await browser.newContext({viewport:{width:1024,height:768},recordVideo:{dir:fileURLToPath(new URL('motion-videos/',out)),size:{width:1024,height:768}}});
 lab=await videoContext.newPage();lab.setDefaultTimeout(60000);lab.on('pageerror',e=>errors.push(e.message));
 const params=app.store.snapshot().params;
 await lab.route('**/motion-lab',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;background:#f3edde;font:16px system-ui;color:#294139}#label{position:absolute;left:24px;top:20px;z-index:5}#lab{height:700px;position:relative}canvas{width:100%;height:100%}.motion-bar{display:none}.tablet-controls{display:none}</style><div id="label">骨骼动作实测</div><div id="lab"></div><script type="module">import{createPetScene}from'/assets/${sceneFile}';window.scene=createPetScene(document.querySelector('#lab'));scene.setParams(${JSON.stringify(params)});window.ready=true;</script></html>`}));
 await lab.goto(origin+'/motion-lab');await lab.waitForFunction(()=>window.ready);
 const diag=()=>lab.evaluate(()=>scene.getMotionDiagnostics());
 const initial=await diag();assert.equal(initial.bones,19);assert.equal(initial.weights.invalidWeights,0);
 for(const c of CLIPS){
   await lab.evaluate(({id,name})=>{document.querySelector('#label').textContent=name;scene.play(id,{duration:2,intensity:.9,transition:.2});},c);
   await lab.waitForTimeout(550);const first=await diag();await lab.waitForTimeout(450);const second=await diag();
   assert.equal(second.geometryId,initial.geometryId,'playing must reuse the same indexed mesh');assert.equal(second.positionVersion,initial.positionVersion,'playing must not rewrite vertices');
   assert.ok(second.deformed.every(Number.isFinite));assert.ok(second.boneLengthError<1e-6);
   let changed=0;for(let i=0;i<19;i++)if(first.boneQuaternions[i].some((q,j)=>Math.abs(q-second.boneQuaternions[i][j])>1e-5))changed++;
   if(c.id!=='rest-pose')assert.ok(changed>=2,`${c.id} must move multiple bones, not only the root`);
   reports.push({action:c.id,changedBones:changed,bones:second.bones,sourceFrame:second.sourceFrame,weightError:second.weights.maxWeightError,vertices:second.vertices,geometryId:second.geometryId});
   writeFileSync(new URL('motion-report-partial.json',out),JSON.stringify(reports,null,2));
   if(['walk','run','jump','sit','fetch'].includes(c.id))await shot(lab,`motion-${c.id}`);
 }
 await lab.evaluate(()=>{document.querySelector('#label').textContent='蓄力跳跃：真实骨骼关键帧';scene.play('jump',{duration:4,transition:.25});});
 for(const [time,name]of [[.25,'takeoff'],[1.3,'airborne'],[3.2,'landing']]){await lab.waitForFunction(t=>scene.getMotionDiagnostics().elapsed>=t,time);const framing=await diag();assert.ok(framing.screenY[1]<1.02&&framing.screenY[0]>-1.02,`jump ${name} outside viewport: ${framing.screenY}`);await shot(lab,`jump-${name}`);}
 await lab.evaluate(()=>{scene.play('walk',{duration:6});window.samples=[];window.record=true;const sample=()=>{if(!window.record)return;window.samples.push(scene.getMotionDiagnostics().boneQuaternions);requestAnimationFrame(sample);};sample();});
 await lab.waitForTimeout(400);await lab.evaluate(()=>scene.play('run',{duration:3}));await lab.waitForTimeout(800);await lab.evaluate(()=>scene.stop());await lab.waitForFunction(()=>!scene.getMotionDiagnostics().active);
 const maxDelta=await lab.evaluate(()=>{window.record=false;let d=0;for(let t=1;t<samples.length;t++)for(let b=0;b<19;b++){const q=samples[t-1][b],p=samples[t][b];const dot=Math.min(1,Math.abs(q.reduce((s,x,i)=>s+x*p[i],0)));d=Math.max(d,2*Math.acos(dot));}return d;});assert.ok(maxDelta<1.2,`unexpected single-frame skeletal discontinuity ${maxDelta}`);
 assert.equal((await diag()).active,false);
 await lab.evaluate(params=>{window.params=params;scene.setParams({...params,pose:'loaf'});scene.play('greet',{speed:2});},params);
 assert.equal(await lab.locator('#lab').getAttribute('data-pose'),'loaf');await lab.waitForFunction(()=>!scene.getMotionDiagnostics().active);
 await lab.waitForTimeout(350);assert.equal(await lab.locator('#lab').getAttribute('data-binding-pose'),'loaf');
 await lab.emulateMedia({reducedMotion:'reduce'});await lab.evaluate(()=>scene.play('jump'));assert.equal(await lab.locator('#lab').getAttribute('data-motion-playing'),'false');
 assert.deepEqual(errors,[]);writeFileSync(new URL('motion-report.json',out),JSON.stringify({reports,maxDelta,notes:'Chromium software-rendered WebGL; source bones/geometry, real GUI/API, no physical iPad measurement.'},null,2));
 await videoContext.close();await lab.video().saveAs(fileURLToPath(new URL('skeletal-motion-demo.webm',out)));videoContext=null;
 console.log('PASS: 14 native sources; real 19-bone fixed SkinnedMesh, multi-bone changes, unchanged vertex buffers; crossfades/interrupt/stop; static pose restore; reduced motion; parent script form and child authorized playback.');
}catch(error){if(lab)await shot(lab,'motion-failure').catch(()=>{});await shot(parent,'motion-parent-failure').catch(()=>{});writeFileSync(new URL('motion-error.txt',out),String(error.stack)+'\nPage errors: '+JSON.stringify(errors));throw error;}
finally{await videoContext?.close();await browser.close();await app.close();}
