import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { fail, text, integer, validateCatalog, composeParams } from './catalog.mjs';
import { createLocalLedger } from './localLedger.mjs';
import { SCENE_SLOTS, composeScene } from './environmentSchema.mjs';
import { SCENE_CATALOG_ADDITIONS } from './environmentRewards.mjs';
import { resolve } from 'node:path';
import { missingUpstreamRewards, upstreamAccess } from './upstreamRewards.mjs';
import { validateStudio } from './studioSchema.mjs';

/** All balance/ownership/ledger changes are committed in ONE SQLite transaction. */
export function createStore(filename, initialCatalog) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK(id=1), childName TEXT NOT NULL, petName TEXT NOT NULL,
      balance INTEGER NOT NULL CHECK(balance>=0 AND balance<=10000000), lifetime INTEGER NOT NULL CHECK(lifetime>=0 AND lifetime<=10000000), version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS owned (id TEXT PRIMARY KEY, obtainedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS equipped (slot TEXT PRIMARY KEY, id TEXT NOT NULL REFERENCES owned(id));
    CREATE TABLE IF NOT EXISTS ledger (id TEXT PRIMARY KEY, kind TEXT NOT NULL, delta INTEGER NOT NULL, reason TEXT NOT NULL, rewardId TEXT, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS credentials (role TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (tokenHash TEXT PRIMARY KEY, role TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    INSERT OR IGNORE INTO profile VALUES (1,'小朋友','小橘',0,0,0);`);
  const getSetting = key => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
  const setSetting = (key,value) => db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
  if (!getSetting('catalog')) setSetting('catalog',JSON.stringify(validateCatalog(initialCatalog)));
  const catalog = () => validateCatalog(JSON.parse(getSetting('catalog')));
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const result=fn(); db.exec('COMMIT'); return result; } catch(error) { db.exec('ROLLBACK'); throw error; } };
  const bump = () => db.prepare('UPDATE profile SET version=version+1 WHERE id=1').run();
  const ledger = createLocalLedger(db, catalog);
  const log = ledger.log;
  const catalogRevision = () => createHash('sha256').update(JSON.stringify(catalog())).digest('hex');
  const grantMembers = reward => {
    const complete=reward.category==='capability'&&reward.params.capability==='complete';
    if(reward.category!=='theme'&&!complete)return;
    const members=complete?catalog().rewards.map(r=>r.id):Object.values(reward.params.members);
    for(const id of members){
      const result=db.prepare('INSERT OR IGNORE INTO owned VALUES (?,?)').run(id,new Date().toISOString());
      if(result.changes)log('gift',0,`套装物品：${reward.title}`,id);
    }
  };
  const grantMilestones = () => {
    const {lifetime}=db.prepare('SELECT lifetime FROM profile WHERE id=1').get();
    for (const reward of catalog().rewards) {
      if (reward.cost !== 0 || reward.unlockAt > lifetime) continue;
      const result=db.prepare('INSERT OR IGNORE INTO owned VALUES (?,?)').run(reward.id,new Date().toISOString());
      if (result.changes) { log('gift',0,`成长礼物：${reward.title}`,reward.id); grantMembers(reward); }
      if (reward.starter) db.prepare('INSERT OR IGNORE INTO equipped VALUES (?,?)').run(reward.category,reward.id);
    }
  };
  tx(grantMilestones);
  function snapshot(parent=false) {
    const profile=db.prepare('SELECT childName,petName,balance,lifetime,version FROM profile WHERE id=1').get();
    const owned=db.prepare('SELECT id FROM owned').all().map(r=>r.id);
    const equipped=Object.fromEntries(db.prepare('SELECT slot,id FROM equipped').all().map(r=>[r.slot,r.id]));
    const config=catalog();
    return { ...profile, owned, equipped, params:composeParams(config,equipped), sceneParams:composeScene(config,equipped),
      rewards:config.rewards.map(r => {
        const {params,action,motion,...publicData}=r;
        return {...publicData, owned:owned.includes(r.id), eligible:profile.lifetime>=r.unlockAt,
          affordable:profile.balance>=r.cost, equipped:equipped[r.category]===r.id,
          ...(parent ? {params,action,...(motion ? {motion} : {})} : {})};
      }),
      ...(parent ? {catalogRevision:catalogRevision()} : {}),
      ledger:ledger.latest() };
  }
  function mutate(key,payload,fn) {
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(key)) fail(400,'需要有效的幂等请求 ID');
    const fingerprint=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return tx(()=>{
      const existing=db.prepare('SELECT fingerprint FROM requests WHERE key=?').get(key);
      if (existing) { if (existing.fingerprint!==fingerprint) fail(409,'请求 ID 已用于其他操作'); return false; }
      fn(); grantMilestones(); bump();
      db.prepare('INSERT INTO requests VALUES (?,?)').run(key,fingerprint);
      return true;
    });
  }
  function saveCatalog(input, expectedRevision) {
    const next = validateCatalog(input);
    tx(() => {
      if (expectedRevision !== undefined && expectedRevision !== catalogRevision()) fail(409,'奖励目录已在其他页面修改。请保留当前草稿，重新读取目录后再保存。');
      for (const old of catalog().rewards) {
        const item = next.rewards.find(r => r.id === old.id);
        // Object key order can change during JSON import or form editing.
        if(old.category==='theme'&&SCENE_SLOTS.some(slot=>item?.params?.members?.[slot]!==old.params.members[slot]))fail(409,'已有套装的成员不可变，请复制为新套装');
        if (!item || item.category !== old.category || !!item.starter !== !!old.starter) fail(409,'不能删除已有奖励或改变其类别、初始标记；可添加新奖励');
      }
      setSetting('catalog', JSON.stringify(next)); grantMilestones(); bump();
      log('catalog', 0, '家长更新了奖励配置');
    });
    return snapshot(true);
  }
  return {
    db, tx, catalog, catalogRevision, snapshot, getSetting, setSetting,
    studio(parent=false) {
      const state=snapshot(parent),access=upstreamAccess(catalog(),state.owned);
      const saved=JSON.parse(getSetting('studioPreset')||'{}');
      return {state,access:parent?{...access,full:true}:access,preset:parent||access.full?saved:{},revision:getSetting('studioRevision')||'0'};
    },
    saveStudio(preset,expectedRevision) {
      const next=validateStudio(preset);
      tx(()=>{
        if(expectedRevision!==(getSetting('studioRevision')||'0'))fail(409,'原版方案已在其他页面修改，请重新载入后保存');
        setSetting('studioPreset',JSON.stringify(next));setSetting('studioRevision',randomUUID());bump();
        log('catalog',0,'家长保存了原版完整参数方案');
      });
      return this.studio(true);
    },
    installUpstreamRewards() {
      if(getSetting('upstreamRewardsVersion')==='1')return;
      tx(()=>{
        const next=catalog();next.rewards.push(...missingUpstreamRewards(next));
        setSetting('catalog',JSON.stringify(validateCatalog(next)));grantMilestones();
        setSetting('upstreamRewardsVersion','1');bump();log('catalog',0,'本地升级：补齐原版花色、姿态、眼睛、动作与完整创作室');
      });
    },
    history: ledger.history,
    installSceneRewards() {
      // One-time transaction. Never reset existing prices, ownership, history or appearance.
      if(getSetting('sceneRewardsVersion')==='1')return;
      tx(()=>{
        const next=catalog();
        for(const item of SCENE_CATALOG_ADDITIONS){
          const existing=next.rewards.find(r=>r.id===item.id);
          if(existing&&existing.category!==item.category)fail(409,'场景预置 ID 与自定义奖励冲突，请先重命名自定义奖励');
          if(!existing)next.rewards.push(structuredClone(item));
        }
        setSetting('catalog',JSON.stringify(validateCatalog(next)));
        grantMilestones();setSetting('sceneRewardsVersion','1');bump();
        log('catalog',0,'本地升级：加入场景奖励，原积分与已有预设保持不变');
      });
    },
    unequip(slot) {
      if(!SCENE_SLOTS.includes(slot))fail(400,'仅支持卸下场景槽位');
      tx(()=>{
        const starter=catalog().rewards.find(r=>r.category===slot&&r.starter);
        if(!starter)fail(409,'此槽位尚未初始化');
        db.prepare('INSERT INTO equipped VALUES (?,?) ON CONFLICT(slot) DO UPDATE SET id=excluded.id').run(slot,starter.id);
        db.prepare("DELETE FROM equipped WHERE slot='theme'").run();bump();
      });return snapshot();
    },
    storageInfo() { return { engine:'SQLite', localOnly:true, persistent:filename!==':memory:', path:filename===':memory:'?null:resolve(filename), ledgerCount:db.prepare('SELECT count(*) AS n FROM ledger').get().n, rewardCount:catalog().rewards.length }; },
    points({delta,reason,idempotencyKey}) {
      integer(delta,'积分变动',-10000,10000); if (!delta) fail(400,'积分变动不能为 0');
      reason=text(reason,'原因',120);
      mutate(idempotencyKey,{operation:'points',delta,reason},()=>{
        const p=snapshot();
        if (p.balance+delta<0) fail(409,'更正后余额不能小于 0');
        if (p.balance+delta>10000000 || p.lifetime+Math.max(0,delta)>10000000) fail(409,'积分已达到上限');
        db.prepare('UPDATE profile SET balance=balance+?, lifetime=lifetime+? WHERE id=1').run(delta,Math.max(0,delta));
        log(delta>0?'earn':'adjustment',delta,reason);
      });
      return snapshot(true);
    },
    purchase({rewardId,idempotencyKey,expectedCost}) {
      rewardId=text(rewardId,'奖励 ID',64);
      integer(expectedCost,'确认价格');
      mutate(idempotencyKey,{operation:'purchase',rewardId,expectedCost},()=>{
        const reward=catalog().rewards.find(r=>r.id===rewardId);
        if (!reward) fail(404,'没有这个奖励');
        if (reward.cost!==expectedCost) fail(409,'奖励价格已变动，请重新查看并确认');
        if (db.prepare('SELECT id FROM owned WHERE id=?').get(rewardId)) return;
        const p=snapshot();
        if (p.lifetime<reward.unlockAt) fail(409,'成长积分尚未达到门槛');
        if (p.balance<reward.cost) fail(409,'可兑换积分不足');
        db.prepare('UPDATE profile SET balance=balance-? WHERE id=1').run(reward.cost);
        db.prepare('INSERT INTO owned VALUES (?,?)').run(rewardId,new Date().toISOString());
        log('purchase',-reward.cost,`兑换：${reward.title}`,rewardId); grantMembers(reward);
      });
      return snapshot();
    },
    equip(rewardId) {
      rewardId=text(rewardId,'奖励 ID',64);
      tx(()=>{
        const reward=catalog().rewards.find(r=>r.id===rewardId);
        if (!reward || !db.prepare('SELECT id FROM owned WHERE id=?').get(rewardId)) fail(403,'尚未拥有这个奖励');
        if (reward.category==='trick') fail(400,'互动动作请使用播放接口');
        if (reward.category==='capability') fail(400,'原版功能请进入原版互动页面使用');
        if(reward.category==='theme'){
          for(const [slot,id]of Object.entries(reward.params.members)){
            if(!db.prepare('SELECT id FROM owned WHERE id=?').get(id))fail(409,'套装成员拥有权不完整');
            db.prepare('INSERT INTO equipped VALUES (?,?) ON CONFLICT(slot) DO UPDATE SET id=excluded.id').run(slot,id);
          }
        } else if(SCENE_SLOTS.includes(reward.category))db.prepare("DELETE FROM equipped WHERE slot='theme'").run();
        db.prepare('INSERT INTO equipped VALUES (?,?) ON CONFLICT(slot) DO UPDATE SET id=excluded.id').run(reward.category,rewardId);
        bump();
      }); return snapshot();
    },
    play(rewardId) {
      const reward=catalog().rewards.find(r=>r.id===rewardId);
      if (!reward || reward.category!=='trick' || !db.prepare('SELECT id FROM owned WHERE id=?').get(rewardId)) fail(403,'尚未拥有这个互动动作');
      return {action:reward.action,...(reward.motion ? {motion:reward.motion} : {}),rewardId,playId:randomUUID()};
    },
    profile({childName,petName}) {
      childName=text(childName,'孩子昵称',20); petName=text(petName,'小猫名字',20);
      tx(()=>{ db.prepare('UPDATE profile SET childName=?,petName=? WHERE id=1').run(childName,petName); bump(); });
      return snapshot(true);
    },
    saveCatalog,
    savePreset(reward, expectedRevision) {
      if (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision)) fail(400,'保存预设需要目录版本');
      if (!reward || typeof reward !== 'object' || Array.isArray(reward)) fail(400,'需要完整奖励对象');
      const next = catalog(), index = next.rewards.findIndex(r => r.id === reward.id);
      if (index < 0) next.rewards.push(reward); else next.rewards[index] = reward;
      return saveCatalog(next, expectedRevision);
    },
    exportData() { return {schemaVersion:1,exportedAt:new Date().toISOString(),profile:snapshot(true),catalog:catalog(),studioPreset:JSON.parse(getSetting('studioPreset')||'{}'),ledger:ledger.all()}; },
    close() { db.close(); }
  };
}
