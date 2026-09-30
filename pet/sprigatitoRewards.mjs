import { SPRIGATITO_CLIPS, CLIP_BY_ID } from '../src/catMotion/clipCatalog.js';
import { planMotion } from '../src/catMotion/motionScript.js';

export const SPRIGATITO_REWARDS = SPRIGATITO_CLIPS.map(clip=>({
  id:`motion-${clip.id}`,title:clip.name,category:'trick',cost:0,unlockAt:100,
  description:'累计 100 成长分自动获得，不扣积分。切换新叶喵后可加入随机动作脚本。',
  action:clip.id,motion:{duration:clip.duration,speed:1,intensity:.85,transition:.25},
}));

export function appearanceAllowsReward(reward,appearance='native') {
  if(reward.category==='pose'&&appearance==='sprigatito')return ['standing','stretch'].includes(reward.params.pose);
  if(reward.category!=='trick')return true;
  return planMotion(reward.action,reward.motion||{},reward.motion?.script).segments.every(segment=>{
    const required=CLIP_BY_ID.get(segment.clip)?.appearance;
    return !required||required===appearance;
  });
}
