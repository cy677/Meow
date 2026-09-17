/** Declarative, bounded animation programs. No URLs, eval, or executable user scripts. */
export const CLIPS = Object.freeze([
  {id:'idle',name:'自然待机',duration:40/24,loop:true},
  {id:'idle-alert',name:'抬头警觉',duration:2,loop:true},
  {id:'walk',name:'轻快走路',duration:1,loop:true},
  {id:'run',name:'小步奔跑',duration:14/24,loop:true},
  {id:'sneak',name:'悄悄潜行',duration:39/24,loop:true},
  {id:'jump',name:'蓄力跳跃',duration:65/30,loop:false},
  {id:'fall',name:'落地缓冲',duration:0.5,loop:false},
  {id:'sit',name:'慢慢坐下',duration:40/24,loop:false},
  {id:'rest-pose',name:'休息姿势',duration:0.3,loop:true},
  {id:'bark',name:'抬头叫唤',duration:2.8,loop:true},
  {id:'bite',name:'探头咬咬',duration:25/30,loop:true},
  {id:'fetch',name:'向前扑接',duration:29/24,loop:true},
  {id:'howl',name:'仰头长叫',duration:69/24,loop:true},
  {id:'death',name:'侧身倒地（表演）',duration:34/24,loop:false},
]);
export const CLIP_BY_ID = new Map(CLIPS.map(c=>[c.id,c]));
const step=(clip,cycles=1,speed=1)=>({clip,cycles,speed});
export const PROGRAMS = Object.freeze({
  greet:{name:'见面打招呼',steps:[step('idle-alert'),step('bark'),step('sit')]},
  explore:{name:'好奇探险',steps:[step('idle-alert'),step('sneak',2),step('walk',2),step('sit')]},
  pounce:{name:'发现与扑接',steps:[step('idle-alert'),step('sneak'),step('fetch'),step('sit')]},
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
  const transition=motion.transition??0.25,speed=motion.speed??1;
  if(!Number.isFinite(speed)||speed<0.5||speed>2||!Number.isFinite(transition)||transition<0.1||transition>0.6)throw new Error('动作速度或过渡时长超出范围');
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
      const previous=segments.at(-1),overlap=previous?Math.min(transition,previous.duration*0.3,duration*0.3):0;
      const start=end-overlap;end=start+duration;
      segments.push({clip:s.clip,start,end,duration,overlap});
    }
  }
  if(end>90)throw new Error('动作脚本播放时间不能超过 90 秒');
  return {action,segments,duration:end,transition,motion:{intensity:0.85,height:0.5,turns:1,...motion}};
}
export function timelineLayers(plan,time) {
  const t=Math.min(plan.duration,Math.max(0,time));
  const active=plan.segments.filter(s=>t>=s.start-1e-9&&t<=s.end+1e-9).slice(-2);
  return active.map((s,i)=>{
    let weight=1;
    if(active.length===2){const b=active[1],x=Math.max(0,Math.min(1,(t-b.start)/b.overlap));const smooth=x*x*(3-2*x);weight=i===0?1-smooth:smooth;}
    return {clip:s.clip,progress:Math.min(1,Math.max(0,(t-s.start)/s.duration)),weight};
  });
}

// An explicit parent action adds these to existing families; never overwrite their presets.
export const MOTION_REWARDS = [
  ['walk','轻快走路',15,20],['run','小步奔跑',25,40],['sneak','悄悄潜行',20,30],['sit','慢慢坐下',15,20],
  ['idle-alert','抬头警觉',10,10],['fetch','向前扑接',30,50],['bark','抬头叫唤',15,25],['howl','仰头长叫',25,45],
  ['greet','见面打招呼',30,50],['explore','好奇探险',40,80],['pounce','发现与扑接',40,80],
].map(([action,title,cost,unlockAt])=>({id:`motion-${action}`,title,description:PROGRAMS[action]?'连续骨骼动作，片段之间平滑衔接。':'原作骨骼动画，四肢、身体与头尾协调运动。',category:'trick',cost,unlockAt,action,motion:{intensity:0.85,transition:0.25,speed:1,...(PROGRAMS[action]?{}:{duration:defaultDuration(action)})}}));
