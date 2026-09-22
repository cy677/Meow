import { COATS, POSES, EYE_COLORS } from '../src/coats.js';
import { MOTION_REWARDS, defaultDuration } from './motionPrograms.mjs';
import { SOURCE_CLIPS as CLIPS } from '../src/catMotion/clipCatalog.js';
export const BASIC_ACTIONS = ['idle','idle-alert','walk','run','sneak'];


const slug = value => value.replace(/[A-Z]/g, c => '-'+c.toLowerCase());
const item = (id,title,category,params,cost=25,unlockAt=40) => ({id,title,category,params,cost,unlockAt,description:`原版${title}，解锁后永久使用。`});
// Stable additions only. Existing family presets (including their prices) are retained.
export function missingUpstreamRewards(catalog) {
  const rewards = [...catalog.rewards], additions=[];
  const add = (reward, exists) => { if(!rewards.some(exists)){ rewards.push(reward); additions.push(reward); } };
  for(const [i,c] of COATS.entries())add(item(`original-coat-${slug(c.id)}`,c.name,'coat',{coatId:c.id},25+i*3,40+i*10),r=>r.category==='coat'&&r.params.coatId===c.id);
  for(const [i,p] of POSES.filter(p=>p.id!=='containerCrouch').entries())add(item(`original-pose-${slug(p.id)}`,p.name,'pose',{pose:p.id},20+i*5,30+i*15),r=>r.category==='pose'&&r.params.pose===p.id);
  for(const [i,e] of EYE_COLORS.filter(e=>e.color!=='odd').entries())add(item(`original-eyes-${e.id}`,`${e.name}眼睛`,'eyes',{eyeColor:e.color,oddEyes:false},20+i*3,30+i*10),r=>r.category==='eyes'&&r.params.eyeColor===e.color&&!r.params.oddEyes);
  for(const c of CLIPS) add({id:`original-motion-${c.id}`,title:c.name,category:'trick',description:'原版关键帧骨骼动作，可在小屋表演，也可在原版互动中播放。',cost:c.id==='idle'?0:25,unlockAt:c.id==='idle'?0:40,action:c.id,motion:{duration:defaultDuration(c.id),speed:1,intensity:1,transition:.25}},r=>r.category==='trick'&&r.action===c.id);
  for(const reward of MOTION_REWARDS)add(reward,r=>r.category==='trick'&&r.action===reward.action);
  for(const [id,title,cost,at] of [['keyboard','键盘自由行动',0,0],['capture','拍照与分享卡',0,0],['export','GLB 与 Codex 导出',0,0],['music','原版背景音乐',0,0]]) {
    const reward=item(`original-${id}`,title,'capability',{capability:id},cost,at);
    if(id==='complete')reward.description='一次获得当前目录全部奖励，并开放原版全部造型、动作、场景、随机创作、渲染参数及导出。';
    if(id==='keyboard')reward.description='原版键盘和触摸方向键，可自由移动、奔跑、跳跃以及使用状态机里的全部动作。';
    add(reward,r=>r.id===reward.id);
  }

  return additions;
}
export function upstreamAccess(catalog, owned) {
  const rewards=catalog.rewards.filter(r=>isFreeOriginal(r)||owned.includes(r.id));

  return {full:true, capabilities:['capture','music','weather','lighting','speech'],
    editors:[],
    coats:rewards.filter(r=>r.category==='coat').map(r=>r.params.coatId),poses:rewards.filter(r=>r.category==='pose').map(r=>r.params.pose),
    poseOptions:rewards.filter(r=>r.category==='pose').map(r=>({id:r.id,title:r.title,params:r.params})),
    actions:rewards.filter(r=>r.category==='trick').map(r=>({id:r.id,title:r.title,action:r.action,motion:r.motion}))};
}

// Interactions and scene tools are free; appearance/render settings remain point rewards.
export function isFreeOriginal(reward) {
  return (reward.category==='capability'&&['keyboard','capture','export','music'].includes(reward.params.capability))
    || ['weather','lighting'].includes(reward.category)
    || (reward.category==='trick' && BASIC_ACTIONS.includes(reward.action));
}
// Version 2 made every source clip free. Restore only those generated defaults;
// custom prices and all existing ownership/ledger entries remain intact.
export function restoreSpecialPrices(catalog) {
  return {...catalog,rewards:catalog.rewards.map(r=>{
    const builtIn = CLIPS.find(clip => r.id === `original-motion-${clip.id}` && r.action === clip.id && r.title === clip.name);
    if(!builtIn||r.category!=='trick'||BASIC_ACTIONS.includes(r.action)||r.cost!==0||r.unlockAt!==0||!r.description.endsWith('，默认开放，可直接使用。'))return r;
    return {...r,cost:r.action==='jump'?15:25,unlockAt:r.action==='jump'?20:40,description:`${r.title}，解锁后加入小猫的随机动作脚本。`};
  })};
}
export function unlockOriginals(catalog) {
  return {...catalog,rewards:catalog.rewards.map(r=>isFreeOriginal(r)?{...r,cost:0,unlockAt:0,description:`${r.title}，默认开放，可直接使用。`}:r)};
}
