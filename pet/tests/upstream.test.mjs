import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createStore } from '../store.mjs';
import { createPetServer } from '../server.mjs';
import { COATS, EYE_COLORS, POSES } from '../../src/coats.js';
import { CLIPS } from '../motionPrograms.mjs';
import { missingUpstreamRewards } from '../upstreamRewards.mjs';
import { STUDIO_FIELDS, validateStudio } from '../studioSchema.mjs';

const base = JSON.parse(readFileSync(new URL('../rewards.json', import.meta.url), 'utf8'));
const key = () => randomUUID();
const grant = (delta = 100) => ({ delta, reason: '完成测试任务', idempotencyKey: key() });
const custom = {
  id: 'custom-shape', title: '测试自定义体型', description: '保留用户原有自定义奖励。',
  category: 'shape', cost: 1, unlockAt: 0, params: { headSize: 1.24 },
};
const customCatalog = () => ({ ...structuredClone(base), rewards: [...structuredClone(base.rewards), structuredClone(custom)] });
const fresh = (t, catalog = base) => {
  const store = createStore(':memory:', structuredClone(catalog));
  t.after(() => store.close());
  return store;
};
const failStatus = status => error => error?.status === status;

function fieldValue(field) {
  if (field.type === 'select') return field.choices[0][0];
  if (field.type === 'checkbox') return false;
  if (field.type === 'color') return '#000000';
  return field.step === 1 ? Math.ceil(field.min) : (field.min + field.max) / 2;
}

function studioPreset() {
  return Object.fromEntries(Object.entries(STUDIO_FIELDS).map(([section, fields]) => [
    section, Object.fromEntries(fields.map(field => [field.key, fieldValue(field)])),
  ]));
}

test('原版奖励迁移幂等，保留旧自定义奖励、进度和已装备参数', t => {
  const store = fresh(t, customCatalog());
  store.points(grant(10));
  store.purchase({ rewardId: custom.id, expectedCost: custom.cost, idempotencyKey: key() });
  store.equip(custom.id);
  const before = store.snapshot();
  const beforeLedger = store.exportData().ledger;
  const upstream = missingUpstreamRewards(customCatalog());
  const expectedAdditions = upstream.length;

  store.installUpstreamRewards();
  const once = store.snapshot();
  store.installUpstreamRewards();
  const twice = store.snapshot();

  assert.equal(once.rewards.length, before.rewards.length + expectedAdditions);
  assert.deepEqual(twice, once);
  assert.equal(twice.balance, before.balance);
  assert.equal(twice.lifetime, before.lifetime);
  assert.equal(twice.equipped.shape, custom.id);
  assert.ok(twice.owned.includes(custom.id));
  assert.deepEqual(store.catalog().rewards.find(reward => reward.id === custom.id), custom);
  assert.deepEqual(store.exportData().ledger.slice(0, beforeLedger.length), beforeLedger);
  assert.equal(store.getSetting('upstreamRewardsVersion'), '1');
  assert.equal(store.catalog().rewards.filter(reward => reward.category === 'coat').length, COATS.length);
  assert.equal(store.catalog().rewards.filter(reward => reward.category === 'pose').length, POSES.length - 1);
  assert.equal(store.catalog().rewards.filter(reward => reward.category === 'eyes').length, EYE_COLORS.length);
  assert.equal(store.catalog().rewards.filter(reward => reward.category === 'trick').length,
    customCatalog().rewards.filter(reward => reward.category === 'trick').length
      + upstream.filter(reward => reward.category === 'trick').length);
});

test('原版完整参数默认对象与服务端 schema 一致，所有字段都有限且越界被拒绝', t => {
  const preset = studioPreset();
  assert.deepEqual(validateStudio(preset), preset);
  const store = fresh(t);
  const saved = store.saveStudio(preset, '0');
  assert.deepEqual(saved.preset, preset);
  assert.notEqual(saved.revision, '0');

  for (const [section, fields] of Object.entries(STUDIO_FIELDS)) {
    for (const field of fields) {
      const bad = structuredClone(preset);
      if (field.type === 'number') bad[section][field.key] = field.max + (field.step === 1 ? 1 : 0.01);
      else if (field.type === 'checkbox') bad[section][field.key] = 'true';
      else if (field.type === 'color') bad[section][field.key] = '#12345';
      else bad[section][field.key] = '__invalid__';
      assert.throws(() => validateStudio(bad), failStatus(400), `${section}.${field.key} must be bounded`);
    }
  }
  const unknown = structuredClone(preset);
  unknown.params.untrustedCode = 'alert(1)';
  assert.throws(() => validateStudio(unknown), failStatus(400));
});

test('完整参数方案通过 revision 控制并在 SQLite 重启后保留', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-upstream-studio-'));
  const path = join(dir, 'pet.sqlite');
  const preset = studioPreset();
  try {
    let store = createStore(path, base);
    const first = store.saveStudio(preset, '0');
    assert.throws(() => store.saveStudio(preset, '0'), failStatus(409));
    store.close();
    store = createStore(path, base);
    assert.deepEqual(store.studio(true).preset, preset);
    assert.equal(store.studio(true).revision, first.revision);
    store.close();
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

async function fixture(t) {
  const app = await createPetServer({ dbPath: ':memory:' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const roles = {};
  async function request(path, { role = 'none', method = 'GET', data, headers = {} } = {}) {
    const session = roles[role] || {};
    const response = await fetch(origin + path, {
      method,
      headers: {
        ...(data === undefined ? {} : {
          'Content-Type': 'application/json',
          'X-Meow-Client': 'points-pet',
          'X-CSRF-Token': session.csrf || '',
        }),
        ...(session.cookie ? { Cookie: session.cookie } : {}),
        ...headers,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  const setup = await request('/api/parent/setup', {
    method: 'POST',
    data: { setupToken: app.setupToken, pin: '864209', childCode: '2468', childName: '测试孩子', petName: '测试猫' },
  });
  assert.equal(setup.status, 200);
  roles.parent = { cookie: setup.headers.get('set-cookie').split(';')[0], csrf: setup.data.csrf };
  const login = await request('/api/child/login', { method: 'POST', data: { code: '2468' } });
  assert.equal(login.status, 200);
  roles.child = { cookie: login.headers.get('set-cookie').split(';')[0], csrf: login.data.csrf };
  return { app, request, roles };
}

test('原版互动接口按角色和完整创作室拥有权隔离方案', async t => {
  const { request, roles } = await fixture(t);
  const limited = await request('/api/studio', { role: 'child' });
  assert.equal(limited.status, 200);
  assert.equal(limited.data.access.full, false);
  assert.deepEqual(limited.data.preset, {});
  assert.ok(limited.data.access.actions.some(action => action.action === 'idle'));
  assert.equal((await request('/api/parent/studio', { role: 'child' })).status, 401);

  const parentView = await request('/api/parent/studio', { role: 'parent' });
  assert.equal(parentView.status, 200);
  assert.equal(parentView.data.access.full, true);
  assert.deepEqual(parentView.data.preset, {});
  assert.equal((await request('/api/parent/studio', { role: 'child', method: 'PUT', data: { preset: studioPreset(), expectedRevision: '0' } })).status, 401);

  const preset = studioPreset();
  const saved = await request('/api/parent/studio', {
    role: 'parent', method: 'PUT',
    data: { preset, expectedRevision: parentView.data.revision },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.preset, preset);

  await request('/api/parent/points', { role: 'parent', method: 'POST', data: grant(300) });
  const complete = parentView.data.state.rewards.find(reward => reward.id === 'original-complete');
  assert.ok(complete, 'migration should install complete capability');
  const purchase = {
    rewardId: complete.id, expectedCost: complete.cost, idempotencyKey: key(),
  };
  assert.equal((await request('/api/purchase', {
    role: 'child', method: 'POST',
    data: purchase,
  })).status, 200);
  const fullState = (await request('/api/state', { role: 'child' })).data;
  assert.ok(fullState.rewards.every(reward => fullState.owned.includes(reward.id)), 'complete purchase grants every current reward');
  const balanceAfter = fullState.balance;
  assert.equal((await request('/api/purchase', { role: 'child', method: 'POST', data: purchase })).status, 200);
  assert.equal((await request('/api/state', { role: 'child' })).data.balance, balanceAfter);
  const fullView = await request('/api/studio', { role: 'child' });
  assert.equal(fullView.data.access.full, true);
  assert.deepEqual(fullView.data.preset, preset);
});
