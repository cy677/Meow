/** Strict capability schema shared by the service and tests. No arbitrary JS/URLs. */
export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new AppError(status, message); };
export const SLOTS = ['coat', 'shape', 'eyes', 'pose'];
export const ACTIONS = ['jump', 'spin'];
const COATS = ['orange','greyTabby','brownTabby','cream','tuxedo','calico','tortoiseshell','siamese','black','white','blueGrey'];
const POSES = ['standing','loaf','stretch','biped','slouchSit','sideFlat','banana'];
const SHAPE = { headSize:[0.78,1.42], chubbiness:[0.72,1.95], legLength:[0.48,1.65], earSize:[0.62,1.48], tailLength:[0.58,1.72], tailCurl:[-0.12,1.18], furFluff:[0.15,1.5] };
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
export function validateCatalog(input) {
  object(input,['schemaVersion','rewards']);
  if (input.schemaVersion !== 1 || !Array.isArray(input.rewards) || input.rewards.length > 200) fail(400,'奖励配置版本或数量不正确');
  const ids = new Set(); const starters = new Set();
  for (const reward of input.rewards) {
    object(reward,['id','title','description','category','cost','unlockAt','starter','params','action']);
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
      continue;
    }
    if (reward.action !== undefined) fail(400,'装扮奖励不能包含互动动作');
    const keys = reward.category === 'coat' ? ['coatId'] : reward.category === 'pose' ? ['pose'] : reward.category === 'eyes' ? ['eyeColor','eyeColorRight','oddEyes'] : [...Object.keys(SHAPE),'fluffy'];
    object(reward.params,keys);
    if (!Object.keys(reward.params).length) fail(400,'奖励参数不能为空');
    for (const [key,value] of Object.entries(reward.params)) {
      if (key === 'coatId') { if (!COATS.includes(value)) fail(400,'未知花色'); }
      else if (key === 'pose') { if (!POSES.includes(value)) fail(400,'未知姿态'); }
      else if (key === 'fluffy' || key === 'oddEyes') { if (typeof value !== 'boolean') fail(400,'开关参数必须为布尔值'); }
      else if (key.startsWith('eyeColor')) { if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail(400,'眼睛颜色应为六位十六进制颜色'); }
      else if (!Number.isFinite(value) || value < SHAPE[key][0] || value > SHAPE[key][1]) fail(400,`参数 ${key} 超出安全范围`);
    }
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
