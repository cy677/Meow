import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createPetServer } from '../server.mjs';

const app = await createPetServer({ dbPath: ':memory:' });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${app.server.address().port}`;
const out = new URL('../test-results/', import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
page.setDefaultTimeout(45000);
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
const shot = name => page.screenshot({ path: fileURLToPath(new URL(name + '.png', out)) });
const snapshot = async frame => frame.evaluate(() => {
  const world = window.__toyWorld(), ball = world.toys.find(t => t.kind === 'ball');
  const cat = window.__getCat();
  const foot = cat?.getObjectByName('m2m_frontLFoot');
  const v = foot?.getWorldPosition(foot.position.clone());
  return { state: window.meowMotion.getState().interaction, pose: { ...window.__studio.worldPose },
    ball: { position: { ...ball.body.position }, velocity: { ...ball.body.velocity } },
    touch: world.catDiagnostics().pawTouchCount, lastTouch: world.catDiagnostics().lastPawTouch,
    foot: v && { x: v.x, y: v.y, z: v.z } };
});
try {
  await page.goto(origin + '/parent.html');
  for (const [name, value] of Object.entries({ setupToken: app.setupToken, pin: '864209', childCode: '2468', childName: '互动测试', petName: '小橘' }))
    await page.locator(`#setup-form [name=${name}]`).fill(value);
  await page.locator('#setup-form [name=age]').selectOption('6');
  await page.locator('#setup-form [name=mode]').selectOption('school_basic');
  await page.locator('#setup-form button[type=submit]').click();
  await page.locator('#workspace').waitFor({ state: 'visible' });
  await page.goto(origin + '/');
  await page.locator('#code').fill('2468');
  await page.locator('#login-form button').click();
  await page.locator('#pet-scene[data-ready=true]').waitFor();
  const frame = page.frames().find(f => f.url().includes('/studio.html'));
  assert.ok(frame);
  const asset = readdirSync(new URL('../dist/assets/', import.meta.url)).find(n => /^main-.*\.js$/.test(n));
  assert.ok(asset);
  await frame.evaluate(async asset => { window.__studio = (await import('/assets/' + asset)).petStudio; }, asset);
  const idleMotion=app.store.snapshot().access.actions.find(a=>a.action==='idle-alert')?.motion||{};
  await frame.evaluate(idleMotion => {
    window.meowHome.overlay(true);
    window.__studio.stop(true);
    window.__studio.worldPose.x = 0;
    window.__studio.worldPose.z = 0;
    window.__studio.worldPose.heading = 0;
    const world = window.__toyWorld();
    for (const toy of world.toys) {
      toy.mesh.visible = toy.kind === 'ball';
      toy.body.collisionFilterMask = toy.kind === 'ball' ? -1 : 0;
      if (toy.kind !== 'ball') toy.body.position.set(0, -100, 0);
    }
    const ball = world.toys.find(t => t.kind === 'ball');
    ball.mesh.visible=false;ball.body.collisionFilterMask=0;
    window.__studio.motion.play('idle-alert',idleMotion);
    window.__step(430,.02);
    window.__studio.stop(true);
    ball.mesh.visible=true;ball.body.collisionFilterMask=-1;
    window.__studio.worldPose.x=0;window.__studio.worldPose.z=0;window.__studio.worldPose.heading=0;
    ball.body.position.set(.2, ball.radius, 1.15);
    ball.body.velocity.setZero(); ball.body.angularVelocity.setZero();
    window.__step(1, .02);
    window.meowHome.overlay(false);
  },idleMotion);
  results.push({ phase: 'before-start', ...await snapshot(frame), geometry: await frame.evaluate(() => {
    const w=window.__toyWorld(),p=window.__studio.worldPose,t=w.toys.find(t=>t.kind==='ball');
    return {radius:t.radius,mask:t.body.collisionFilterMask,visible:t.mesh.visible,dragging:w.dragging,
      distance:Math.hypot(t.body.position.x-p.x,t.body.position.z-p.z),blocked:w.catMoveBlocked(0,.3,0)};
  }) });
  const started = await frame.evaluate(() => window.__studio.interactWithNearbyToy());
  assert.equal(started, true);
  results.push({ phase: 'initial', ...await snapshot(frame) });
  for (let i = 0; i < 35; i++) {
    const state = await frame.evaluate(() => { window.__step(5, .02); return window.meowMotion.getState().interaction; });
    if (i % 5 === 0 || state.phase === 'pawing' || !state.active)
      results.push({ phase: `step-${i}`, ...await snapshot(frame) });
    if (state.phase === 'pawing') { await shot('toy-interaction-pawing'); break; }
  }
  await frame.evaluate(() => window.__step(100, .02));
  results.push({ phase: 'finished', ...await snapshot(frame) });
  assert.equal(results.at(-1).touch,1,'real paw should touch the ball exactly once');
  await shot('toy-interaction-finished');
  await frame.evaluate(idleMotion => {
    const studio=window.__studio,world=window.__toyWorld(),ball=world.toys.find(t=>t.kind==='ball');
    ball.mesh.visible=false;ball.body.collisionFilterMask=0;
    studio.motion.play('idle-alert',idleMotion);window.__step(430,.02);studio.stop(true);
    studio.worldPose.x=0;studio.worldPose.z=0;studio.worldPose.heading=0;
    ball.mesh.visible=true;ball.body.collisionFilterMask=-1;
    ball.body.position.set(.2,ball.radius,1.15);ball.body.velocity.setZero();ball.body.angularVelocity.setZero();
    window.__step(1,.02);
  },idleMotion);
  for (const item of app.store.snapshot().randomScript) app.store.setRandomScript(item.id, false);
  const empty=app.store.snapshot();
  assert.equal(empty.randomScript.length,0);
  await frame.evaluate(state=>window.meowHome.applyState(state),empty);
  await page.reload();await page.locator('#pet-scene[data-ready=true]').waitFor();
  const cleanFrame=page.frames().find(f=>f.url().includes('/studio.html'));assert.ok(cleanFrame);
  await cleanFrame.evaluate(async asset=>{window.__studio=(await import('/assets/'+asset)).petStudio;},asset);
  await cleanFrame.evaluate(()=>{
    const w=window.__toyWorld();for(const toy of w.toys){toy.mesh.visible=toy.kind==='ball';toy.body.collisionFilterMask=toy.kind==='ball'?-1:0;if(toy.kind!=='ball')toy.body.position.set(0,-100,0);}
    const b=w.toys.find(t=>t.kind==='ball');b.body.position.set(.2,b.radius,1.15);b.body.velocity.setZero();
    window.__studio.worldPose.x=0;window.__studio.worldPose.z=0;window.__studio.worldPose.heading=0;
  });
  await page.waitForTimeout(2800);
  results.push({phase:'empty-script',...await snapshot(cleanFrame)});
  assert.equal(results.at(-1).state.active,false,'empty random script must stay idle');
  await shot('toy-interaction-empty-script');
  const checks=await cleanFrame.evaluate(idleMotion=>{
    const studio=window.__studio,w=window.__toyWorld(),ball=w.toys.find(t=>t.kind==='ball');
    const reset=()=>{ball.mesh.visible=false;ball.body.collisionFilterMask=0;studio.motion.play('idle-alert',idleMotion);window.__step(430,.02);studio.stop(true);
      studio.worldPose.x=0;studio.worldPose.z=0;studio.worldPose.heading=0;ball.mesh.visible=true;ball.body.collisionFilterMask=-1;
      ball.body.position.set(.2,ball.radius,1.15);ball.body.velocity.setZero();window.__step(1,.02);};
    reset();
    ball.body.position.set(.2,ball.radius,3);ball.body.velocity.setZero();
    const farStart=studio.interactWithNearbyToy(),farTouches=w.catDiagnostics().pawTouchCount;
    reset();
    const Wall=ball.body.constructor,Sphere=ball.body.shapes[0].constructor;
    const wall=new Wall({mass:0,shape:new Sphere(.28)});wall.position.set(0,.35,.72);w.world.addBody(wall);
    const blockedStart=studio.interactWithNearbyToy();w.world.removeBody(wall);
    reset();
    const hiddenStart=studio.interactWithNearbyToy();ball.mesh.visible=false;window.__step(10,.02);
    const hiddenCancelled=!studio.motionState().interaction.active,hiddenTouches=w.catDiagnostics().pawTouchCount;
    return {farStart,farTouches,blockedStart,hiddenStart,hiddenCancelled,hiddenTouches};
  },idleMotion);
  results.push({phase:'far-blocked-hidden',checks});
  assert.deepEqual(checks,{farStart:false,farTouches:0,blockedStart:false,hiddenStart:true,hiddenCancelled:true,hiddenTouches:0});
  const cancellation=await cleanFrame.evaluate(idleMotion=>{
    const studio=window.__studio,w=window.__toyWorld(),ball=w.toys.find(t=>t.kind==='ball');
    const reset=()=>{ball.mesh.visible=false;ball.body.collisionFilterMask=0;studio.motion.play('idle-alert',idleMotion);window.__step(430,.02);studio.stop(true);
      studio.worldPose.x=0;studio.worldPose.z=0;studio.worldPose.heading=0;ball.mesh.visible=true;ball.body.collisionFilterMask=-1;
      ball.body.position.set(.2,ball.radius,1.15);ball.body.velocity.setZero();window.__step(1,.02);};
    reset();const dragStarted=studio.interactWithNearbyToy();w.grabToy(ball,ball.body.position);window.__step(10,.02);
    const dragCancelled=!studio.motionState().interaction.active;w.releaseGrab();
    reset();const overlayStarted=studio.interactWithNearbyToy();window.meowHome.overlay(true);window.__step(10,.02);
    const overlayCancelled=!studio.motionState().interaction.active;
    return {dragStarted,dragCancelled,overlayStarted,overlayCancelled,touches:w.catDiagnostics().pawTouchCount};
  },idleMotion);
  results.push({phase:'drag-overlay',cancellation});
  assert.deepEqual(cancellation,{dragStarted:true,dragCancelled:true,overlayStarted:true,overlayCancelled:true,touches:0});
  writeFileSync(new URL('toy-interaction-report.json', out), JSON.stringify({ results, errors }, null, 2));
  assert.deepEqual(errors, []);
} catch (error) {
  await shot('toy-interaction-failure').catch(() => {});
  writeFileSync(new URL('toy-interaction-error.txt', out), String(error.stack) + '\n' + JSON.stringify({ results, errors }, null, 2));
  throw error;
} finally {
  await browser.close();
  await app.close();
}
