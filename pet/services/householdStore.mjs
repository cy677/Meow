import { MODEL_REWARDS, MODEL_SLOTS, modelDefinition, modelSlot, equippedModels } from '../modelCatalog.mjs';
import { openHouseholdDatabase } from '../repositories/database.mjs';
import { createHouseholdRepository } from '../repositories/householdRepository.mjs';
import { createGrowthStore } from '../growthStore.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { fail, text, integer, validateCatalog, composeParams } from '../catalog.mjs';
import { createLocalLedger } from '../localLedger.mjs';
import { SCENE_SLOTS, composeScene } from '../environmentSchema.mjs';
import { SCENE_CATALOG_ADDITIONS } from '../environmentRewards.mjs';
import { resolve } from 'node:path';
import { missingUpstreamRewards, upstreamAccess, unlockOriginals, restoreSpecialPrices, BASIC_ACTIONS } from '../upstreamRewards.mjs';
import { validateStudio } from '../studioSchema.mjs';
import { isMenuOnly } from '../editorRewards.mjs';

/** All balance/ownership/ledger changes are committed in ONE SQLite transaction. */
export function createStore(filename, initialCatalog) {
  const { db, tx } = openHouseholdDatabase(filename);
  const repo = createHouseholdRepository(db);
  const getSetting = key => repo.setting(key)?.value;
  const setSetting = (key,value) => repo.setSetting(key,value);
  if (!getSetting('catalog')) setSetting('catalog',JSON.stringify(validateCatalog(initialCatalog)));
  const catalog = () => validateCatalog(JSON.parse(getSetting('catalog')));
  const bump = () => repo.bump();
  const ledger = createLocalLedger(db, catalog);
  const log = ledger.log;
  const catalogRevision = () => createHash('sha256').update(JSON.stringify(catalog())).digest('hex');
  const grantMembers = reward => {
    if(reward.category!=='theme')return;
    const members=Object.values(reward.params.members);
    for(const id of members){
      const result=repo.grantOwned(id,new Date().toISOString());
      if(result.changes)log('gift',0,`套装物品：${reward.title}`,id);
    }
  };
  const grantMilestones = () => {
    const {lifetime}=repo.lifetime();
    for (const reward of catalog().rewards) {
      if (reward.cost !== 0 || reward.unlockAt > lifetime) continue;
      const result=repo.grantOwned(reward.id,new Date().toISOString());
      if (result.changes) { log('gift',0,`成长礼物：${reward.title}`,reward.id); grantMembers(reward); }
      if (reward.starter) repo.starterEquip(reward.category,reward.id);
    }
  };
  tx(grantMilestones);
  const growth = createGrowthStore({db,tx,mutate,bump,log,getSetting,setSetting,snapshot});
  function snapshot(parent=false) {
    const profile=repo.profile();
    const owned=repo.owned().map(r=>r.id);
    const equipped=Object.fromEntries(repo.equipped().map(r=>[r.slot,r.id]));
    const config=catalog();
    const scriptSelection=JSON.parse(getSetting('randomScriptSelection')||'{}');
    const inScript=r=>owned.includes(r.id)&&['pose','trick'].includes(r.category)&&(scriptSelection[r.id]??(r.category==='trick'&&BASIC_ACTIONS.includes(r.action)));
    const randomScript=config.rewards.filter(inScript).map(r=>({id:r.id,title:r.title,category:r.category,...(r.category==='pose'?{params:r.params}:{action:r.action,motion:r.motion})}));
    const active=config.rewards.find(r=>r.category==='creation'&&r.id===equipped.creation&&owned.includes(r.id));
    return { ...profile, growthProfile:growth.profile(), owned, equipped, randomScript, creation:active?{id:active.id,preset:active.preset}:null, access:upstreamAccess(config,owned), params:composeParams(config,equipped), sceneParams:composeScene(config,equipped), models:equippedModels(config,equipped,owned),
      rewards:config.rewards.map(r => {
        const {params,action,motion,preset,...publicData}=r;
        return {...publicData, inRandomScript:!!inScript(r), menuOnly:isMenuOnly(r), owned:owned.includes(r.id), eligible:profile.lifetime>=r.unlockAt,
          affordable:profile.balance>=r.cost, equipped:equipped[modelSlot(r)]===r.id&&(!active||r.category==='creation'||r.category==='model'),
          ...(r.category==='model'?{modelId:r.params.modelId,modelSlot:modelSlot(r),modelGroup:modelDefinition(r.params.modelId).group}:{}),
          ...(parent ? {params,action,...(motion ? {motion} : {}),...(preset?{preset}:{})} : {})};
      }),
      ...(parent ? {catalogRevision:catalogRevision()} : {}),
      ledger:ledger.latest() };
  }
  function mutate(key,payload,fn) {
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(key)) fail(400,'需要有效的幂等请求 ID');
    const fingerprint=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return tx(()=>{
      const existing=repo.request(key);
      if (existing) { if (existing.fingerprint!==fingerprint) fail(409,'请求 ID 已用于其他操作'); return false; }
      fn(); grantMilestones(); bump();
      repo.saveRequest(key,fingerprint);
      return true;
    });
  }
  function saveCatalog(input, expectedRevision) {
    const validated = validateCatalog(input);
    const next = ['2','3'].includes(getSetting('upstreamRewardsVersion'))?unlockOriginals(validated):validated;
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
    db, tx, catalog, catalogRevision, snapshot, getSetting, setSetting, growth,
    studio(parent=false) {
      const state=snapshot(parent),access=upstreamAccess(catalog(),state.owned);
      const saved=JSON.parse(getSetting('studioPreset')||'{}');
      const preset=parent?saved:state.creation?.preset||{};
      return {state,access:parent?{...access,full:true}:access,preset,revision:parent?getSetting('studioRevision')||'0':createHash('sha256').update(JSON.stringify(state.creation)).digest('hex')};
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
    installModelRewards() {
      if(getSetting('modelRewardsVersion')==='1')return;
      tx(()=>{
        const next=catalog();
        for(const item of MODEL_REWARDS){
          const old=next.rewards.find(r=>r.id===item.id);
          if(old&&(old.category!=='model'||old.params?.modelId!==item.params.modelId))fail(409,'模型奖励 ID 与已有奖励冲突，未修改原数据');
          if(!old)next.rewards.push(structuredClone(item));
        }
        setSetting('catalog',JSON.stringify(validateCatalog(next)));
        grantMilestones();setSetting('modelRewardsVersion','1');bump();
        log('catalog',0,'本地升级：加入14项模型奖励，保留原积分、价格、收藏和场景');
      });
    },
    installGrowthReward() {
      if(getSetting('growthRewardVersion')==='1')return;
      tx(()=>{
        const next=catalog();
        if(!next.rewards.some(r=>r.id==='growth-eyes-mint')){
          next.rewards.unshift({id:'growth-eyes-mint',title:'薄荷小眼睛',description:'2枚喵币的小礼物，换一双柔和的薄荷色眼睛。',category:'eyes',cost:2,unlockAt:0,params:{eyeColor:'#8cb7a1'}});
          setSetting('catalog',JSON.stringify(validateCatalog(next)));
        }
        setSetting('growthRewardVersion','1');bump();
      });
    },
    installUpstreamRewards() {
      if(getSetting('upstreamRewardsVersion')==='3')return;
      tx(()=>{
        const next=catalog();next.rewards.push(...missingUpstreamRewards(next));
        setSetting('catalog',JSON.stringify(validateCatalog(unlockOriginals(restoreSpecialPrices(next)))));grantMilestones();
        setSetting('upstreamRewardsVersion','3');bump();log('catalog',0,'本地升级：收藏全部可见，基础动作自动播放，特殊动作按积分解锁；保留已有收藏');
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
      if(MODEL_SLOTS.includes(slot)){
        tx(()=>{repo.unequip(slot);bump();});
        return snapshot();
      }
      if(!SCENE_SLOTS.includes(slot))fail(400,'仅支持卸下场景槽位');
      tx(()=>{
        const starter=catalog().rewards.find(r=>r.category===slot&&r.starter);
        if(!starter)fail(409,'此槽位尚未初始化');
        repo.equip(slot,starter.id);
        repo.clearThemeAndCreation();bump();
      });return snapshot();
    },
    storageInfo() { return { engine:'SQLite', localOnly:true, persistent:filename!==':memory:', path:filename===':memory:'?null:resolve(filename), ledgerCount:repo.ledgerCount().n, rewardCount:catalog().rewards.length }; },
    points({delta,reason,idempotencyKey}) {
      integer(delta,'积分变动',-10000,10000); if (!delta) fail(400,'积分变动不能为 0');
      reason=text(reason,'原因',120);
      mutate(idempotencyKey,{operation:'points',delta,reason},()=>{
        const p=snapshot();
        if (p.balance+delta<0) fail(409,'更正后余额不能小于 0');
        if (p.balance+delta>10000000 || p.lifetime+Math.max(0,delta)>10000000) fail(409,'积分已达到上限');
        repo.addPoints(delta,Math.max(0,delta));
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
        if (repo.hasOwned(rewardId)) return;
        if(reward.category==='capability')fail(400,'参数和随机生成由家长管理，无需兑换功能权限');
        const p=snapshot();
        if (p.lifetime<reward.unlockAt) fail(409,'成长积分尚未达到门槛');
        if (p.balance<reward.cost) fail(409,'可兑换积分不足');
        repo.spendPoints(reward.cost);
        repo.saveOwned(rewardId,new Date().toISOString());
        log('purchase',-reward.cost,`兑换：${reward.title}`,rewardId); grantMembers(reward);
      });
      return snapshot();
    },
    setRandomScript(rewardId,enabled) {
      rewardId=text(rewardId,'奖励 ID',64);
      if(typeof enabled!=='boolean')fail(400,'需要明确是否加入随机脚本');
      tx(()=>{
        const reward=catalog().rewards.find(r=>r.id===rewardId);
        if(!reward||!repo.hasOwned(rewardId))fail(403,'尚未拥有这个奖励');
        if(!['pose','trick'].includes(reward.category))fail(400,'只有姿势和动作可以加入随机脚本');
        const selection=JSON.parse(getSetting('randomScriptSelection')||'{}');
        selection[rewardId]=enabled;setSetting('randomScriptSelection',JSON.stringify(selection));bump();
      });
      return snapshot();
    },
    equip(rewardId) {
      rewardId=text(rewardId,'奖励 ID',64);
      tx(()=>{
        const reward=catalog().rewards.find(r=>r.id===rewardId);
        if (!reward || !repo.hasOwned(rewardId)) fail(403,'尚未拥有这个奖励');
        if (reward.category==='trick') fail(400,'互动动作请使用播放接口');
        if (reward.category==='capability') fail(400,'原版功能已默认开放，请使用功能菜单');
        if(!['creation','model'].includes(reward.category))repo.clearCreation();
        if(reward.category==='theme'){
          for(const [slot,id]of Object.entries(reward.params.members)){
            if(!repo.hasOwned(id))fail(409,'套装成员拥有权不完整');
            repo.equip(slot,id);
          }
        } else if(SCENE_SLOTS.includes(reward.category))repo.clearTheme();
        repo.equip(modelSlot(reward),rewardId);
        bump();
      }); return snapshot();
    },
    play(rewardId) {
      const reward=catalog().rewards.find(r=>r.id===rewardId);
      if (!reward || reward.category!=='trick' || !repo.hasOwned(rewardId)) fail(403,'尚未拥有这个互动动作');
      return {action:reward.action,...(reward.motion ? {motion:reward.motion} : {}),rewardId,playId:randomUUID()};
    },
    profile({childName,petName}) {
      childName=text(childName,'孩子昵称',20); petName=text(petName,'小猫名字',20);
      tx(()=>{ repo.setNames(childName,petName); bump(); });
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
    exportData() { return {schemaVersion:2,growth:growth.exportData(),exportedAt:new Date().toISOString(),profile:snapshot(true),catalog:catalog(),studioPreset:JSON.parse(getSetting('studioPreset')||'{}'),ledger:ledger.all()}; },
    close() { db.close(); }
  };
}
