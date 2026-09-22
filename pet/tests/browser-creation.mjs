/** Browser regression for parent-only creations and the fully visible child catalogue. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createPetServer } from '../server.mjs';

const app = await createPetServer({ dbPath: ':memory:' });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${app.server.address().port}`;
const out = new URL('../test-results/', import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const parentContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true });
const childContext = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
const parent = await parentContext.newPage();
const child = await childContext.newPage();
const errors = [], external = [], failedRequests = [], checks = [];
const mark = message => { checks.push(message); console.log('PASS', message); };
await child.addInitScript(() => {
  window.__homeMessages = [];
  window.addEventListener('message', event => {
    if (typeof event.data?.type === 'string' && event.data.type.startsWith('meow:')) {
      window.__homeMessages.push({type:event.data.type, origin:event.origin, sourceMatched:event.source === document.querySelector('#pet-scene iframe')?.contentWindow});
    }
  });
});
for (const page of [parent, child]) {
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/\/api\/(?:child|parent)\/session$/.test(message.location().url)) errors.push(message.text());
  });
  page.on('requestfailed', request => failedRequests.push({url:request.url(),error:request.failure()?.errorText}));
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(origin + '/')) external.push(request.url());
  });
}
const screenshot = (page, name) => page.screenshot({ path: fileURLToPath(new URL(name + '.png', out)), fullPage: true });
const key = () => randomUUID();
async function openRewards() {
  await child.locator('[data-action=open-rewards]').click();
  await child.locator('#rewards-dialog').waitFor({ state: 'visible' });
}
async function closeRewards() {
  if (await child.locator('#rewards-dialog').isVisible()) {
    await child.locator('[data-action=close-rewards]').click();
    await child.locator('#rewards-dialog').waitFor({ state: 'hidden' });
  }
}
async function revealReward(id) {
  for (let i = 0; i < 100; i += 1) {
    const card = child.locator(`.reward-card[data-reward-id="${id}"]`);
    if (await card.count()) return card;
    const next = child.locator('#reward-next');
    if (await next.isDisabled()) break;
    await next.click();
  }
  throw new Error(`reward ${id} was not rendered in the catalogue`);
}
try {
  await parent.goto(origin + '/parent.html');
  for (const [name, value] of Object.entries({setupToken:app.setupToken,pin:'864209',childCode:'2468',childName:'测试小朋友',petName:'小橘'})) {
    await parent.locator(`#setup-form [name="${name}"]`).fill(value);
  }
  await parent.locator('#setup-form [name=age]').selectOption('6');
  await parent.locator('#setup-form [name=mode]').selectOption('school_basic');
  await parent.locator('#setup-form button[type=submit]').click();
  await parent.locator('#workspace').waitFor({ state: 'visible' });
  await parent.goto(origin + '/studio.html?mode=parent');
  await parent.locator('body[data-studio-ready="true"]').waitFor();
  await parent.locator('#scene').waitFor();
  for (const label of ['随机生成', '保存为解锁奖励', '另存为新奖励', '保存草稿']) {
    assert.equal(await parent.getByRole('button', { name: label, exact: true }).count(), 1);
  }
  await parent.getByRole('button', { name: '随机生成', exact: true }).click();
  await parent.waitForFunction(() => Number(document.querySelector('#viewport')?.dataset.lastRandomizeMs) >= 0);
  const poseChip = parent.locator('.chip[data-id="slouchSit"]');
  assert.equal(await poseChip.count(), 1);
  await poseChip.click();
  await parent.locator('#viewport[data-cat-pose="slouchSit"]').waitFor();
  await parent.getByRole('button', { name: '保存为解锁奖励', exact: true }).click();
  await parent.locator('#creation-form').waitFor({ state: 'visible' });
  await parent.locator('#creation-form [name=title]').fill('Luna固定作品');
  await parent.locator('#creation-form [name=description]').fill('一次固定的猫咪方案');
  await parent.locator('#creation-form [name=unlockAt]').fill('20');
  await parent.locator('#creation-form [name=cost]').fill('10');
  await parent.getByRole('button', { name: '保存奖励', exact: true }).click();
  await parent.locator('#creation-form').waitFor({ state: 'hidden' });
  await parent.locator('.studio-bar [role=status]').filter({ hasText: '已保存奖励' }).waitFor();
  const creation = app.store.catalog().rewards.find(reward => reward.title === 'Luna固定作品');
  assert.ok(creation);
  assert.equal(creation.category, 'creation');
  assert.equal(creation.cost, 10);
  assert.equal(creation.unlockAt, 20);
  assert.equal(creation.preset.params.pose, 'slouchSit');

  await parent.locator('.chip[data-id="loaf"]').click();
  await parent.getByRole('button', { name: '保存草稿', exact: true }).click();
  await parent.locator('.studio-bar [role=status]').filter({ hasText: '草稿已保存' }).waitFor();
  assert.equal(app.store.studio(false).preset && Object.keys(app.store.studio(false).preset).length, 0);
  await screenshot(parent, 'luna-creation-parent');
  mark('Parent creation saved; separate draft does not change child state');
  await parent.getByRole('link', {name:'返回家长页', exact:true}).click();
  await parent.locator('#workspace').waitFor({state:'visible'});
  assert.equal(app.store.snapshot().creation, null);
  await child.goto(origin + '/');
  await child.locator('#code').fill('2468');
  await child.locator('#login-form button').click();
  await child.bringToFront();
  await child.locator('#pet-scene[data-ready=true]').waitFor({ state: 'attached' });
  await child.locator('#pet-scene iframe').waitFor({ state: 'visible' });
  let home = child.frame({ url: /studio\.html\?embedded=1/ });
  await home.locator('#initial-loader').waitFor({ state: 'hidden' });
  assert.equal(app.store.snapshot().creation, null);
  assert.equal(await home.evaluate(() => window.__getAnimation().bindingPose), app.store.snapshot().params.pose);
  assert.equal(await child.locator('[data-feature=parameters]').count(), 0);
  assert.equal(await child.locator('[data-feature=random]').count(), 0);
  assert.equal(await home.locator('body.studio-child #panel').isVisible(), false);
  assert.equal(await home.locator('#btn-random').isDisabled(), true);
  mark('Child native iframe ready; saved draft remains private');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await child.reload();
    await child.locator('#pet-scene[data-ready=true]').waitFor({state:'attached'});
    await child.locator('#pet-scene iframe').waitFor({state:'visible'});
    home = child.frame({url:/studio\.html\?embedded=1/});
    assert.equal(await home.evaluate(() => document.body.dataset.studioReady), 'true');
    assert.equal(await home.evaluate(() => typeof window.meowHome?.applyState), 'function');
  }
  mark('Three consecutive native homepage reloads complete');

  // Current main exposes stage tools directly and reserves export editing for parents.
  const balanceBefore = app.store.snapshot().balance;
  await home.locator('#btn-export-png').click();
  await home.locator('.share-card-overlay').waitFor({state:'visible'});
  await home.locator('.share-card-close-button').click();
  // The record continuously rotates: click its actual centre, not a fictitious stable frame.
  const music = home.locator('#bgm-toggle');
  const playing = await music.getAttribute('aria-pressed');
  const rect = await music.boundingBox();
  assert.ok(rect);
  await child.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await home.waitForFunction(before => document.querySelector('#bgm-toggle').getAttribute('aria-pressed') !== before, playing);
  assert.equal(await home.locator('#btn-export-glb').count(),0);
  assert.equal(await home.locator('#btn-codex-pet').count(),0);
  assert.equal(app.store.snapshot().balance,balanceBefore);
  mark('Direct stage capture/music remain free; parent-only exports are absent');

  // The complete collection is visible on current main; do not restore obsolete mystery cards.
  const stateResponse = await childContext.request.get(origin+'/api/state');
  assert.equal(stateResponse.status(),200);
  const childState = await stateResponse.json();
  assert.equal(childState.rewards.filter(r=>r.mystery).length,0);
  assert.equal(childState.rewards.filter(r=>r.category==='model').length,14);
  const selected = childState.rewards.find(r=>!r.owned&&r.category==='coat');
  assert.ok(selected);
  await openRewards();
  assert.equal(await child.locator('.reward-card.is-mystery').count(),0);
  await child.locator('[data-action=category][data-category=coat]').click();
  const selectedCard = await revealReward(selected.id);
  assert.notEqual(await selectedCard.locator('h3').innerText(),'???');
  await screenshot(child,'luna-visible-catalogue');
  await closeRewards();
  mark('Full reward catalogue, model category and traditional category filtering');
  app.store.points({delta:10000,reason:'浏览器临时验证积分',idempotencyKey:key()});
  const selectedReward=app.store.catalog().rewards.find(r=>r.id===selected.id);
  app.store.purchase({rewardId:selected.id,expectedCost:selectedReward.cost,idempotencyKey:key()});
  await child.reload();
  await child.locator('#pet-scene[data-ready=true]').waitFor({state:'attached'});
  await child.locator('#pet-scene iframe').waitFor({state:'visible'});
  await openRewards();
  await child.locator('[data-view=owned]').click();
  const ownedCard=await revealReward(selected.id);
  assert.equal(await ownedCard.locator('h3').innerText(),selectedReward.title);
  await closeRewards();
  mark('Owned collection shows the purchased reward');

  const creationIndex = app.store.catalog().rewards.findIndex(reward => reward.id === creation.id);
  const nowOwned = new Set(app.store.snapshot().owned);
  for (const reward of app.store.catalog().rewards.slice(0, creationIndex)) {
    if (nowOwned.has(reward.id)) continue;
    app.store.purchase({ rewardId: reward.id, expectedCost: reward.cost, idempotencyKey: key() });
  }
  await child.reload();
  await child.locator('#pet-scene[data-ready=true]').waitFor({ state: 'attached' });
  await child.locator('#pet-scene iframe').waitFor({ state: 'visible' });
  home = child.frame({ url: /studio\.html\?embedded=1/ });
  await home.locator('#initial-loader').waitFor({ state: 'hidden' });
  await openRewards();
  const creationCard = await revealReward(creation.id);
  assert.equal(await creationCard.locator('h3').innerText(), 'Luna固定作品');
  await creationCard.locator('button').click();
  await child.locator('#purchase-confirm').click();
  await child.locator('#purchase-dialog').waitFor({ state: 'hidden' });
  await child.locator(`.reward-card[data-reward-id="${creation.id}"] button`).click();
  await child.locator('#rewards-dialog').waitFor({ state: 'hidden' });
  await child.waitForFunction(() => document.querySelector('#pet-scene iframe')?.contentWindow?.__getAnimation?.().bindingPose === 'slouchSit');
  assert.equal(app.store.snapshot().creation.preset.params.pose, creation.preset.params.pose);
  await screenshot(child, 'luna-creation-child');
  mark('Purchased fixed creation equips without regenerating');

  await child.goto(origin + '/studio.html');
  await child.locator('body[data-studio-ready="true"]').waitFor();
  await child.locator('#scene').waitFor();
  assert.equal(await child.locator('body.studio-child #panel').isVisible(), false);
  assert.equal(await child.locator('#btn-random').isDisabled(), true);
  assert.equal(await child.locator('.studio-pad button').count(), 7);
  await screenshot(child, 'luna-child-studio-locked');
  mark('Direct child studio editing lock and touch controls');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  writeFileSync(new URL('creation-browser-report.json', out), JSON.stringify({ok:true,checks,errors,external,failedRequests}, null, 2));
} catch (error) {
  const frames = [];
  for (const frame of child.frames()) {
    frames.push(await frame.evaluate(() => ({url:location.href,visibility:document.visibilityState,studioReady:document.body?.dataset.studioReady,runtimeReady:!!window.meowHome,messages:window.__homeMessages})).catch(e=>({error:e.message})));
  }
  const report = {ok:false,checks,errors,external,failedRequests,frames,error:error.stack};
  writeFileSync(new URL('creation-browser-report.json', out), JSON.stringify(report, null, 2));
  console.error('CREATION DIAGNOSTICS', JSON.stringify(report));
  await screenshot(parent, 'luna-creation-failure-parent').catch(() => {});
  await screenshot(child, 'luna-creation-failure-child').catch(() => {});
  throw error;
} finally {
  await parentContext.close().catch(() => {});
  await childContext.close().catch(() => {});
  await browser.close().catch(() => {});
  await app.close();
  assert.equal(app.server.listening, false);
}
