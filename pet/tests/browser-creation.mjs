/** Browser regression for parent-only creation rewards and child mystery reveal. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
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
const errors = [];
const external = [];
for (const page of [parent, child]) {
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/\/api\/(?:child|parent)\/session$/.test(message.location().url)) errors.push(message.text());
  });
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

async function openChildFeature(name) {
  const menu = child.locator('.child-functions');
  if ((await menu.getAttribute('open')) === null) await menu.locator('summary').click();
  const button = child.locator(`[data-feature="${name}"]`);
  assert.equal(await button.count(), 1, `${name} remains in the free child menu`);
  await button.click();
}

try {
  await parent.goto(origin + '/parent.html');
  for (const [name, value] of Object.entries({
    setupToken: app.setupToken,
    pin: '864209',
    childCode: '2468',
    childName: '测试小朋友',
    petName: '小橘',
  })) await parent.locator(`#setup-form [name="${name}"]`).fill(value);
  await parent.locator('#setup-form [name=age]').selectOption('6');
  await parent.locator('#setup-form [name=mode]').selectOption('school_basic');
  await parent.locator('#setup-form button[type=submit]').click();
  await parent.locator('#workspace').waitFor({ state: 'visible' });

  await parent.goto(origin + '/studio.html?mode=parent');
  await parent.locator('body[data-studio-ready="true"]').waitFor();
  await parent.locator('#scene').waitFor();
  for (const label of ['随机生成', '保存为解锁奖励', '另存为新奖励', '保存草稿']) {
    assert.equal(await parent.getByRole('button', { name: label, exact: true }).count(), 1, `parent exposes ${label}`);
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
  assert.ok(creation, 'parent save created a catalogue reward');
  assert.equal(creation.category, 'creation');
  assert.equal(creation.cost, 10);
  assert.equal(creation.unlockAt, 20);
  assert.equal(creation.preset.params.pose, 'slouchSit', 'saved reward keeps the generated result');

  // A parent-only draft can be saved without changing the child state.
  const loafChip = parent.locator('.chip[data-id="loaf"]');
  assert.equal(await loafChip.count(), 1);
  await loafChip.click();
  await parent.getByRole('button', { name: '保存草稿', exact: true }).click();
  await parent.locator('.studio-bar [role=status]').filter({ hasText: '草稿已保存' }).waitFor();
  assert.equal(app.store.studio(false).preset && Object.keys(app.store.studio(false).preset).length, 0, 'draft is not sent to child');
  await screenshot(parent, 'luna-creation-parent');

  await child.goto(origin + '/');
  await child.locator('#code').fill('2468');
  await child.locator('#login-form button').click();
  await child.locator('#pet-scene[data-ready=true]').waitFor({ state: 'attached' });
  await child.locator('#pet-scene iframe').waitFor({ state: 'visible' });
  let home = child.frame({ url: /studio\.html\?embedded=1/ });
  await home.locator('#initial-loader').waitFor({ state: 'hidden' });
  assert.equal(app.store.snapshot().creation, null);
  assert.equal(await home.evaluate(() => window.__getAnimation().bindingPose), app.store.snapshot().params.pose, 'child ignores parent draft');
  assert.equal(await child.locator('[data-feature=parameters]').count(), 0, 'child menu has no parameter entry');
  assert.equal(await child.locator('[data-feature=random]').count(), 0, 'child menu has no random entry');
  assert.equal(await home.locator('body.studio-child #panel').isVisible(), false, 'child studio hides the parameter panel');
  assert.equal(await home.locator('#btn-random').isDisabled(), true, 'child random control is disabled in source runtime');

  // Free original menu features remain reachable with zero points.
  const balanceBefore = app.store.snapshot().balance;
  await openChildFeature('capture');
  await home.locator('.share-card-overlay').waitFor({ state: 'visible' });
  await home.locator('.share-card-close-button').click();
  const [glbDownload] = await Promise.all([
    child.waitForEvent('download'),
    openChildFeature('glb'),
  ]);
  assert.match(glbDownload.suggestedFilename(), /\.glb$/);
  await openChildFeature('codex');
  await home.locator('.codex-pet-overlay').waitFor({ state: 'visible' });
  await home.locator('.codex-pet-close').click();
  await openChildFeature('music');
  await openChildFeature('lighting');
  await home.locator('body.studio-lighting-open').waitFor();
  await openChildFeature('weather');
  await home.locator('body.studio-weather-open').waitFor();
  assert.equal(app.store.snapshot().balance, balanceBefore, 'free original features do not spend points');

  // The first page exposes the first two unowned rewards; later unowned rewards are mystery cards.
  const stateResponse = await childContext.request.get(origin + '/api/state');
  assert.equal(stateResponse.status(), 200);
  const childState = await stateResponse.json();
  const hiddenReward = childState.rewards.find(reward => reward.mystery && ['coat', 'shape', 'eyes', 'pose', 'trick'].includes(reward.category));
  assert.ok(hiddenReward, 'child state contains a mystery reward');
  await openRewards();
  for (let i = 0; i < 100 && !(await child.locator('.reward-card.is-mystery').count()); i += 1) {
    const next = child.locator('#reward-next');
    if (await next.isDisabled()) break;
    await next.click();
  }
  assert.ok((await child.locator('.reward-card.is-mystery').count()) > 0, 'mystery cards are visible in the shop');
  const firstMystery = child.locator('.reward-card.is-mystery').first();
  assert.equal(await firstMystery.locator('h3').innerText(), '???');
  assert.equal(await firstMystery.locator('.reward-foot').count(), 0, 'mystery card exposes no price or action');
  await screenshot(child, 'luna-mystery-first-page');
  await closeRewards();

  // Category filtering and pagination keep the same catalogue-wide mystery decision.
  await openRewards();
  const categoryButton = child.locator(`[data-action=category][data-category="${hiddenReward.category}"]`);
  assert.equal(await categoryButton.count(), 1);
  await categoryButton.click();
  const categoryCard = child.locator(`.reward-card[data-reward-id="${hiddenReward.id}"]`);
  assert.equal(await categoryCard.count(), 1);
  assert.equal(await categoryCard.locator('h3').innerText(), '???', 'category filter cannot reveal the reward');
  await closeRewards();

  // Owning a previously hidden reward reveals its title in the owned collection.
  const hiddenCatalogReward = app.store.catalog().rewards.find(reward => reward.id === hiddenReward.id);
  app.store.points({ delta: 10000, reason: '浏览器临时验证积分', idempotencyKey: key() });
  app.store.purchase({ rewardId: hiddenCatalogReward.id, expectedCost: hiddenCatalogReward.cost, idempotencyKey: key() });
  await child.reload();
  await child.locator('#pet-scene[data-ready=true]').waitFor({ state: 'attached' });
  await child.locator('#pet-scene iframe').waitFor({ state: 'visible' });
  await openRewards();
  await child.locator('[data-view=owned]').click();
  const ownedCard = await revealReward(hiddenReward.id);
  assert.notEqual(await ownedCard.locator('h3').innerText(), '???', 'owned reward stays visible');
  await closeRewards();

  // Reveal the saved creation by owning the earlier catalogue entries, then equip its fixed preset.
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
  const equippedCard = child.locator(`.reward-card[data-reward-id="${creation.id}"]`);
  await equippedCard.locator('button').click();
  await child.locator('#rewards-dialog').waitFor({ state: 'hidden' });
  await child.waitForFunction(() => document.querySelector('#pet-scene iframe')?.contentWindow?.__getAnimation?.().bindingPose === 'slouchSit');
  assert.deepEqual(app.store.snapshot().creation.preset.params.pose, creation.preset.params.pose, 'child receives the saved creation snapshot');
  await screenshot(child, 'luna-creation-child');

  // Direct child studio keeps the original action canvas and touch controls while hiding editing UI.
  await child.goto(origin + '/studio.html');
  await child.locator('body[data-studio-ready="true"]').waitFor();
  await child.locator('#scene').waitFor();
  assert.equal(await child.locator('body.studio-child #panel').isVisible(), false);
  assert.equal(await child.locator('#btn-random').isDisabled(), true);
  assert.equal(await child.locator('.studio-pad button').count(), 7);
  await screenshot(child, 'luna-child-studio-locked');

  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('PASS: parent-only random/parameters; fixed creation save and draft isolation; child mystery cards across category/pagination; owned reveal; free capture/GLB/Codex/music/light/weather; child creation equip; direct child studio lock; no external requests.');
} catch (error) {
  await screenshot(parent, 'luna-creation-failure-parent').catch(() => {});
  await screenshot(child, 'luna-creation-failure-child').catch(() => {});
  throw error;
} finally {
  await parentContext.close().catch(() => {});
  await childContext.close().catch(() => {});
  await browser.close().catch(() => {});
  await app.close();
  assert.equal(app.server.listening, false, 'temporary test server closed');
}
