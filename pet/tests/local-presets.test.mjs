import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../store.mjs';
import { createPetServer } from '../server.mjs';
import { validateCatalog, validateFields } from '../catalog.mjs';
import { PARAM_FIELDS, MOTION_FIELDS, defaultsFor } from '../presetSchema.mjs';
const base = JSON.parse(readFileSync(new URL('../rewards.json', import.meta.url), 'utf8'));
const grant = (reason, delta = 10) => ({ reason, delta, idempotencyKey: randomUUID() });
const reward = (id = 'custom-shape') => ({ id, title:'家长的小团子', description:'通过参数表单预设的小猫', category:'shape', cost:10, unlockAt:20, params:defaultsFor('shape', { chubbiness:1.65, legLength:0.6 }) });
const fresh = t => { const s = createStore(':memory:', base); t.after(() => s.close()); return s; };
const throws = (fn, status) => assert.throws(fn, error => error.status === status);

test('预设表单的每个默认值、全部花色及姿态均通过服务端同源校验', () => {
  for (const category of Object.keys(PARAM_FIELDS)) validateFields(defaultsFor(category), PARAM_FIELDS[category]);
  for (const [coatId] of PARAM_FIELDS.coat[0].choices) validateFields(defaultsFor('coat', { coatId, dynamicCoat:true }), PARAM_FIELDS.coat);
  for (const [pose] of PARAM_FIELDS.pose[0].choices) validateFields({ pose }, PARAM_FIELDS.pose);
  const config = structuredClone(base);
  config.rewards.push({ ...reward(), category:'trick', id:'custom-spin', params:undefined, action:'spin', motion:{ duration:2, turns:2 } });
  validateCatalog(JSON.parse(JSON.stringify(config)));
});

test('自定义花色、体型、眼睛与动作拒绝越界、错类型和额外字段', () => {
  throws(() => validateFields({ dynamicCoat:true, dynamicCoatBase:'red' }, PARAM_FIELDS.coat), 400);
  throws(() => validateFields({ dynamicCoatCount:1.5 }, PARAM_FIELDS.coat), 400);
  throws(() => validateFields({ eyeSpacing:0.1 }, PARAM_FIELDS.eyes), 400);
  throws(() => validateFields({ fluffy:'true' }, PARAM_FIELDS.shape), 400);
  throws(() => validateFields({ height:2 }, MOTION_FIELDS), 400);
  throws(() => validateFields({ duration:0 }, MOTION_FIELDS), 400);
  throws(() => validateFields({ turns:1.5 }, MOTION_FIELDS), 400);
  throws(() => validateFields({ path:'https://example.org' }, MOTION_FIELDS), 400);
});

test('加分理由不能缺失或空白；保留原文理由并可查询', t => {
  const s = fresh(t);
  for (const reason of [undefined, null, '', '  \n\t ', 123, []]) throws(() => s.points(grant(reason)), 400);
  s.points(grant('  主动整理书包  ', 7));
  assert.equal(s.history({ kind:'earn' }).entries[0].reason, '主动整理书包');
  assert.equal(s.snapshot().balance, 7);
});

test('135 条早期理由全部可分页访问，重复时间戳不丢失记录', t => {
  const s = fresh(t);
  for (let i = 0; i < 135; i++) s.points(grant(`阅读记录-${i}`, 1));
  let before = null, ids = [], reasons = [];
  do {
    const page = s.history({ limit:40, before, kind:'earn' });
    assert.equal(page.total, 135); ids.push(...page.entries.map(r => r.id)); reasons.push(...page.entries.map(r => r.reason)); before = page.nextCursor;
  } while (before !== null);
  assert.equal(new Set(ids).size, 135); assert.equal(reasons[0], '阅读记录-134'); assert.equal(reasons.at(-1), '阅读记录-0');
  assert.equal(s.history({ q:'阅读记录-0', kind:'earn' }).total, 1);
});

test('理由搜索使用字面子串；游标与类型严格校验', t => {
  const s = fresh(t); s.points(grant("完成 100%_任务 '"));
  assert.equal(s.history({ q:'%_' }).total, 1);
  assert.equal(s.history({ q:"' OR 1=1 --" }).total, 0);
  throws(() => s.history({ before:-1 }), 400); throws(() => s.history({ limit:101 }), 400);
  throws(() => s.history({ kind:'sql' }), 400); throws(() => s.history({ q:'x'.repeat(121) }), 400);
});

test('旧版本地库迁移不重置已有流水，也不伪造旧奖励参数', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-v1-'));
  try {
    const file = join(dir, 'pet.sqlite'), old = new DatabaseSync(file);
    old.exec('CREATE TABLE ledger(id TEXT PRIMARY KEY,kind TEXT NOT NULL,delta INTEGER NOT NULL,reason TEXT NOT NULL,rewardId TEXT,createdAt TEXT NOT NULL)');
    old.prepare('INSERT INTO ledger VALUES (?,?,?,?,?,?)').run('old-purchase', 'purchase', -5, '旧版已兑换的猫', 'coat-grey', '2026-09-01T12:00:00Z'); old.close();
    let s = createStore(file, base);
    const entry = s.history({ kind:'purchase' }).entries[0];
    assert.equal(entry.id, 'old-purchase'); assert.equal(entry.reason, '旧版已兑换的猫'); assert.equal(entry.rewardSnapshot, null); s.close();
    s = createStore(file, base); assert.equal(s.history({ kind:'purchase' }).total, 1); s.close();
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('预设、积分、兑换时参数快照、拥有权与装扮在多次重启后保留', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-local-'));
  try {
    const file = join(dir, 'pet.sqlite'); let s = createStore(file, base);
    s.points(grant('坚持运动', 100)); s.savePreset(reward(), s.catalogRevision());
    s.purchase({ rewardId:'custom-shape', expectedCost:10, idempotencyKey:randomUUID() }); s.equip('custom-shape');
    const changed = reward(); changed.title = '改名后的团子'; changed.params.chubbiness = 1.9;
    s.savePreset(changed, s.catalogRevision()); s.close();
    s = createStore(file, base);
    assert.equal(s.snapshot().balance, 90); assert.equal(s.snapshot().lifetime, 100); assert.equal(s.snapshot().params.chubbiness, 1.9);
    assert.ok(s.snapshot().owned.includes('custom-shape'));
    const historical = s.history({ kind:'purchase' }).entries[0].rewardSnapshot;
    assert.equal(historical.title, '家长的小团子'); assert.equal(historical.params.chubbiness, 1.65);
    assert.equal(s.history({ kind:'earn' }).entries[0].reason, '坚持运动'); assert.equal(s.storageInfo().path, file);
    assert.equal(s.storageInfo().persistent, true); s.close();
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('目录版本防止两个家长页面互相覆盖；错误更新事务回滚', t => {
  const s = fresh(t), revision = s.catalogRevision();
  s.savePreset(reward(), revision);
  throws(() => s.savePreset(reward('another-preset'), revision), 409);
  assert.equal(s.catalog().rewards.length, 21);
  const changed = structuredClone(s.catalog().rewards.find(r => r.id === 'coat-grey')); changed.category = 'shape'; changed.params = { headSize:1 };
  throws(() => s.savePreset(changed, s.catalogRevision()), 409);
  assert.equal(s.catalog().rewards.find(r => r.id === 'coat-grey').category, 'coat');
});

test('新建零价格预设达到积分门槛后自动解锁，修改预设不重新收费', t => {
  const s = fresh(t), r = reward(); r.cost = 0; r.unlockAt = 50;
  s.savePreset(r, s.catalogRevision()); assert.ok(!s.snapshot().owned.includes(r.id));
  s.points(grant('认真阅读', 50)); assert.ok(s.snapshot().owned.includes(r.id));
  r.params.headSize = 1.3; s.savePreset(r, s.catalogRevision());
  assert.equal(s.snapshot().balance, 50); assert.equal(s.history({ kind:'gift', q:r.title }).total, 1);
});

test('自定义动作时长、高度、圈数保留并由播放接口返回', t => {
  const s = fresh(t), r = { id:'custom-dance', title:'两圈小猫', description:'慢慢转两圈', category:'trick', action:'spin', motion:{ duration:2, turns:2 }, cost:10, unlockAt:30 };
  s.savePreset(r, s.catalogRevision()); throws(() => s.play(r.id), 403);
  s.points(grant('认真阅读', 30)); s.purchase({ rewardId:r.id, expectedCost:10, idempotencyKey:randomUUID() });
  assert.deepEqual(s.play(r.id).motion, { duration:2, turns:2 });
});

test('HTTP：磁盘重启与新浏览器登录后仍能查看理由、预设和兑换内容；孩子不能改目录', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-http-local-')); let app;
  try {
    let origin, parent = {}, child = {};
    const start = async () => { app = await createPetServer({ dbPath:join(dir, 'pet.sqlite') }); await new Promise(r => app.server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${app.server.address().port}`; };
    const req = async (path, data, role = parent, method = data ? 'POST' : 'GET') => {
      const response = await fetch(origin + path, { method, headers:{ Cookie:role.cookie || '', ...(data ? { 'Content-Type':'application/json', 'X-Meow-Client':'points-pet', 'X-CSRF-Token':role.csrf || '' } : {}) }, ...(data ? { body:JSON.stringify(data) } : {}) });
      const result = await response.json(); return { status:response.status, data:result, cookie:response.headers.get('set-cookie')?.split(';')[0], csrf:result.csrf };
    };
    await start();
    parent = await req('/api/parent/setup', { setupToken:app.setupToken,age:6,mode:'school_basic',timeZone:'Asia/Shanghai', pin:'864209', childCode:'2468', childName:'本地测试', petName:'小橘' });
    child = await req('/api/child/login', { code:'2468' });
    assert.equal((await req('/api/parent/points', { delta:10, idempotencyKey:randomUUID() })).status, 400);
    assert.equal((await req('/api/parent/points', grant('自己收好了玩具', 60))).status, 200);
    let version = (await req('/api/parent/presets')).data.revision;
    assert.equal((await req('/api/parent/presets', { reward:reward(), expectedRevision:version }, child, 'PUT')).status, 401);
    assert.equal((await req('/api/parent/storage', null, child)).status, 401);
    assert.equal((await req('/api/parent/presets', { reward:reward(), expectedRevision:version }, parent, 'PUT')).status, 200);
    assert.equal((await req('/api/parent/presets', { reward:reward('stale-preset'), expectedRevision:version }, parent, 'PUT')).status, 409);
    assert.equal((await req('/api/purchase', { rewardId:'custom-shape', expectedCost:10, idempotencyKey:randomUUID() }, child)).status, 200);
    await app.close(); app = null; await start();
    assert.equal(app.setupToken, null);
    // Discard both browser sessions and log in again: nothing depends on localStorage/cookies for the balance.
    parent = await req('/api/parent/login', { code:'864209' }, {}); child = await req('/api/child/login', { code:'2468' }, {});
    assert.equal((await req('/api/state', null, child)).data.balance, 50);
    assert.equal((await req('/api/history?kind=earn', null, child)).data.entries[0].reason, '自己收好了玩具');
    assert.equal((await req('/api/history?kind=purchase', null, child)).data.entries[0].rewardSnapshot.params.chubbiness, 1.65);
    assert.equal((await req('/api/parent/presets')).data.catalog.rewards.at(-1).id, 'custom-shape');
    assert.equal((await req('/api/parent/storage')).data.persistent, true);
  } finally { if (app) await app.close(); rmSync(dir, { recursive:true, force:true }); }
});
