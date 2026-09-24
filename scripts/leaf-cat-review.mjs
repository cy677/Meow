/** Isolated built-page regression: never opens or modifies the operator's live DB. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createPetServer } from '../pet/server.mjs';

const output = resolve('test-results/leaf-cat');
mkdirSync(output, { recursive: true });
const app = await createPetServer({ dbPath: ':memory:' });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1380, height: 920 }, hasTouch: true });
const preview = await context.newPage(), parent = await context.newPage();
const errors = [], checks = [], diagnostics = [];
for (const page of [preview, parent]) {
  page.setDefaultTimeout(90000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource.*40[13]/.test(message.text())) errors.push(message.text());
  });
}
const screenshot = (page, name) => page.screenshot({ path: resolve(output, `${name}.png`) });
const mark = message => { checks.push(message); console.log('PASS', message); };
try {
  await preview.goto(origin + '/leaf-cat.html');
  await preview.waitForFunction(() => !!window.__leafCatPreview);
  assert.equal(await preview.locator('.palette i').count(), 4);
  await screenshot(preview, 'preview-interface');
  const initial = await preview.evaluate(() => window.__leafCatPreview.diagnostics());
  assert.equal(initial.bones, 19);
  assert.ok(initial.triangles > 10000 && initial.triangles < 200000);
  diagnostics.push(initial);
  await preview.setViewportSize({ width: 1100, height: 1100 });
  await preview.evaluate(() => window.__leafCatPreview.capture());
  for (const name of ['three', 'front', 'left', 'right', 'back', 'top', 'bottom']) {
    await preview.evaluate(name => { window.__leafCatPreview.setFrame('reference', 0); window.__leafCatPreview.setView(name); }, name);
    await preview.waitForTimeout(100);
    await screenshot(preview, `view-${name}`);
  }
  for (const action of ['idle', 'walk', 'paw', 'jump', 'scratch']) {
    await preview.evaluate(action => { window.__leafCatPreview.setView('three'); window.__leafCatPreview.setFrame(action, .65); }, action);
    await screenshot(preview, `action-${action}`);
    diagnostics.push(await preview.evaluate(() => window.__leafCatPreview.diagnostics()));
  }
  for (const animated of [true, false]) {
    const encoded = await preview.evaluate(animated => window.__leafCatPreview.exportBase64(animated), animated);
    const bytes = Buffer.from(encoded, 'base64');
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
    const manifest = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
    assert.equal(manifest.skins[0].joints.length, 19);
    assert.equal(manifest.animations?.length ?? 0, animated ? 4 : 0);
    writeFileSync(resolve(output, animated ? 'leaf-cat-rigged.glb' : 'leaf-cat-static.glb'), bytes);
  }
  mark('Built standalone preview, seven views, five actions, both GLB exports and 19-joint manifests');

  // Real parent editor and persistence use the existing runtime, not the preview viewer.
  await parent.goto(origin + '/parent.html');
  for (const [name, value] of Object.entries({ setupToken: app.setupToken, pin: '864209', childCode: '2468', childName: '模型测试', petName: '小叶' })) {
    await parent.locator(`#setup-form [name="${name}"]`).fill(value);
  }
  await parent.locator('#setup-form [name=age]').selectOption('6');
  await parent.locator('#setup-form [name=mode]').selectOption('school_basic');
  await parent.locator('#setup-form button[type=submit]').click();
  await parent.locator('#workspace').waitFor({ state: 'visible' });
  const childState = () => { const s = app.store.snapshot(); return JSON.stringify(Object.fromEntries(['balance', 'lifetime', 'owned', 'equipped', 'creation', 'params'].map(key => [key, s[key]]))); };
  const before = childState();
  await parent.goto(origin + '/studio.html?mode=parent');
  await parent.locator('body[data-studio-ready="true"]').waitFor();
  await parent.getByLabel('角色模型', { exact: true }).selectOption('leaf-cat');
  await parent.waitForFunction(() => window.__getCat?.()?.userData.characterModel === 'leaf-cat');
  assert.equal(await parent.locator('#viewport').getAttribute('data-character-model'), 'leaf-cat');
  await screenshot(parent, 'native-editor-leaf-cat');
  await parent.evaluate(() => { window.__setAnimation({ enabled: true, stateMachine: false, action: 'walk', intensity: .65 }); window.__step(40); });
  assert.equal(await parent.evaluate(() => window.__getCat().getObjectByName('fur').isSkinnedMesh), true);
  const attachments = await parent.evaluate(() => {
    const cat = window.__getCat();
    return ['face', 'layered-leaf-collar', 'paw-pads-0'].map(name => ({ name, parent: cat.getObjectByName(name).parent.name }));
  });
  assert.ok(attachments.every(node => /m2m_/.test(node.parent)), JSON.stringify(attachments));
  await screenshot(parent, 'native-editor-walk');
  await parent.evaluate(() => window.__setAnimation({ enabled: false }));
  await parent.getByRole('button', { name: '保存为解锁奖励', exact: true }).click();
  await parent.locator('#creation-form').waitFor({ state: 'visible' });
  await parent.locator('#creation-form [name=title]').fill('叶猫回归测试');
  await parent.locator('#creation-form [name=description]').fill('程序化叶猫造型');
  await parent.locator('#creation-form [name=unlockAt]').fill('20');
  await parent.locator('#creation-form [name=cost]').fill('10');
  await parent.getByRole('button', { name: '保存奖励', exact: true }).click();
  await parent.locator('#creation-form').waitFor({ state: 'hidden' });
  await parent.locator('.studio-bar [role=status]').filter({ hasText: '已保存奖励' }).waitFor();
  const creation = app.store.catalog().rewards.find(reward => reward.title === '叶猫回归测试');
  assert.equal(creation?.preset?.params?.characterModel, 'leaf-cat');
  assert.equal(creation.preset.params.pose, 'standing');
  assert.equal(childState(), before, 'parent-only creation must not mutate child state');
  await parent.getByLabel('角色模型', { exact: true }).selectOption('meow');
  assert.notEqual(await parent.evaluate(() => window.__getCat().userData.characterModel), 'leaf-cat');
  await parent.evaluate(() => window.__setParams({ pose: 'loaf' }, 'draft'));
  await parent.locator('#viewport[data-cat-pose="loaf"]').waitFor();
  await screenshot(parent, 'native-editor-original-restored');
  mark('Original parent editor switches leaf/original, binds native motions, persists a creation and preserves child data');
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, 'browser-review.json'), JSON.stringify({ ok: true, checks, diagnostics, errors }, null, 2));
} catch (error) {
  await screenshot(preview, 'failure-preview').catch(() => {});
  await screenshot(parent, 'failure-parent').catch(() => {});
  writeFileSync(resolve(output, 'browser-review.json'), JSON.stringify({ ok: false, error: error.stack, checks, diagnostics, errors }, null, 2));
  throw error;
} finally {
  await browser.close();
  await app.close();
}
