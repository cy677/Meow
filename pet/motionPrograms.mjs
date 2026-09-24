// Compatibility entry point; animation definitions live in src/catMotion only.
export * from '../src/catMotion/motionScript.js';
import { PROGRAMS, defaultDuration, CLIP_BY_ID } from '../src/catMotion/motionScript.js';
import { BASIC_ACTIONS } from '../src/catMotion/clipCatalog.js';

const descriptions={
  wave:'抬起前爪挥两下，轻轻摆尾，向你问好。',
  bow:'低头俯身，停一小会儿，再轻轻抬头致意。',
  'head-tilt':'左边看看、右边瞧瞧，歪着脑袋陪你玩。',
  celebrate:'挥爪问好、开心一跳，再鞠个躬完成小小庆祝。',
};

// An explicit parent action adds these to existing families; never overwrite their presets.
export const MOTION_REWARDS = [
  ['walk','轻快走路',15,20],['run','小步奔跑',25,40],['sneak','悄悄潜行',20,30],['sit','慢慢坐下',15,20],
  ['idle-alert','抬头警觉',10,10],['fetch','向前扑接',30,50],['bark','抬头叫唤',15,25],['howl','仰头长叫',25,45],
  ['scratch','交替抓挠',25,35],['paw','前爪轻拍',20,25],['climb-up','向上攀爬（练习）',30,40],
  ['climb-down','向下攀爬（练习）',30,40],['mantle','扒边翻上（练习）',35,50],['stretch','舒展身体',15,20],
  ['greet','见面打招呼',30,50],['explore','好奇探险',40,80],['pounce','发现与扑接',40,80],
  ['wave','招爪问好',15,20],['bow','礼貌鞠躬',20,35],['head-tilt','歪头卖萌',25,50],['celebrate','欢乐庆祝',40,80],
].map(([action,title,cost,unlockAt])=>({id:`motion-${action}`,title,description:descriptions[action]||(BASIC_ACTIONS.includes(action)?`${title}，默认开放，可直接使用。`:'连续骨骼动作，片段之间平滑衔接。'),category:'trick',cost:BASIC_ACTIONS.includes(action)?0:cost,unlockAt:BASIC_ACTIONS.includes(action)?0:unlockAt,action,motion:{intensity:0.85,transition:0.35,speed:1,...(PROGRAMS[action]?{}:{duration:defaultDuration(action)})}}));
