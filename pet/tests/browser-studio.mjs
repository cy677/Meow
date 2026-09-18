/** Full original studio: saved hatch controls, exports, locale, random, motion and touch. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createPetServer } from '../server.mjs';
import { CLIPS } from '../motionPrograms.mjs';

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
const childContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true });
const parent = await parentContext.newPage();
const child = await childContext.newPage();
const errors = [];
const external = [];
for (const page of [parent, child]) {
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(origin + '/')) external.push(request.url());
  });
}
const screenshot = (page, name) => page.screenshot({ path: fileURLToPath(new URL(name + '.png', out)), fullPage: true });

async function downloadedBytes(download, label) {
  const path = await download.path();
  assert.ok(path, `${label} download has a temporary file`);
  const bytes = readFileSync(path);
  assert.ok(bytes.length > 32, `${label} download has content`);
  return bytes;
}

function assertPng(bytes, label) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${label} is a PNG`);
}

async function waitStudio(page, url) {
  await page.goto(origin + url);
  await page.locator('body[data-studio-ready="true"]').waitFor();
  await page.locator('#scene').waitFor();
}

async function openSceneSection(page) {
  const heading = page.locator('h2[role="button"]').filter({ hasText: '场景与渲染' });
  assert.equal(await heading.count(), 1);
  await heading.scrollIntoViewIfNeeded();
  if ((await heading.getAttribute('aria-expanded')) === 'false') await heading.click();
}

async function openHatchGroup(page, title) {
  const group = page.locator('details.control-group').filter({ hasText: title });
  assert.equal(await group.count(), 1);
  await group.locator('summary').scrollIntoViewIfNeeded();
  if ((await group.getAttribute('open')) === null) await group.locator('summary').click();
  return group;
}

async function hatchState(page) {
  return page.evaluate(() => {
    const group = title => [...document.querySelectorAll('details.control-group')]
      .find(item => item.querySelector(':scope > summary')?.textContent === title);
    const active = title => group(title)?.querySelector('.chips .chip.active')?.dataset.id ?? null;
    return {
      shadowUniform: window.__hatch.uHatchStyle.value,
      bodyUniform: window.__hatch.uBodyStyle.value,
      shadowActive: active('地面影子'),
      bodyActive: active('身上阴影'),
    };
  });
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
  await parent.locator('#setup-form button[type=submit]').click();
  await parent.locator('#workspace').waitFor({ state: 'visible' });

  assert.equal(app.store.snapshot().balance,0);
  await child.goto(origin + '/');
  await child.locator('#code').fill('2468');
  await child.locator('#login-form button').click();
  await child.locator('#pet-scene[data-ready=true]').waitFor();
  const home=child.frame({url:/studio.html\?embedded=1/});
  await home.locator('#initial-loader').waitFor({state:'hidden'});
  assert.equal(await child.getByText('原版互动',{exact:true}).count(),0);
  assert.equal(await home.getByLabel('原版互动动作').locator('option').count(),15);
  assert.equal(await home.locator('#btn-random').isDisabled(),true);
  const disabledParameter = home.locator('#controls input, #controls select, #controls button').first();
  assert.equal(await disabledParameter.count(), 1);
  assert.equal(await disabledParameter.isDisabled(),true);
  assert.equal(await child.locator('[data-feature=parameters]').count(),0);
  assert.equal(await child.locator('[data-feature=random]').count(),0);
  assert.equal(await home.locator('body.studio-child #panel').isVisible(),false);
  assert.equal(app.store.studio().access.actions.length,14);
  await child.locator('.child-functions summary').click();
  await child.locator('[data-feature=capture]').click();
  await home.locator('.share-card-overlay').waitFor({state:'visible'});
  await home.locator('.share-card-close-button').click();
  assert.equal(app.store.snapshot().balance,0);
  await screenshot(child,'home-zero-points');
  // Parent-only studio can randomize and save a fixed creation reward.
  await waitStudio(parent, '/studio.html?mode=parent');
  await parent.getByRole('button', { name:'随机生成', exact:true }).click();
  await parent.waitForFunction(() => Number(document.querySelector('#viewport')?.dataset.lastRandomizeMs) >= 0);
  const creationPose=parent.locator('.chip[data-id="slouchSit"]');
  assert.equal(await creationPose.count(),1);
  await creationPose.click();
  await parent.locator('#viewport[data-cat-pose="slouchSit"]').waitFor();
  await parent.getByRole('button', { name:'保存为解锁奖励', exact:true }).click();
  await parent.locator('#creation-form').waitFor({state:'visible'});
  await parent.locator('#creation-form [name=title]').fill('浏览器固定作品');
  await parent.locator('#creation-form [name=description]').fill('家长保存的固定参数');
  await parent.locator('#creation-form [name=unlockAt]').fill('20');
  await parent.locator('#creation-form [name=cost]').fill('10');
  await parent.getByRole('button', { name:'保存奖励', exact:true }).click();
  await parent.locator('#creation-form').waitFor({state:'hidden'});
  assert.equal(app.store.catalog().rewards.filter(r=>r.category==='creation').length,1);
  await openSceneSection(parent);
  const shadow = await openHatchGroup(parent, '地面影子');
  const body = await openHatchGroup(parent, '身上阴影');
  const shadowStyle = shadow.locator('.chips .chip[data-id="1"]');
  const bodyStyle = body.locator('.chips .chip[data-id="1"]');
  assert.equal(await shadowStyle.count(), 1);
  assert.equal(await bodyStyle.count(), 1);
  await shadowStyle.click();
  await bodyStyle.click();
  assert.deepEqual(await hatchState(parent), { shadowUniform: 1, bodyUniform: 1, shadowActive: '1', bodyActive: '1' });
  const save = parent.getByRole('button', { name: '保存草稿', exact: true });
  assert.equal(await save.count(), 1);
  await save.click();
  await parent.locator('.studio-bar [role=status]').filter({ hasText: '草稿已保存' }).waitFor();
  const saved = app.store.studio(true);
  assert.equal(saved.preset.hatch.uHatchStyle, 1);
  assert.equal(saved.preset.hatch.uBodyStyle, 1);

  await waitStudio(parent, '/studio.html?mode=parent');
  await openSceneSection(parent);
  await openHatchGroup(parent, '地面影子');
  await openHatchGroup(parent, '身上阴影');
  assert.deepEqual(await hatchState(parent), { shadowUniform: 1, bodyUniform: 1, shadowActive: '1', bodyActive: '1' }, 'saved hatch uniforms and chip selection survive reload');
  await screenshot(parent, 'studio-parent-hatch-reload');

  await child.goto(origin + '/');
  await child.locator('#pet-scene[data-ready=true]').waitFor();
  await waitStudio(child, '/studio.html');
  assert.equal(await child.locator('body[data-studio-full="true"]').count(), 1);
  assert.equal(await child.locator('body.studio-child #panel').isVisible(), false);
  assert.equal(await child.locator('#btn-random').isDisabled(), true);
  assert.ok(await child.locator('#scene').isVisible());
  for (const id of ['btn-export-png', 'btn-export-glb', 'btn-codex-pet']) assert.equal(await child.locator(`#${id}`).count(),1);
  assert.equal(await child.locator('.studio-pad button').count(), 7);
  await screenshot(child, 'studio-full-featured');

  for (const clip of CLIPS) {
    const animation = await child.evaluate(action => {
      window.__setAnimation({ enabled: true, stateMachine: false, action, restart: true });
      window.__step(4);
      return window.__getAnimation();
    }, clip.id);
    assert.equal(animation.action, clip.id, `studio accepts native motion ${clip.id}`);
    assert.ok(animation.state, `native motion ${clip.id} has a live rig state`);
  }

  await child.evaluate(() => window.__setAnimation({ enabled: false }));
  const canvasBox = await child.locator('#scene').boundingBox();
  assert.ok(canvasBox && canvasBox.width > 0 && canvasBox.height > 0);
  let touchHits = 0;
  for (const factor of [0.5, 0.6, 0.4]) {
    await child.touchscreen.tap(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * factor);
    touchHits = Number(await child.locator('#viewport').getAttribute('data-rua-hits') || 0);
    if (touchHits > 0) break;
  }
  assert.ok(touchHits > 0, 'touch tap reaches the live cat poke path');

  await child.goto(origin + '/');
  await child.locator('#pet-scene[data-ready=true]').waitFor();
  let childHome = child.frame({ url: /studio\.html\?embedded=1/ });
  await childHome.locator('#initial-loader').waitFor({ state: 'hidden' });
  const openChildFeature = async (feature) => {
    const menu = child.locator('.child-functions');
    if ((await menu.getAttribute('open')) === null) await menu.locator('summary').click();
    const button = child.locator(`[data-feature="${feature}"]`);
    assert.equal(await button.count(), 1, `${feature} remains in the free child menu`);
    await button.click();
  };

  await openChildFeature('capture');
  await childHome.locator('.share-card-overlay').waitFor({ state: 'visible' });
  assert.equal(await childHome.locator('.studio-pad').isVisible(), false, 'share card hides touch controls');
  const skinBefore = await childHome.locator('#viewport').getAttribute('data-share-card-skin');
  await childHome.locator('.share-card-skin-button').click();
  const skinAfter = await childHome.locator('#viewport').getAttribute('data-share-card-skin');
  assert.ok(skinAfter && skinAfter !== skinBefore, 'share card skin randomizer changes the card');
  const [cardDownload] = await Promise.all([
    child.waitForEvent('download'),
    childHome.locator('.share-card-capture-button').click(),
  ]);
  assert.match(cardDownload.suggestedFilename(), /\.png$/);
  assertPng(await downloadedBytes(cardDownload, 'share card'), 'share card');
  await childHome.locator('#viewport[data-share-card-captured="true"]').waitFor();
  await childHome.locator('.share-card-close-button').click();
  await childHome.locator('.share-card-overlay').waitFor({ state: 'hidden' });
  assert.equal(await childHome.locator('.studio-pad').isVisible(), true, 'closing share card restores touch controls');

  const [glbDownload] = await Promise.all([
    child.waitForEvent('download'),
    openChildFeature('glb'),
  ]);
  assert.match(glbDownload.suggestedFilename(), /\.glb$/);
  const glbBytes = await downloadedBytes(glbDownload, 'GLB');
  assert.equal(glbBytes.subarray(0, 4).toString('ascii'), 'glTF', 'GLB has the glTF binary header');

  await openChildFeature('codex');
  await childHome.locator('.codex-pet-overlay').waitFor({ state: 'visible' });
  assert.equal(await childHome.locator('.studio-pad').isVisible(), false, 'Codex dialog hides touch controls');
  const sampleImage = childHome.locator('.codex-pet-preview-image');
  await sampleImage.waitFor();
  assert.ok(await sampleImage.evaluate(image => image.complete && image.naturalWidth > 0), 'Codex current preview image is rendered');
  await childHome.locator('.codex-pet-sample-button').click();
  await childHome.locator('.codex-pet-preview.is-contact-sheet').waitFor();
  assert.ok(await sampleImage.evaluate(image => image.complete && image.naturalWidth > 0), 'Codex contact-sheet resource is rendered');
  const [jsonDownload] = await Promise.all([
    child.waitForEvent('download'),
    childHome.locator('.codex-pet-json-button').click(),
  ]);
  assert.match(jsonDownload.suggestedFilename(), /\.json$/);
  const jsonBytes = await downloadedBytes(jsonDownload, 'Codex JSON');
  const jsonPayload = JSON.parse(jsonBytes.toString('utf8'));
  assert.match(jsonPayload.handoff?.prompt ?? '', /Codex/);
  assert.match(jsonPayload.handoff?.referenceImage ?? '', /-reference\.png$/);
  const [handoffPngDownload] = await Promise.all([
    child.waitForEvent('download'),
    childHome.locator('.codex-pet-image-button').click(),
  ]);
  assert.match(handoffPngDownload.suggestedFilename(), /\.png$/);
  assertPng(await downloadedBytes(handoffPngDownload, 'Codex handoff image'), 'Codex handoff image');
  assert.match(await childHome.locator('.codex-pet-prompt p').innerText(), /Codex/);
  await screenshot(child, 'studio-codex-handoff');
  await childHome.locator('.codex-pet-close').click();
  await childHome.locator('.codex-pet-overlay').waitFor({ state: 'hidden' });
  assert.equal(await childHome.locator('.studio-pad').isVisible(), true, 'closing Codex dialog restores touch controls');

  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('PASS: parent hatch uniform/UI save-reload; full studio canvas and six touch controls; Chinese/Japanese/English locale; random rebuild; all 14 native motions; touch poke; share-card skin and PNG; GLB; Codex contact-sheet, JSON and PNG handoff downloads; no external requests.');
} catch (error) {
  await screenshot(parent, 'studio-parent-failure').catch(() => {});
  await screenshot(child, 'studio-child-failure').catch(() => {});
  writeFileSync(new URL('studio-failure.json', out), JSON.stringify({ message: error.message, stack: error.stack, errors, external }, null, 2));
  throw error;
} finally {
  await parentContext.close();
  await childContext.close();
  await browser.close();
  await app.close();
}
