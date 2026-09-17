/** Chromium touch input + actual LAN HTTP. Sensor events are simulated, NOT physical iPad validation. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createPetServer } from '../server.mjs';
import { lanAddresses } from '../lan.mjs';
const ip=lanAddresses()[0];if(!ip)throw new Error('Pad browser test requires a non-loopback LAN IPv4');
const app=await createPetServer({dbPath:':memory:'});await new Promise(r=>app.server.listen(0,'0.0.0.0',r));
const port=app.server.address().port,lan=`http://${ip}:${port}`,loopback=`http://127.0.0.1:${port}`;
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const out=new URL('../test-results/',import.meta.url);mkdirSync(out,{recursive:true});
const errors=[],external=[],pages=[];
async function tablet(origin,init) {
  const context=await browser.newContext({viewport:{width:820,height:1180},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  if(init)await context.addInitScript(init);
  const page=await context.newPage();pages.push(page);page.setDefaultTimeout(60000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin+'/'))external.push(r.url());});
  return {context,page};
}
async function login(page,origin,parent=false) {
  await page.goto(origin+(parent?'/parent.html':'/'));
  await page.locator('#code').fill(parent?'864209':'2468');await page.locator('#login-form button').tap();
  await page.locator('#workspace').waitFor({state:'visible'});
  if(!parent){await page.locator('#pet-scene[data-ready=true]').waitFor();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
}
async function gesture(page,start,end) {
  const cdp=await page.context().newCDPSession(page);
  const points=positions=>positions.map((p,id)=>({x:p[0],y:p[1],id,radiusX:4,radiusY:4,force:1}));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(start)});
  for(let step=1;step<=12;step++) {
    const current=start.map((p,i)=>[p[0]+(end[i][0]-p[0])*step/12,p[1]+(end[i][1]-p[1])*step/12]);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(current)});await page.waitForTimeout(18);
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
}
const view=page=>page.locator('#pet-scene').evaluate(e=>JSON.parse(e.dataset.view));
const controls=page=>page.locator('#pet-scene + .tablet-controls');
const shot=(page,name)=>page.screenshot({path:new URL(name+'.png',out).pathname,fullPage:true});
try {
  const setup=await fetch(lan+'/api/parent/setup',{method:'POST',headers:{'Content-Type':'application/json','X-Meow-Client':'points-pet'},body:JSON.stringify({setupToken:app.setupToken,pin:'864209',childCode:'2468',childName:'小朋友',petName:'小橘'})});assert.equal(setup.status,200);
  const {page:child}=await tablet(lan);await login(child,lan);
  assert.equal(await child.evaluate(()=>isSecureContext),false,'Actual IP HTTP must not pretend to be a secure context');
  await child.locator('.tablet-controls[data-tilt-state=insecure]').waitFor();assert.equal(await controls(child).locator('[data-tablet=tilt]').isDisabled(),true);
  const beforeAccount=app.store.snapshot(),initial=await view(child);
  await child.locator('#pet-scene canvas').scrollIntoViewIfNeeded();let box=await child.locator('#pet-scene canvas').boundingBox();let x=box.x+box.width*.5,y=box.y+box.height*.55;
  await gesture(child,[[x,y]],[[x+110,y+15]]);
  await child.waitForFunction(initial=>Math.abs(JSON.parse(document.querySelector('#pet-scene').dataset.view).azimuth-initial.azimuth)>.1,initial);
  assert.equal(await child.locator('#pet-scene').getAttribute('data-pet-count'),null,'drag must not count as a petting tap');
  const prePinch=await view(child);
  await gesture(child,[[x-25,y],[x+25,y]],[[x-80,y],[x+80,y]]);
  await child.waitForFunction(before=>JSON.parse(document.querySelector('#pet-scene').dataset.view).distance<before.distance*.95,prePinch);
  await controls(child).locator('[data-tablet=reset]').tap();
  await child.waitForFunction(initial=>Math.abs(JSON.parse(document.querySelector('#pet-scene').dataset.view).distance-initial.distance)<.01,initial);
  // A real touch tap on visible cat geometry gives a harmless visual response, not a reward action.
  await child.locator('#pet-scene canvas').scrollIntoViewIfNeeded();box=await child.locator('#pet-scene canvas').boundingBox();
  for(const fy of [.5,.6,.4]){await child.touchscreen.tap(box.x+box.width*.5,box.y+box.height*fy);if(await child.locator('#pet-scene').getAttribute('data-pet-count'))break;}
  assert.ok(Number(await child.locator('#pet-scene').getAttribute('data-pet-count'))>0,'touch tap should find the visible cat');
  await controls(child).locator('[data-tablet=zoom-in]').tap();const zoomed=await view(child);assert.ok(zoomed.distance<initial.distance);
  await controls(child).locator('[data-tablet=zoom-out]').tap();
  assert.deepEqual(app.store.snapshot(),beforeAccount,'view gestures never add points, acquire rewards or equip locked items');
  await child.evaluate(()=>scrollTo(0,0));await gesture(child,[[810,930]],[[810,320]]);
  assert.ok(await child.evaluate(()=>scrollY>30),'dragging outside canvas should scroll the page');
  await child.evaluate(()=>scrollTo(0,0));await shot(child,'pad-touch-portrait');
  await child.setViewportSize({width:1180,height:820});
  await child.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);await shot(child,'pad-touch-landscape');

  // Loopback is a browser-recognized secure context for automated sensor permission/event tests.
  const {page:sensor}=await tablet(loopback,()=>{
    window.__sensorRequests=0;window.__sensorPermission='granted';
    Object.defineProperty(DeviceOrientationEvent,'requestPermission',{configurable:true,value:function(){window.__sensorRequests++;window.__sensorActivation=navigator.userActivation.isActive;return Promise.resolve(window.__sensorPermission);}});
  });
  await login(sensor,loopback);assert.equal(await sensor.evaluate(()=>window.__sensorRequests),0,'no permission prompt on load');
  await controls(sensor).locator('[data-tablet=tilt]').tap();assert.equal(await sensor.evaluate(()=>window.__sensorActivation),true);
  const send=async(beta,gamma)=>sensor.evaluate(({beta,gamma})=>window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{alpha:0,beta,gamma})),{beta,gamma});
  await send(40,0);await send(55,25);
  await sensor.waitForFunction(()=>JSON.parse(document.querySelector('#pet-scene').dataset.tilt).x>.5);
  await controls(sensor).locator('[data-tablet=calibrate]').tap();await send(55,25);
  assert.deepEqual(await sensor.locator('#pet-scene').evaluate(e=>JSON.parse(e.dataset.tilt)),{x:0,y:0});
  await sensor.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await sensor.locator('.tablet-controls[data-tilt-state=paused]').waitFor();await send(70,50);
  await sensor.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await send(70,50);
  assert.equal(await sensor.evaluate(()=>window.__sensorRequests),1);assert.deepEqual(await sensor.locator('#pet-scene').evaluate(e=>JSON.parse(e.dataset.tilt)),{x:0,y:0});
  await sensor.evaluate(()=>{Object.defineProperty(screen.orientation,'angle',{configurable:true,value:90});screen.orientation.dispatchEvent(new Event('change'));});
  await send(20,0);await send(50,0);assert.ok((await sensor.locator('#pet-scene').evaluate(e=>JSON.parse(e.dataset.tilt))).x>.9);
  await shot(sensor,'pad-tilt-simulated');
  await controls(sensor).locator('[data-tablet=tilt]').tap();await sensor.evaluate(()=>window.__sensorPermission='denied');await controls(sensor).locator('[data-tablet=tilt]').tap();
  await sensor.locator('.tablet-controls[data-tilt-state=denied]').waitFor();
  await sensor.evaluate(()=>window.__sensorPermission='granted');await controls(sensor).locator('[data-tablet=tilt]').tap();
  await sensor.locator('.tablet-controls[data-tilt-state=no-signal]').waitFor({timeout:12000});
  await controls(sensor).locator('[data-tablet=tilt]').tap();await send(40,0);
  await sensor.locator('[data-action=logout]').tap();await sensor.locator('#auth').waitFor({state:'visible'});
  assert.equal(await sensor.locator('.tablet-controls').getAttribute('data-tilt-state'),'off');

  const {page:parent}=await tablet(lan);await login(parent,lan,true);
  await parent.locator('[data-parent-tab=catalog]').tap();await parent.locator('[data-action=new-preset]').tap();
  await parent.locator('#preset-form [name=category]').selectOption('shape');
  await parent.locator('#preset-form [name=title]').fill('Pad 触摸预设');await parent.locator('#preset-form [name=description]').fill('通过触摸滑块预设体型');
  const slider=parent.locator('[data-slider=chubbiness]');await slider.scrollIntoViewIfNeeded();box=await slider.boundingBox();
  await parent.touchscreen.tap(box.x+box.width*.72,box.y+box.height*.5);
  const number=Number(await parent.locator('#preset-param-chubbiness').inputValue());assert.ok(number>1.4);
  await parent.waitForFunction(value=>{const h=document.querySelector('#preset-preview');return h?.dataset.params&&JSON.parse(h.dataset.params).chubbiness===value;},number);
  const rewardId=await parent.locator('#preset-form [name=id]').inputValue();
  await parent.evaluate(()=>document.querySelector('#preset-dialog').scrollTop=0);
  await parent.locator('#preset-dialog').screenshot({path:new URL('pad-parent-preset.png',out).pathname});
  await parent.locator('#preset-save').tap();await parent.locator('#preset-dialog').waitFor({state:'hidden'});
  assert.equal(app.store.catalog().rewards.find(r=>r.id===rewardId).params.chubbiness,number);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS: actual LAN IP HTTP; real CDP single-touch rotation / multi-touch pinch / pet tap / outside scroll; tablet portrait-landscape; touch parent presets; secure-context SIMULATED sensor activation, calibration, screen changes, visibility pause, denial, timeout, logout; zero gesture account writes and zero external requests. Physical iPad/Android sensors were NOT tested.');
} catch(error) {
  for(let i=0;i<pages.length;i++)await shot(pages[i],`pad-failure-${i}`).catch(()=>{});
  writeFileSync(new URL('pad-failure.json',out),JSON.stringify({message:error.message,stack:error.stack,errors,external},null,2));throw error;
} finally {await browser.close();await app.close();}
