/** Production build smoke: real GLBs, owned UI, mouse/touch, physics and lifecycle. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createPetServer} from '../server.mjs';
import {MODEL_REWARDS,MODEL_SLOTS} from '../modelCatalog.mjs';
const app=await createPetServer({dbPath:':memory:'});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${app.server.address().port}`,out=new URL('../test-results/',import.meta.url);
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true});
const page=await context.newPage(),errors=[],external=[],checks=[];page.setDefaultTimeout(60000);
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin+'/'))external.push(r.url());});
page.on('response',r=>{if(r.url().includes('/models/')&&r.status()!==200)errors.push(`${r.status()} ${r.url()}`);});
const mark=name=>{checks.push(name);console.log('PASS',name);};
let frame;
const data=()=>frame.evaluate(()=>window.meowHome.models());
const apply=async()=>{await frame.evaluate(state=>window.meowHome.applyState(state),app.store.snapshot());await frame.waitForFunction(()=>window.meowHome.models().loading===0);assert.deepEqual((await data()).errors,[]);};
async function screen(id){const d=await data(),item=d.items.find(e=>e.id===id);assert.ok(item,id);const b=await frame.locator('#scene').boundingBox();return {x:b.x+item.screen[0],y:b.y+item.screen[1]};}
try {
 await page.goto(origin+'/parent.html');
 for(const [name,value]of Object.entries({setupToken:app.setupToken,pin:'864209',childCode:'2468',childName:'模型测试',petName:'小橘'}))await page.locator(`#setup-form [name=${name}]`).fill(value);
 await page.locator('#setup-form [name=age]').selectOption('6');await page.locator('#setup-form [name=mode]').selectOption('school_basic');await page.locator('#setup-form button[type=submit]').click();await page.locator('#workspace').waitFor({state:'visible'});
 for(let i=0;i<3;i++)app.store.points({delta:500,reason:'模型回归测试',idempotencyKey:randomUUID()});
 for(const reward of MODEL_REWARDS)app.store.purchase({rewardId:reward.id,expectedCost:reward.cost,idempotencyKey:randomUUID()});
 for(const id of ['chick','bee','caterpillar','car','ramp','bricks-basic','stool','table','shelf','lamp'])app.store.equip('kenney-'+id);
 const balance=app.store.snapshot().balance;
 await page.goto(origin+'/');await page.locator('#code').fill('2468');await page.locator('#login-form button').click();await page.locator('#pet-scene[data-ready=true]').waitFor();
 frame=page.frames().find(f=>f.url().includes('/studio.html'));assert.ok(frame);
 await frame.waitForFunction(()=>window.meowHome?.models().loading===0&&window.meowHome.models().items.length===15);
 assert.deepEqual((await data()).errors,[]);mark('10 equipment slots render 15 live instances with the six-piece brick set');
 // The model category is an actual visible shop tab, not just an unused catalogue definition.
 await page.locator('[data-category=model]').click();assert.equal(await page.locator('.reward-card[data-reward-id^="kenney-"]').count(),6);
 assert.ok((await page.locator('#reward-page-status').innerText()).includes('14'));
 await page.waitForFunction(()=>{const img=document.querySelector('.model-reward-thumbnail');return img?.complete&&img.naturalWidth>0;});
 await page.screenshot({path:fileURLToPath(new URL('models-rewards.png',out))});
 // Exercise a real UI unequip/equip; this must preserve balance and ownership.
 const card=page.locator('[data-reward-id=kenney-chick]');await card.locator('button[data-action=unequip]').click();
 await page.locator('#rewards-dialog').waitFor({state:'hidden'});
 if(!await page.locator('#rewards-dialog').isVisible())await page.locator('[data-action=open-rewards]').click();
 await page.locator('[data-category=model]').click();await page.locator('[data-reward-id=kenney-chick] button[data-action=equip]').click();
 await page.locator('#rewards-dialog').waitFor({state:'hidden'});
 await frame.waitForFunction(()=>window.meowHome.models().items.some(e=>e.id==='chick'));
 assert.equal(app.store.snapshot().balance,balance);mark('visible model filter, real thumbnails and authenticated equip/unequip work without charging twice');
 // Every alternative in the paid catalogue is loaded at least once.
 for(const id of ['bunny','racer','truck','bricks-color']){app.store.equip('kenney-'+id);await apply();assert.ok((await data()).items.some(e=>e.id===id));}
 assert.equal((await data()).items.length,19);
 const first=await data();await page.waitForTimeout(700);const next=await data();
 for(const id of ['bunny','bee','caterpillar']){const a=first.items.find(e=>e.id===id),b=next.items.find(e=>e.id===id);assert.ok(b.animationTime>a.animationTime);assert.ok(b.animations.includes('walk'));}
 mark('all 14 reward choices load; actual animal AnimationMixers advance');
 // A real inclined terrain collider, not an axis-aligned box under a ramp mesh.
 assert.ok(await frame.evaluate(()=>{const b=window.__toyWorld().world.bodies.find(b=>b.modelRewardId==='ramp'),s=b?.shapes[0];return s?.data&&Math.max(...s.data.flat())-Math.min(...s.data.flat())>.05;}));
 const before=await data(),truck=before.items.find(e=>e.id==='truck'),p=await screen('truck');
 await page.mouse.move(p.x,p.y);await page.mouse.down();assert.equal((await data()).dragging,true);
 await page.mouse.move(p.x+55,p.y-45,{steps:16});await page.waitForTimeout(300);await page.mouse.up();
 assert.equal((await data()).dragging,false);await page.waitForTimeout(300);const after=(await data()).items.find(e=>e.id==='truck');assert.ok(Math.hypot(...after.position.map((v,i)=>v-truck.position[i]))>.06);mark('vehicle pointer capture, drag/release and sloped ramp collider work');
 const lampBefore=(await data()).items.find(e=>e.id==='lamp').light,lp=await screen('lamp');await page.touchscreen.tap(lp.x,lp.y);assert.notEqual((await data()).items.find(e=>e.id==='lamp').light,lampBefore);mark('touch toggles the local lamp light');
 await page.screenshot({path:fileURLToPath(new URL('models-room.png',out))});
 // Keep a baseline independent of model bodies, then unload everything.
 const modelBodies=await frame.evaluate(()=>window.__toyWorld().world.bodies.filter(b=>b.modelRewardId).length);
 assert.equal(modelBodies,16);
 for(const slot of MODEL_SLOTS)app.store.unequip(slot);await apply();assert.equal((await data()).items.length,0);assert.equal(await frame.evaluate(()=>window.__toyWorld().world.bodies.filter(b=>b.modelRewardId).length),0);
 // Rapid snapshots while models are being instantiated must not leave stale bodies.
 app.store.equip('kenney-car');await frame.evaluate(s=>window.meowHome.applyState(s),app.store.snapshot());app.store.equip('kenney-racer');await frame.evaluate(s=>window.meowHome.applyState(s),app.store.snapshot());app.store.equip('kenney-truck');await apply();assert.deepEqual((await data()).items.map(e=>e.id),['truck']);
 mark('unload and rapid equipment changes remove bodies and reject stale async results');
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);mark('production CSP and local model assets work with no external requests or page errors');
 writeFileSync(new URL('models-checks.json',out),JSON.stringify({checks,errors,external,diagnostics:await data()},null,2));
} catch(error){await page.screenshot({path:fileURLToPath(new URL('models-failure.png',out))}).catch(()=>{});console.error('MODEL ERRORS',errors);if(frame)console.error('DIAGNOSTICS',JSON.stringify(await data().catch(()=>null)));throw error;}
finally{await browser.close();await app.close();}
