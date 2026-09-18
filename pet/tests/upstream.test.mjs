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
import { missingUpstreamRewards, isFreeOriginal } from '../upstreamRewards.mjs';
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
  assert.equal(store.getSetting('upstreamRewardsVersion'), '3');
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
    data: { setupToken: app.setupToken,age:6,mode:'school_basic',timeZone:'Asia/Shanghai', pin: '864209', childCode: '2468', childName: '测试孩子', petName: '测试猫' },
  });
  assert.equal(setup.status, 200);
  roles.parent = { cookie: setup.headers.get('set-cookie').split(';')[0], csrf: setup.data.csrf };
  const login = await request('/api/child/login', { method: 'POST', data: { code: '2468' } });
  assert.equal(login.status, 200);
  roles.child = { cookie: login.headers.get('set-cookie').split(';')[0], csrf: login.data.csrf };
  return { app, request, roles };
}

test('零积分基础动作免费，特殊动作需拥有；家长草稿隔离，保存作品后孩子须解锁并使用', async t => {
  const { request, roles } = await fixture(t);
  const limited = await request('/api/studio', { role: 'child' });
  assert.equal(limited.status, 200);
  assert.equal(limited.data.access.full, true);
  assert.deepEqual(limited.data.access.editors, []);
  assert.equal(limited.data.state.balance,0);
  const basic = new Set(['idle','idle-alert','walk','run','sneak']);
  assert.deepEqual(new Set(limited.data.access.actions.map(action => action.action)), basic);
  for(const clip of CLIPS){
    const rewardId=`original-motion-${clip.id}`;
    const status=(await request('/api/play',{role:'child',method:'POST',data:{rewardId}})).status;
    assert.equal(status,basic.has(clip.id)?200:403,clip.id);
  }
  for(const cap of ['capture','music','lighting','weather','speech'])assert.ok(limited.data.access.capabilities.includes(cap));
  for(const cap of ['export','keyboard'])assert.ok(!limited.data.access.capabilities.includes(cap));
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

  const childAfterDraft=await request('/api/studio',{role:'child'});
  assert.deepEqual(childAfterDraft.data.preset,{});
  assert.equal(childAfterDraft.data.revision,limited.data.revision);
  const reward={id:'creation-test',category:'creation',title:'小猫作品',description:'固定随机结果',cost:15,unlockAt:50,preset};
  const catalog=await request('/api/parent/presets',{role:'parent'});
  assert.equal((await request('/api/parent/presets',{role:'child',method:'PUT',data:{reward,expectedRevision:catalog.data.revision}})).status,401);
  assert.equal((await request('/api/parent/presets',{role:'parent',method:'PUT',data:{reward,expectedRevision:catalog.data.revision}})).status,200);
  assert.equal((await request('/api/equip',{role:'child',method:'POST',data:{rewardId:reward.id}})).status,403);
  assert.equal((await request('/api/purchase',{role:'child',method:'POST',data:{rewardId:reward.id,expectedCost:15,idempotencyKey:key()}})).status,409);
  const visible=(await request('/api/state',{role:'child'})).data.rewards.find(r=>r.id===reward.id);
  assert.equal(visible.title,'小猫作品');assert.equal(visible.cost,15);assert.equal(visible.unlockAt,50);assert.equal(visible.preset,undefined);
  await request('/api/parent/points',{role:'parent',method:'POST',data:grant(60)});
  const purchase={rewardId:reward.id,expectedCost:15,idempotencyKey:key()};
  assert.equal((await request('/api/purchase',{role:'child',method:'POST',data:purchase})).status,200);
  assert.equal((await request('/api/purchase',{role:'child',method:'POST',data:purchase})).status,200);
  assert.deepEqual((await request('/api/studio',{role:'child'})).data.preset,{});
  await request('/api/equip',{role:'child',method:'POST',data:{rewardId:reward.id}});
  const applied=(await request('/api/studio',{role:'child'})).data;
  assert.deepEqual(applied.preset,preset);assert.deepEqual(applied.state.creation,{id:reward.id,preset});
  assert.equal(applied.state.balance,45);assert.deepEqual(applied.access.editors,[]);
  assert.ok(!applied.state.rewards.find(r=>r.id===reward.id).mystery);
  await request('/api/equip',{role:'child',method:'POST',data:{rewardId:'coat-orange'}});
  assert.deepEqual((await request('/api/studio',{role:'child'})).data.preset,{});
});

test('旧库升级只开放免费能力，保留模型价格、旧流水与余额，导入不能重新锁动作',t=>{
  const store=fresh(t);store.points(grant(50));
  store.purchase({rewardId:'trick-jump',expectedCost:15,idempotencyKey:key()});
  store.setSetting('upstreamRewardsVersion','1');
  const before=store.exportData(),coat=store.catalog().rewards.find(r=>r.id==='coat-calico');
  store.installUpstreamRewards();
  assert.equal(store.snapshot().balance,before.profile.balance);
  assert.deepEqual(store.catalog().rewards.find(r=>r.id===coat.id),coat);
  assert.deepEqual(store.exportData().ledger.slice(0,before.ledger.length),before.ledger);
  assert.ok(!store.snapshot().owned.includes('editor-body'));
  const changed=store.catalog();
  for(const reward of changed.rewards.filter(isFreeOriginal)){if(!reward.starter){reward.cost=500;reward.unlockAt=500;}}
  store.saveCatalog(changed);
  assert.ok(store.catalog().rewards.filter(isFreeOriginal).every(r=>r.cost===0&&r.unlockAt===0));
  assert.ok(store.catalog().rewards.filter(isFreeOriginal).every(r=>store.snapshot().owned.includes(r.id)));
});

test('家长作品校验完整参数，成长礼物自动获得，旧参数权限不再开放',t=>{
  const store=fresh(t),preset=studioPreset();
  const reward={id:'creation-gift',category:'creation',title:'家长小猫',description:'成长解锁固定作品',cost:0,unlockAt:10,preset};
  for(const invalid of [{...reward,preset:{}},{...reward,params:{headSize:1}},{...reward,preset:{params:{seed:-1}}}]){
    assert.throws(()=>store.savePreset(invalid,store.catalogRevision()),failStatus(400));
  }
  store.savePreset(reward,store.catalogRevision());
  assert.ok(!store.snapshot().owned.includes(reward.id));store.points(grant(10));
  assert.ok(store.snapshot().owned.includes(reward.id));store.equip(reward.id);
  assert.deepEqual(store.studio().preset,preset);
  assert.deepEqual(store.exportData().ledger.find(r=>r.rewardId===reward.id).rewardSnapshot.preset,preset);
  const legacy={id:'legacy-editor',category:'capability',title:'旧编辑权限',description:'旧数据仍保留',cost:0,unlockAt:0,params:{capability:'editor-body'}};
  store.savePreset(legacy,store.catalogRevision());
  assert.ok(store.snapshot().owned.includes(legacy.id));assert.deepEqual(store.snapshot().access.editors,[]);
  assert.ok(store.snapshot().rewards.find(r=>r.id===legacy.id).menuOnly);
});
