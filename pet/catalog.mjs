import { SCENE_SLOTS } from './environmentSchema.mjs';
import { ACTION_IDS, validateScript } from './motionPrograms.mjs';
import { PARAM_FIELDS, MOTION_FIELDS } from './presetSchema.mjs';
import { validateStudio } from './studioSchema.mjs';
/** Strict capability schema shared by the service and tests. No arbitrary JS/URLs. */
export { AppError, fail, object, text, integer, validateFields } from './validation.mjs';
import { fail, object, text, integer, validateFields } from './validation.mjs';
import {validateModelReward} from './modelCatalog.mjs';
export const CAT_SLOTS = ['coat', 'shape', 'eyes', 'pose'];
export const SLOTS = [...CAT_SLOTS,...SCENE_SLOTS];
export const ACTIONS = ACTION_IDS;
export const DEFAULT_PARAMS = Object.freeze({ catAppearance:'native', seed:20260916, pose:'standing', coatId:'orange', eyeColor:'#d99a2b', oddEyes:false, eyeColorRight:'#5b8fd4', headSize:1.08, chubbiness:1.15, legLength:0.85, earSize:1, eyeSize:1.05, eyeSpacing:1, irisScale:0.65, irisHighlightScale:1, wateryEyes:false, wateryEyeShape:1.1, tailLength:0.95, tailCurl:0.35, fluffy:false, furFluff:0.9, outlineJitter:0.25, dynamicCoat:false, motionDebug:false });
export function validateCatalog(input) {
  object(input,['schemaVersion','rewards']);
  if (input.schemaVersion !== 1 || !Array.isArray(input.rewards) || input.rewards.length > 512) fail(400,'奖励配置版本或数量不正确');
  const ids = new Set(); const starters = new Set();
  for (const reward of input.rewards) {
    object(reward,['id','title','description','category','cost','unlockAt','starter','params','action','motion','preset']);
    if (typeof reward.id !== 'string' || !/^[a-z][a-z0-9-]{2,63}$/.test(reward.id) || ids.has(reward.id)) fail(400,'奖励 ID 无效或重复');
    ids.add(reward.id);
    text(reward.title,'奖励名称',30); text(reward.description,'奖励说明',140);
    if (![...SLOTS,'trick','theme','capability','creation','model'].includes(reward.category)) fail(400,'奖励类别不正确');
    integer(reward.cost,'价格'); integer(reward.unlockAt,'成长门槛');
    if (reward.starter !== undefined && typeof reward.starter !== 'boolean') fail(400,'starter 必须为布尔值');
    if (reward.starter) {
      if (!SLOTS.includes(reward.category) || reward.cost || reward.unlockAt || starters.has(reward.category)) fail(400,'每个装扮类别必须且只能有一个免费初始奖励');
      starters.add(reward.category);
    }
    if(reward.category==='model'){
      try { validateModelReward(reward); } catch(error) { fail(400,error.message); }
      continue;
    }
    if(reward.category==='creation'){
      if(reward.params!==undefined||reward.action!==undefined||reward.motion!==undefined||reward.starter)fail(400,'家长作品只接受完整参数方案');
      validateStudio(reward.preset);
      if(!reward.preset.params||!Object.keys(reward.preset.params).length)fail(400,'请先生成或调整小猫，再保存作品');
      continue;
    }
    if(reward.preset!==undefined)fail(400,'只有家长作品可以包含完整参数方案');
    if(reward.category==='theme'){
      if(reward.action!==undefined||reward.motion!==undefined||reward.starter)fail(400,'套装不能是动作或初始奖励');
      object(reward.params,['members']); object(reward.params.members,SCENE_SLOTS);
      if(!Object.keys(reward.params.members).length)fail(400,'套装至少包含一个场景物品');
      continue;
    }
    if (reward.category === 'trick') {
      if (!ACTIONS.includes(reward.action) || reward.params !== undefined) fail(400,'不支持的互动动作');
      if (reward.motion !== undefined) {
        object(reward.motion,[...MOTION_FIELDS.map(f=>f.key),'script']);
        const {script,...settings}=reward.motion;
        if(Object.keys(settings).length)validateFields(settings,MOTION_FIELDS);
        else if(script===undefined)fail(400,'动作参数不能为空');
      }
      if (reward.action === 'sequence') { try { validateScript(reward.motion?.script); } catch (error) { fail(400,error.message); } }
      else if (reward.motion?.script !== undefined) fail(400,'仅自定义动作脚本接受步骤');
      continue;
    }
    if (reward.action !== undefined || reward.motion !== undefined) fail(400,'装扮奖励不能包含互动动作');
    validateFields(reward.params, PARAM_FIELDS[reward.category]);
  }
  if (CAT_SLOTS.some(slot=>!starters.has(slot))) fail(400,'缺少花色、外形、眼睛或姿态的初始奖励');
  for(const slot of SCENE_SLOTS)if(input.rewards.some(r=>r.category===slot)&&!starters.has(slot))fail(400,`缺少 ${slot} 的初始配置`);
  for(const r of input.rewards){
    if(r.category==='theme')for(const [slot,id]of Object.entries(r.params.members)){
      if(typeof id!=='string'||!input.rewards.some(item=>item.id===id&&item.category===slot))fail(400,'套装只能引用已有的对应类别场景物品，不能嵌套套装');
    }
    if(r.category==='effect'&&r.params.kind==='fog'&&(r.params.near??8)>=(r.params.far??28))fail(400,'雾终点必须大于起点');
    if(r.category==='toy' && (r.params.count??3)>({ball:1,fish:3,duck:3,yarn:5,mixed:5,none:5}[r.params.kind]??5))fail(400,'此类型玩具的数量超出原版可用数量');
    if(r.category==='bed'&&r.params.kind==='cushion'&&r.params.placement==='inside')fail(400,'软垫仅支持旁置；进入功能用于六类容器');
  }
  return structuredClone(input);
}
export function composeParams(catalog, equipped, defaults = {}) {
  const params = {...DEFAULT_PARAMS, ...defaults};
  for (const slot of CAT_SLOTS) {
    const reward = catalog.rewards.find(r => r.id === equipped[slot] && r.category === slot);
    if (reward) Object.assign(params,reward.params);
  }
  return params;
}
