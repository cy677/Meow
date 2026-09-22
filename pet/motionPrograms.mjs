// Compatibility entry point; animation definitions live in src/catMotion only.
export * from '../src/catMotion/motionScript.js';
import { PROGRAMS, defaultDuration, CLIP_BY_ID } from '../src/catMotion/motionScript.js';

// An explicit parent action adds these to existing families; never overwrite their presets.
export const MOTION_REWARDS = [
  ['walk','轻快走路',15,20],['run','小步奔跑',25,40],['sneak','悄悄潜行',20,30],['sit','慢慢坐下',15,20],
  ['idle-alert','抬头警觉',10,10],['fetch','向前扑接',30,50],['bark','抬头叫唤',15,25],['howl','仰头长叫',25,45],
  ['scratch','交替抓挠',25,35],['paw','前爪轻拍',20,25],['climb-up','向上攀爬（练习）',30,40],
  ['climb-down','向下攀爬（练习）',30,40],['mantle','扒边翻上（练习）',35,50],['stretch','舒展身体',15,20],
  ['greet','见面打招呼',30,50],['explore','好奇探险',40,80],['pounce','发现与扑接',40,80],
].map(([action,title,cost,unlockAt])=>({id:`motion-${action}`,title,description:PROGRAMS[action]?'连续骨骼动作，片段之间平滑衔接。':CLIP_BY_ID.get(action)?.source==='meow-authored'?'Meow新增四足骨骼动作；当前仅为动作练习，未接入物体、接触或IK。':'原作骨骼动画，四肢、身体与头尾协调运动。',category:'trick',cost,unlockAt,action,motion:{intensity:0.85,transition:0.25,speed:1,...(PROGRAMS[action]?{}:{duration:defaultDuration(action)})}}));
