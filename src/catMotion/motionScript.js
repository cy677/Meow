import { CLIPS, CLIP_BY_ID } from './clipCatalog.js';
import { smooth01 } from './expression.js';
export { CLIPS, CLIP_BY_ID } from './clipCatalog.js';
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const step=(clip,cycles=1,speed=1)=>({clip,cycles,speed});
export const PROGRAMS = freeze({
  greet:{name:'见面打招呼',steps:[step('idle-alert'),step('bark'),step('sit')]},
  explore:{name:'好奇探险',steps:[step('idle-alert'),step('sneak',2),step('walk',2),step('sit')]},
  pounce:{name:'发现与扑接',steps:[step('idle-alert'),step('sneak'),step('fetch'),step('sit')]},
  'paw-practice':{name:'挥爪练习',steps:[step('idle-alert'),step('paw'),step('idle')]},
  'climb-practice':{name:'攀爬片段练习（无物体）',steps:[step('climb-up',2),step('mantle'),step('climb-down',2)]},
  celebrate:{name:'欢乐庆祝',steps:[step('wave'),step('jump',1,1.1),step('bow')]},
});
export const ACTION_CHOICES = [...CLIPS.map(c=>[c.id,c.name]),['spin','迈步转圈'],...Object.entries(PROGRAMS).map(([id,p])=>[id,p.name]),['sequence','自定义动作脚本']];
export const ACTION_IDS = ACTION_CHOICES.map(c=>c[0]);
export const defaultDuration = id => ({jump:2.6,spin:4,walk:4,run:3,sneak:4,sit:2.2,fall:1.2}[id] ?? Math.max(1,CLIP_BY_ID.get(id)?.duration ?? 3));
const plain = x => x && typeof x==='object' && !Array.isArray(x) && Object.getPrototypeOf(x)===Object.prototype;
export function validateScript(script) {
  if(!Array.isArray(script)||script.length<1||script.length>8)throw new Error('动作脚本需要 1–8 个步骤');
  let duration=0;
  for(const s of script){
    if(!plain(s)||Object.keys(s).some(k=>!['clip','cycles','speed'].includes(k)))throw new Error('动作步骤只接受片段、次数与速度');
    const c=CLIP_BY_ID.get(s.clip);if(!c)throw new Error('未知骨骼动画片段');
    const cycles=s.cycles??1,speed=s.speed??1;
    if(!Number.isInteger(cycles)||cycles<1||cycles>4)throw new Error('片段次数应为 1–4');
    if(!c.loop&&cycles!==1)throw new Error('坐下、跳跃等一次性片段每步骤仅播放一次');
    if(typeof speed!=='number'||!Number.isFinite(speed)||speed<0.5||speed>2)throw new Error('片段速度应为 0.5–2');
    duration+=c.duration*cycles/speed;
  }
  if(duration>45)throw new Error('动作脚本原始总时长不能超过 45 秒');
  return script.map(s=>({clip:s.clip,cycles:s.cycles??1,speed:s.speed??1}));
}

/** Consecutive source clips overlap; quaternion interpolation is done by the rig adapter. */
export function planMotion(action,motion={},script) {
  if(!ACTION_IDS.includes(action))throw new Error('未知互动动作');
  if(!plain(motion))throw new Error('动作参数必须为普通对象');
  if(Object.keys(motion).some(k=>!['duration','height','turns','speed','intensity','transition','script'].includes(k)))throw new Error('未知动作参数');
  const transition=motion.transition??0.25,speed=motion.speed??1;
  if(!Number.isFinite(speed)||speed<0.5||speed>2||!Number.isFinite(transition)||transition<0.1||transition>0.6)throw new Error('动作速度或过渡时长超出范围');
  for(const [key,min,max] of [['intensity',0,1.6],['height',.05,.8],['turns',1,3]]) {
    if(motion[key]!==undefined && (typeof motion[key]!=='number'||!Number.isFinite(motion[key])||motion[key]<min||motion[key]>max))throw new Error(`动作参数 ${key} 超出范围`);
  }
  if(motion.turns!==undefined&&!Number.isInteger(motion.turns))throw new Error('圈数必须为整数');
  if(action!=='sequence'&&motion.script!==undefined)throw new Error('只有 sequence 接受步骤');
  let items;
  if(action==='sequence') items=validateScript(script);
  else if(PROGRAMS[action]) items=PROGRAMS[action].steps;
  else {
    const clip=action==='spin'?'walk':action,c=CLIP_BY_ID.get(clip),total=motion.duration??defaultDuration(action);
    if(!Number.isFinite(total)||total<0.6||total>12)throw new Error('动作时长应为 0.6–12 秒');
    const cycles=c.loop?Math.max(1,Math.min(12,Math.round(total/c.duration))):1;
    // Preserve complete source clips; no chopping Jump into an endless partial hop.
    items=[{clip,cycles,speed:c.duration*cycles/total}];
  }
  const segments=[];
  let end=0;
  for(const s of items){
    const c=CLIP_BY_ID.get(s.clip),duration=c.duration/(s.speed*speed);
    for(let i=0;i<s.cycles;i++){
      const previous=segments.at(-1),overlap=previous&&previous.clip!==s.clip?Math.min(transition,previous.duration*0.3,duration*0.3):0;
      const start=end-overlap;end=start+duration;
      segments.push({clip:s.clip,start,end,duration,overlap});
    }
  }
  if(end>90)throw new Error('动作脚本播放时间不能超过 90 秒');
  return freeze({action,segments,duration:end,transition,motionInput:structuredClone(motion),script:action==='sequence'?validateScript(script):undefined,motion:{intensity:0.85,height:0.5,turns:1,...structuredClone(motion)}});
}
export function timelineLayers(plan,time) {
  const t=Math.min(plan.duration,Math.max(0,time));
  let active=plan.segments.filter(s=>t>=s.start-1e-9&&t<=s.end+1e-9).slice(-2);
  // Adjacent cycles of the same clip meet without overlap. At the exact seam
  // choose the next cycle rather than dividing by a zero crossfade duration.
  if(active.length===2&&active[1].overlap<=1e-9)active=active.slice(-1);
  return active.map((s,i)=>{
    let weight=1;
    if(active.length===2){const b=active[1],smooth=smooth01((t-b.start)/b.overlap);weight=i===0?1-smooth:smooth;}
    return {clip:s.clip,progress:Math.min(1,Math.max(0,(t-s.start)/s.duration)),weight};
  });
}

/** Whether a script is appropriate for idle ground activity before target/IK support. */
export function canAutoPlay(action,motion={}, {allowPractice=false}={}) {
  try{return planMotion(action,motion,motion.script).segments.every(s=>allowPractice||!CLIP_BY_ID.get(s.clip).requiresTarget);}catch{return false;}
}
