import { ACTION_IDS, validateScript } from './motionPrograms.mjs';
import { PARAM_FIELDS, MOTION_FIELDS } from './presetSchema.mjs';
/** Strict capability schema shared by the service and tests. No arbitrary JS/URLs. */
export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new AppError(status, message); };
export const SLOTS = ['coat', 'shape', 'eyes', 'pose'];
export const ACTIONS = ACTION_IDS;
export const DEFAULT_PARAMS = Object.freeze({ seed:20260916, pose:'standing', coatId:'orange', eyeColor:'#d99a2b', oddEyes:false, eyeColorRight:'#5b8fd4', headSize:1.08, chubbiness:1.15, legLength:0.85, earSize:1, eyeSize:1.05, eyeSpacing:1, irisScale:0.65, irisHighlightScale:1, wateryEyes:false, wateryEyeShape:1.1, tailLength:0.95, tailCurl:0.35, fluffy:false, furFluff:0.9, outlineJitter:0.25, dynamicCoat:false, motionDebug:false });
export function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400,'需要 JSON 对象');
  if (Object.keys(value).some(k => !keys.includes(k))) fail(400,'包含不支持的字段');
  return value;
}
export function text(value, name, max=80, min=1) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(400,`${name}长度应为 ${min}–${max} 个字符`);
  return value.trim();
}
export function integer(value, name, min=0, max=1000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(400,`${name}必须是 ${min}–${max} 的整数`);
  return value;
}
export function validateFields(params, fields) {
  object(params, fields.map(f => f.key));
  if (!Object.keys(params).length) fail(400,'奖励参数不能为空');
  for (const [key, value] of Object.entries(params)) {
    const field = fields.find(f => f.key === key);
    if (field.type === 'select') {
      if (!field.choices.some(c => c[0] === value)) fail(400,`未知${field.label}`);
    } else if (field.type === 'checkbox') {
      if (typeof value !== 'boolean') fail(400,`${field.label}必须为布尔值`);
    } else if (field.type === 'color') {
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail(400,`${field.label}应为六位十六进制颜色`);
    } else if (!Number.isFinite(value) || value < field.min || value > field.max || (field.step === 1 && !Number.isInteger(value))) {
      fail(400,`${field.label}超出范围或不是有效数字`);
    }
  }
}
export function validateCatalog(input) {
  object(input,['schemaVersion','rewards']);
  if (input.schemaVersion !== 1 || !Array.isArray(input.rewards) || input.rewards.length > 200) fail(400,'奖励配置版本或数量不正确');
  const ids = new Set(); const starters = new Set();
  for (const reward of input.rewards) {
    object(reward,['id','title','description','category','cost','unlockAt','starter','params','action','motion']);
    if (typeof reward.id !== 'string' || !/^[a-z][a-z0-9-]{2,63}$/.test(reward.id) || ids.has(reward.id)) fail(400,'奖励 ID 无效或重复');
    ids.add(reward.id);
    text(reward.title,'奖励名称',30); text(reward.description,'奖励说明',140);
    if (![...SLOTS,'trick'].includes(reward.category)) fail(400,'奖励类别不正确');
    integer(reward.cost,'价格'); integer(reward.unlockAt,'成长门槛');
    if (reward.starter !== undefined && typeof reward.starter !== 'boolean') fail(400,'starter 必须为布尔值');
    if (reward.starter) {
      if (!SLOTS.includes(reward.category) || reward.cost || reward.unlockAt || starters.has(reward.category)) fail(400,'每个装扮类别必须且只能有一个免费初始奖励');
      starters.add(reward.category);
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
  if (starters.size !== SLOTS.length) fail(400,'缺少花色、外形、眼睛或姿态的初始奖励');
  return structuredClone(input);
}
export function composeParams(catalog, equipped) {
  const params = {...DEFAULT_PARAMS};
  for (const slot of SLOTS) {
    const reward = catalog.rewards.find(r => r.id === equipped[slot] && r.category === slot);
    if (reward) Object.assign(params,reward.params);
  }
  return params;
}
