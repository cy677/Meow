/** Landscape iPad viewport + in-page dialogs. No physical iPad hardware claim. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createPetServer } from '../server.mjs';
import { revealReward, openChildPage } from './ui-helpers.mjs';
const app=await createPetServer({dbPath:':memory:'});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${app.server.address().port}`;
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true,isMobile:true,deviceScaleFactor:1});
const page=await context.newPage(),errors=[],external=[];
page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(error.message));
page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin+'/'))external.push(r.url());});
const out=new URL('../test-results/',import.meta.url);mkdirSync(out,{recursive:true});
const shot=name=>page.screenshot({path:fileURLToPath(new URL(name+'.png',out)),fullPage:true});
async function geometry() {
  return await page.evaluate(()=>{
    const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,right:r.right};};
    return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,scene:box('#pet-scene'),dialog:box('#rewards-dialog')};
  });
}
async function assertDialog() {
  const m=await geometry();assert.ok(m.dialog.right<=m.width&&m.dialog.bottom<=m.height,'dialog stays inside viewport');
  assert.equal(await page.locator('.reward-card').count()<=6,true);
  const visibleActions=page.locator('#reward-prev,#reward-next,[data-action=close-rewards],.reward-card button');
  for(const b of await visibleActions.all()) {
    const r=await b.boundingBox();assert.ok(r&&r.y>=0&&r.y+r.height<=m.height,'every page/card control remains reachable');
    assert.ok(r.height>=43,'touch target remains >=44 CSS pixels including rounding');
  }
  assert.ok(await page.evaluate(()=>document.querySelector('#rewards-dialog').scrollHeight<=document.querySelector('#rewards-dialog').clientHeight+1),'outer modal never requires scrolling to close/page');
}
try {
  const response=await fetch(origin+'/api/parent/setup',{method:'POST',headers:{'Content-Type':'application/json','X-Meow-Client':'points-pet'},body:JSON.stringify({setupToken:app.setupToken,pin:'864209',childCode:'2468',childName:'小朋友',petName:'小橘'})});assert.equal(response.status,200);
  app.store.points({delta:300,reason:'今天认真完成了阅读',idempotencyKey:randomUUID()});
  for(let i=0;i<21;i++)app.store.points({delta:1,reason:`阅读记录 ${i}`,idempotencyKey:randomUUID()});
  await page.goto(origin+'/');await page.locator('#code').fill('2468');await page.locator('#login-form button').tap();
  await page.locator('#pet-scene[data-ready=true]').waitFor();
  const initial=await geometry();assert.equal(initial.scene.w,1024);assert.equal(initial.scene.h,768);assert.equal(initial.scene.x,0);assert.equal(initial.scene.y,0);
  assert.equal(initial.scrollHeight,initial.height);assert.equal(initial.scrollWidth,initial.width);assert.equal(await page.locator('#rewards-dialog').isVisible(),false);
  const canvas=await page.locator('#pet-scene canvas').elementHandle();
  await shot('landscape-cat-1024');
  await page.locator('[data-action=open-rewards]').tap();await assertDialog();await shot('landscape-rewards-1024');
  const ids=[];
  while(true){ids.push(...await page.locator('.reward-card').evaluateAll(cards=>cards.map(c=>c.dataset.rewardId)));if(await page.locator('#reward-next').isDisabled())break;await page.locator('#reward-next').tap();}
  assert.equal(ids.length,app.store.catalog().rewards.length);assert.equal(new Set(ids).size,app.store.catalog().rewards.length);const lastPage=String(Math.ceil(ids.length/6));assert.equal(await page.locator('#reward-grid').getAttribute('data-page'),lastPage);
  // A new award must not send a child back to the first page or remove focus.
  await page.locator('#reward-prev').focus();app.store.points({delta:2,reason:'翻页时新增的积分',idempotencyKey:randomUUID()});
  await page.waitForFunction(()=>document.querySelector('#balance').textContent==='323');
  assert.equal(await page.locator('#reward-grid').getAttribute('data-page'),lastPage);assert.equal(await page.evaluate(()=>document.activeElement.id),'reward-prev');
  await page.locator('[data-action=category][data-category=trick]').tap();assert.equal(await page.locator('#reward-grid').getAttribute('data-page'),'1');assert.equal(await page.locator('.reward-card').count(),Math.min(6,app.store.catalog().rewards.filter(reward=>reward.category==='trick').length));
  await page.locator('[data-view=owned]').tap();assert.equal(await page.locator('.reward-card').count(),6);assert.equal(await page.locator('#reward-next').isDisabled(),app.store.snapshot().owned.length<=6);
  // Two native dialogs: Escape dismisses only confirmation; cancel never spends points.
  await revealReward(page,'coat-grey');const oldBalance=app.store.snapshot().balance;
  await page.locator('.reward-card[data-reward-id="coat-grey"] button').tap();await page.locator('#purchase-dialog').waitFor({state:'visible'});
  await page.keyboard.press('Escape');await page.locator('#purchase-dialog').waitFor({state:'hidden'});assert.ok(await page.locator('#rewards-dialog').isVisible());assert.equal(app.store.snapshot().balance,oldBalance);
  await page.locator('.reward-card[data-reward-id="coat-grey"] button').tap();await page.locator('#purchase-confirm').tap();await page.locator('#purchase-dialog').waitFor({state:'hidden'});
  assert.equal(app.store.snapshot().balance,oldBalance-25);assert.ok(await page.locator('#rewards-dialog').isVisible());
  await page.locator('.reward-card[data-reward-id="coat-grey"] button').tap();await page.locator('#rewards-dialog').waitFor({state:'hidden'});await page.locator('#pet-scene[data-coat=greyTabby]').waitFor();
  assert.ok(await page.evaluate(canvas=>canvas===document.querySelector('#pet-scene canvas'),canvas),'no canvas recreation on close/equip');
  await revealReward(page,'trick-jump');await page.locator('.reward-card[data-reward-id="trick-jump"] button').tap();await page.locator('#purchase-confirm').tap();await page.locator('#purchase-dialog').waitFor({state:'hidden'});
  await page.locator('.reward-card[data-reward-id="trick-jump"] button').tap();await page.locator('#rewards-dialog').waitFor({state:'hidden'});await page.locator('#pet-scene[data-last-action=jump]').waitFor();
  await openChildPage(page,'history');await page.locator('#history-kind').selectOption('earn');await page.waitForFunction(()=>document.querySelector('#history-entries').dataset.kind==='earn'&&document.querySelectorAll('#history-entries .ledger-row').length===5);
  const firstPage=await page.locator('#history-entries .ledger-row').evaluateAll(rows=>rows.map(r=>r.dataset.recordId));
  await page.locator('#history-more').tap();await page.waitForFunction(()=>document.querySelector('#history-entries').dataset.page==='2');
  assert.equal(await page.locator('#history-entries .ledger-row').count(),5);assert.ok((await page.locator('#history-entries .ledger-row').evaluateAll(rows=>rows.map(r=>r.dataset.recordId))).every(id=>!firstPage.includes(id)));
  await page.locator('#history-prev').tap();await page.waitForFunction(()=>document.querySelector('#history-entries').dataset.page==='1');assert.deepEqual(await page.locator('#history-entries .ledger-row').evaluateAll(rows=>rows.map(r=>r.dataset.recordId)),firstPage);
  await page.locator('#history-search').fill('阅读记录 1');await page.locator('.history-filters button').tap();await page.waitForFunction(()=>document.querySelector('#history-entries').dataset.query==='阅读记录 1'&&document.querySelector('#ledger').getAttribute('aria-busy')==='false'&&[...document.querySelectorAll('#history-entries strong')].every(n=>n.textContent.includes('阅读记录 1')));await shot('landscape-history');
  await page.locator('#history-kind').selectOption('purchase');await page.locator('#history-search').fill('');await page.locator('.history-filters button').tap();await page.locator('#history-entries details summary').first().waitFor();await page.locator('#history-entries details summary').first().tap();
  await page.locator('[data-view=shop]').tap();
  // All standard landscape widths, including browser chrome reducing usable height.
  for(const [width,height]of [[1180,820],[1366,1024],[1024,600]]){
    await page.setViewportSize({width,height});await page.waitForFunction(({width,height})=>{const e=document.querySelector('#pet-scene');return e.clientWidth===width&&e.clientHeight===height;},{width,height});await assertDialog();await shot(`landscape-rewards-${width}x${height}`);
  }
  await page.locator('[data-action=close-rewards]').tap();assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'open-rewards');
  await page.setViewportSize({width:1180,height:820});await shot('landscape-cat-1180');
  await page.locator('[data-action=collection]').tap();assert.equal(await page.locator('[data-view=owned]').getAttribute('aria-selected'),'true');
  await page.keyboard.press('Escape');await page.locator('#rewards-dialog').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'collection');
  // Closing via a backdrop tap must not pass through to the cat or affect accounts.
  await page.locator('[data-action=open-rewards]').tap();const before=app.store.snapshot();
  await page.touchscreen.tap(3,3);await page.locator('#rewards-dialog').waitFor({state:'hidden'});assert.deepEqual(app.store.snapshot(),before);
  await page.locator('[data-action=logout]').tap();await page.locator('#auth').waitFor({state:'visible'});assert.ok(!await page.locator('#rewards-dialog').isVisible());
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS: full-viewport landscape cat at 1024x768 / 1180x820 / 1366x1024 / 1024x600; six-item modal pages; catalogue/filter/owned completeness; live award preserves page/focus; nested purchase cancel/confirm; equip/play returns to same canvas; five-item searchable history and previous/next; close/Escape/backdrop/focus/permissions; no external requests.');
}catch(error){await shot('landscape-failure').catch(()=>{});writeFileSync(new URL('landscape-failure.json',out),JSON.stringify({message:error.message,stack:error.stack,errors,geometry:await geometry().catch(()=>null)},null,2));throw error;}
finally{await browser.close();await app.close();}
