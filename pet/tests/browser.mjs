/** Real Chromium smoke test. Run after pet:build; Playwright is a CI-only dependency. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createPetServer } from '../server.mjs';
const app=await createPetServer({dbPath:':memory:'});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${app.server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const errors=[];
const parentContext=await browser.newContext({viewport:{width:1365,height:1000}}),childContext=await browser.newContext({viewport:{width:1365,height:1000}});
const parent=await parentContext.newPage(),child=await childContext.newPage();
for(const page of [parent,child]){page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/\/(?:favicon\.ico|api\/(?:child|parent)\/session)$/.test(m.location().url))errors.push(m.text());});}
const out=new URL('../test-results/',import.meta.url);mkdirSync(out,{recursive:true});
try{
  await parent.goto(origin+'/parent.html');
  for(const [name,value]of Object.entries({setupToken:app.setupToken,pin:'864209',childCode:'2468',childName:'小朋友',petName:'小橘'}))await parent.locator(`#setup-form [name="${name}"]`).fill(value);
  await parent.locator('#setup-form button[type=submit]').click();
  await parent.locator('#workspace').waitFor({state:'visible'});
  await parent.locator('#reason').fill('独立完成今天的阅读');await parent.locator('#delta').fill('80');await parent.locator('#award-submit').click();
  await parent.waitForFunction(()=>document.querySelector('#balance').textContent==='80');
  await child.goto(origin+'/');await child.locator('#code').fill('2468');await child.locator('#login-form button').click();
  await child.locator('#pet-scene[data-ready=true]').waitFor();
  assert.ok(await child.locator('#pet-scene canvas').evaluate(c=>c.width>100&&c.height>100));
  async function purchase(id){await child.locator(`.reward-card[data-reward-id="${id}"] button`).click();await child.locator('#purchase-confirm').click();await child.locator('#purchase-dialog').waitFor({state:'hidden'});}
  await purchase('coat-grey');await child.locator('.reward-card[data-reward-id="coat-grey"] button').click();
  await child.locator('#pet-scene[data-coat=greyTabby]').waitFor();
  await purchase('pose-stretch');await child.locator('.reward-card[data-reward-id="pose-stretch"] button').click();
  await child.locator('#pet-scene[data-pose=stretch]').waitFor();
  await purchase('trick-jump');await child.locator('.reward-card[data-reward-id="trick-jump"] button').click();
  await child.waitForFunction(()=>document.querySelector('#balance').textContent==='30');
  await parent.waitForFunction(()=>document.querySelector('#balance').textContent==='30');
  const config=await (await childContext.request.get(origin+'/api/pet/config')).json();assert.equal(config.params.coatId,'greyTabby');assert.equal(config.params.pose,'stretch');assert.equal(config.actions[0].action,'jump');
  await child.locator('#toast').waitFor({state:'hidden'});
  await child.screenshot({path:new URL('child-desktop.png',out).pathname,fullPage:true});
  await parent.screenshot({path:new URL('parent-desktop.png',out).pathname,fullPage:true});
  await parent.locator('[data-parent-tab=catalog]').click();await parent.locator('input[data-reward-id="pose-loaf"][data-field=cost]').fill('3');await parent.locator('[data-action=save-catalog]').click();
  await child.waitForFunction(()=>document.querySelector('.reward-card[data-reward-id="pose-loaf"] .reward-foot strong').textContent==='3 积分');
  await parent.screenshot({path:new URL('parent-catalog.png',out).pathname,fullPage:true});
  const s=await (await childContext.request.get(origin+'/api/child/session')).json();
  const authHeaders={'X-Meow-Client':'points-pet','X-CSRF-Token':s.csrf};
  const denied=await childContext.request.post(origin+'/api/parent/points',{headers:authHeaders,data:{delta:999,reason:'bypass',idempotencyKey:'browser-security-check-1'}});assert.equal(denied.status(),401);
  const locked=await childContext.request.post(origin+'/api/equip',{headers:authHeaders,data:{rewardId:'coat-white'}});assert.equal(locked.status(),403);
  await child.setViewportSize({width:390,height:844});
  await child.waitForFunction(()=>document.querySelector('#pet-scene canvas').width<1000);
  assert.ok(await child.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile page must not overflow horizontally');
  await child.screenshot({path:new URL('child-mobile.png',out).pathname,fullPage:true});
  await parent.locator('[data-action=logout]').click();await parent.locator('#auth').waitFor({state:'visible'});
  assert.equal((await parentContext.request.get(origin+'/api/parent/state')).status(),401);
  assert.deepEqual(errors,[]);
  console.log('PASS: parent setup/award, child login, original WebGL cat, buy/equip/play, cross-page sync, catalog edits, auth, mobile layout, logout.');
}finally{await browser.close();await app.close();}
