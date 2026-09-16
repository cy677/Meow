import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPetServer } from '../server.mjs';
const dir = mkdtempSync(join(tmpdir(), 'meow-browser-local-'));
const app = await createPetServer({ dbPath:join(dir, 'pet.sqlite') });
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({ headless:true, args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const parentContext = await browser.newContext({ viewport:{ width:1365, height:1000 } }), childContext = await browser.newContext({ viewport:{ width:1280, height:950 } });
const parent = await parentContext.newPage(), child = await childContext.newPage(), errors = [], external = [];
for (const page of [parent,child]) {
  page.setDefaultTimeout(60000); page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/\/(?:favicon\.ico|api\/(?:child|parent)\/session)$/.test(m.location().url)) errors.push(m.text()); });
  page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origin + '/')) external.push(r.url()); });
}
const out = new URL('../test-results/', import.meta.url); mkdirSync(out, { recursive:true });
const shot = async (page, name) => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.screenshot({ path:new URL(name + '.png', out).pathname, fullPage:true }); };
async function begin(category, title, cost, unlockAt) {
  await parent.locator('[data-action=new-preset]').click(); await parent.locator('#preset-dialog').waitFor({ state:'visible' });
  await parent.locator('#preset-form [name=category]').selectOption(category);
  await parent.locator('#preset-form [name=title]').fill(title);
  await parent.locator('#preset-form [name=description]').fill('家长用可视化参数制作，保存在本地的奖励。');
  await parent.locator('#preset-form [name=cost]').fill(String(cost)); await parent.locator('#preset-form [name=unlockAt]').fill(String(unlockAt));
  return await parent.locator('#preset-form [name=id]').inputValue();
}
async function waitPreview(key, value) {
  await parent.waitForFunction(({ key, value }) => { const host = document.querySelector('#preset-preview'); return host?.dataset.params && JSON.parse(host.dataset.params)[key] === value; }, { key,value });
}
async function save() { await parent.locator('#preset-save').click(); await parent.locator('#preset-dialog').waitFor({ state:'hidden' }); }
async function purchase(id, play = false) {
  await child.locator(`.reward-card[data-reward-id="${id}"] button`).click(); await child.locator('#purchase-confirm').click(); await child.locator('#purchase-dialog').waitFor({ state:'hidden' });
  await child.locator(`.reward-card[data-reward-id="${id}"] button`).click();
  if (play) await child.locator('#pet-scene[data-last-action=spin]').waitFor();
}
try {
  await parent.goto(origin + '/parent.html');
  for (const [name,value] of Object.entries({ setupToken:app.setupToken, pin:'864209', childCode:'2468', childName:'小朋友', petName:'小橘' })) await parent.locator(`#setup-form [name="${name}"]`).fill(value);
  await parent.locator('#setup-form button[type=submit]').click(); await parent.locator('#workspace').waitFor({ state:'visible' });
  await parent.locator('#reason').fill('   '); await parent.locator('#award-submit').click();
  await parent.waitForFunction(() => document.querySelector('#toast').textContent.includes('请填写加分理由'));
  assert.equal(app.store.snapshot().balance, 0);
  await parent.locator('#reason').fill('独立整理书包，主动检查明天的用品'); await parent.locator('#delta').fill('60'); await parent.locator('#award-submit').click();
  await parent.waitForFunction(() => document.querySelector('#balance').textContent === '60');
  await parent.locator('[data-parent-tab=catalog]').click();
  const shape = await begin('shape', '小团子预设', 10, 30);
  await parent.locator('#preset-param-chubbiness').fill('1.7'); await parent.locator('#preset-param-legLength').fill('0.65');
  await parent.locator('#preset-param-fluffy').check(); await parent.locator('#preset-param-furFluff').fill('1.1');
  await waitPreview('chubbiness', 1.7); assert.ok(!app.store.catalog().rewards.some(r => r.id === shape));
  await shot(parent, 'preset-shape-desktop');
  await parent.setViewportSize({ width:390, height:844 });
  assert.ok(await parent.evaluate(() => document.querySelector('#preset-dialog').scrollWidth <= document.querySelector('#preset-dialog').clientWidth + 1));
  await shot(parent, 'preset-shape-mobile'); await parent.setViewportSize({ width:1365, height:1000 }); await save();
  const coat = await begin('coat', '薄荷三花预设', 10, 30);
  await parent.locator('#preset-param-coatId').selectOption('calico'); await parent.locator('#preset-param-dynamicCoat').check();
  await parent.locator('#preset-param-dynamicCoatBase').fill('#edf7f4'); await parent.locator('#preset-param-dynamicCoatA').fill('#70a7a0'); await parent.locator('#preset-param-dynamicCoatB').fill('#42516e');
  await waitPreview('dynamicCoatA', '#70a7a0'); await shot(parent, 'preset-coat-desktop'); await save();
  const eyes = await begin('eyes', '水亮双色眼睛', 5, 20);
  await parent.locator('#preset-param-oddEyes').check(); await parent.locator('#preset-param-eyeColor').fill('#6486cf');
  await parent.locator('#preset-param-wateryEyes').check(); await parent.locator('#preset-param-eyeSize').fill('1.2'); await save();
  const pose = await begin('pose', '轻松坐姿', 5, 20);
  await parent.locator('#preset-param-pose').selectOption('slouchSit'); await waitPreview('pose', 'slouchSit'); await save();
  const trick = await begin('trick', '慢慢转两圈', 5, 20);
  await parent.locator('#preset-param-action').selectOption('spin'); await parent.locator('#preset-param-duration').fill('2.4'); await parent.locator('#preset-param-turns').fill('2');
  await parent.locator('#preset-play').click(); await parent.locator('#preset-preview[data-last-action=spin][data-action-duration="2.4"]').waitFor(); await shot(parent, 'preset-action-desktop'); await save();
  const beforePreview = app.store.catalogRevision();
  await parent.locator(`[data-action=copy-preset][data-id="${shape}"]`).click(); await parent.locator('#preset-param-chubbiness').fill('1.8');
  parent.once('dialog', d => d.accept()); await parent.locator('#preset-close').click(); await parent.locator('#preset-dialog').waitFor({ state:'hidden' });
  assert.equal(app.store.catalogRevision(), beforePreview); assert.equal(app.store.snapshot().balance, 60);
  await child.goto(origin + '/'); await child.locator('#code').fill('2468'); await child.locator('#login-form button').click(); await child.locator('#pet-scene[data-ready=true]').waitFor();
  for (const id of [shape, coat, eyes, pose]) await purchase(id);
  await purchase(trick, true); await child.waitForFunction(() => document.querySelector('#balance').textContent === '25');
  const config = (await (await childContext.request.get(origin + '/api/pet/config')).json());
  assert.equal(config.params.chubbiness, 1.7); assert.equal(config.params.dynamicCoatA, '#70a7a0'); assert.equal(config.params.eyeSize, 1.2); assert.equal(config.params.pose, 'slouchSit');
  assert.equal(config.actions.find(a => a.id === trick).motion.duration, 2.4);
  await child.locator('#toast').waitFor({ state:'hidden' }); await shot(child, 'child-custom-presets');
  // Refresh and cold browser login: data must not be browser-local or restored from the initial JSON.
  await parent.reload(); await parent.locator('#workspace').waitFor({ state:'visible' }); await parent.locator('[data-parent-tab=catalog]').click();
  await parent.locator(`[data-action=edit-preset][data-id="${shape}"]`).click();
  assert.equal(await parent.locator('#preset-param-chubbiness').inputValue(), '1.7'); await parent.locator('#preset-close').click();
  await childContext.clearCookies(); await child.reload(); await child.locator('#code').fill('2468'); await child.locator('#login-form button').click();
  await child.waitForFunction(() => document.querySelector('#balance').textContent === '25');
  await parent.locator('[data-parent-tab=award]').click(); await parent.locator('#history-kind').selectOption('earn'); await parent.locator('#history-search').fill('独立整理'); await parent.locator('.history-filters button').click();
  await parent.locator('#history-entries strong').filter({ hasText:'独立整理书包' }).waitFor(); await shot(parent, 'parent-reasons-local');
  await child.locator('[data-view=history]').click(); await child.locator('#history-kind').selectOption('purchase'); await child.locator('#history-search').fill('薄荷三花'); await child.locator('.history-filters button').click();
  await child.locator('#history-entries details summary').click(); assert.ok((await child.locator('#history-entries').innerText()).includes('#70a7a0')); await shot(child, 'redemption-snapshot');
  for (let i = 0; i < 75; i++) app.store.points({ delta:1, reason:`分页历史-${i}`, idempotencyKey:randomUUID() });
  await parent.locator('#history-search').fill(''); await parent.locator('#history-kind').selectOption('all');
  await parent.waitForFunction(() => document.querySelectorAll('#history-entries .ledger-row').length === 40); await parent.locator('#history-more').click();
  await parent.waitForFunction(() => document.querySelectorAll('#history-entries .ledger-row').length === 80);
  await parent.locator('[data-parent-tab=settings]').click(); await parent.locator('#local-data-path').filter({ hasText:'pet.sqlite' }).waitFor(); await shot(parent, 'local-storage-settings');
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  console.log('PASS: local disk data; mandatory/searchable reasons; parent coat/shape/eye/pose/motion forms and live preview; no-write cancel; save/reload/cold login; child redeem/equip/play; immutable redemption details; >40 history pagination; mobile editor; zero external runtime requests.');
} finally { await browser.close(); await app.close(); rmSync(dir, { recursive:true, force:true }); }
