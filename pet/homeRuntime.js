import { CLIPS, planMotion } from './motionPrograms.mjs';
import { PARAM_FIELDS } from './presetSchema.mjs';
import { rugSeedForStyle } from './environment/upstreamAdapters.js';
import { containerSeed } from './environment/containerAdapter.js';
import { RUG_CHOICES } from './environmentSchema.mjs';

export function mountHomeRuntime(runtime,data,defaults){
  let state=data.state,timers=[],disposed=false;
  const initial=defaults||runtime.capture();
  const stop=()=>{timers.forEach(clearTimeout);timers=[];runtime.clearKeys();runtime.stop();};
  function applyState(next,first=false){
    if(disposed)return;
    if(next.creation){
      if(first||JSON.stringify(next.creation)!==JSON.stringify(state.creation)){
        stop();runtime.resetRoom();runtime.restore(initial);runtime.restore(next.creation.preset);
      }
      state=next;runtime.setAccess(next.access);return;
    }
    if(state.creation){stop();runtime.resetRoom();runtime.restore(initial);runtime.restore({params:next.params});first=true;}
    const patch={},params={};
    for(const slot of ['coat','shape','eyes','pose']){
      const fields=PARAM_FIELDS[slot];
      if(!first&&(next.equipped[slot]!==state.equipped[slot]||fields.some(f=>next.params[f.key]!==state.params[f.key])))for(const f of fields){const value=next.params[f.key]??initial.params[f.key];if(value!==undefined)params[f.key]=value;}
    }
    if(Object.keys(params).length){stop();patch.params=params;}
    const s=next.sceneParams;
    const changed=slot=>first?next.rewards.some(r=>r.id===next.equipped[slot]&&!r.starter):JSON.stringify(s[slot])!==JSON.stringify(state.sceneParams[slot]);
    if(changed('floor'))patch.floor=Object.fromEntries(Object.entries(s.floor).filter(([k])=>k!=='kind'));
    if(changed('rug'))patch.rug={enabled:s.rug.style!=='none',seed:s.rug.style==='none'?7:rugSeedForStyle(s.rug.seed,RUG_CHOICES.findIndex(([id])=>id===s.rug.style))};
    if(changed('weather')){const w=s.weather;patch.weather={mode:['rain','thunder','fishRain'].includes(w.mode)?'fishRain':w.mode,thunder:w.mode==='thunder'&&w.lightning,rain:w.rainAmount,cloud:w.cloudAmount,fish:w.mode==='fishRain'?w.fishAmount:0};}
    if(changed('bed')){
      stop();
      if(!['none','cushion'].includes(s.bed.kind)&&s.bed.placement==='inside')patch.params={...(patch.params||{}),pose:'containerCrouch',containerSeed:containerSeed(s.bed.kind,s.bed.seed),containerSize:Math.min(1.5,s.bed.size)};
      else if(state.sceneParams.bed.placement==='inside')patch.params={...(patch.params||{}),pose:next.params.pose};
    }
    if(Object.keys(patch).length)runtime.restore(patch);
    const roomSlots=['lighting','camera','effect','rug','toy','bed'].filter(changed);
    if(roomSlots.length)runtime.applyRoom(s,roomSlots);
    state=next;runtime.setAccess(next.access);
  }
  applyState(state,true);
  function play(action,motion={}){
    if(disposed)return;stop();const plan=planMotion(action,motion,motion.script);
    for(const segment of plan.segments)timers.push(setTimeout(()=>window.__setAnimation({enabled:true,stateMachine:false,action:segment.clip,speed:CLIPS.find(c=>c.id===segment.clip).duration/segment.duration,intensity:motion.intensity??1}),segment.start*1000));
    timers.push(setTimeout(()=>runtime.stop(),plan.duration*1000));
  }
  const canvas=document.getElementById('scene');canvas.tabIndex=0;
  const focus=()=>canvas.focus({preventScroll:true});
  const keydown=e=>{
    if(disposed||document.querySelector('#viewport[data-share-card-open="true"]')||document.body.classList.contains('codex-pet-modal-open')||e.target.closest('input,select,textarea,button'))return;
    if(/^(Key[WASDQEFHGKCZX]|Arrow(Up|Down|Left|Right)|Space|ShiftLeft|ControlLeft)$/.test(e.code)){
      timers.forEach(clearTimeout);timers=[];const a=window.__getAnimation();
      if(!a.enabled||!a.stateMachine)window.__setAnimation({enabled:true,stateMachine:true,action:'idle'});
    }
  };
  window.addEventListener('keydown',keydown,true);
  const pad=document.querySelector('.studio-pad');
  const select=document.createElement('select');select.setAttribute('aria-label','原版互动动作');select.append(new Option('选择动作',''));
  for(const clip of CLIPS)select.append(new Option(clip.name,clip.id));
  select.addEventListener('change',()=>{if(select.value)play(select.value);});pad.prepend(select);
  pad.addEventListener('pointerdown',e=>{if(e.target.closest('button')){timers.forEach(clearTimeout);timers=[];}},true);
  focus();
  return {applyState,play,overlay(open){if(open)stop();},feature(name){
    if(disposed)return;
    const id={capture:'btn-export-png',glb:'btn-export-glb',codex:'btn-codex-pet',music:'bgm-toggle'}[name];
    if(id){stop();document.getElementById(id).click();}
    if(['lighting','weather'].includes(name)){document.body.classList.toggle(`studio-${name}-open`);document.getElementById(name==='lighting'?'light-orb':'weather-control').scrollIntoView({block:'nearest'});}
    if(name==='speech')window.dispatchEvent(new CustomEvent('meow:speech',{detail:{role:'cat'}}));
    if(name==='reset'){stop();runtime.resetRoom();runtime.restore(initial);runtime.restore({params:state.params});applyState(state,true);}
    if(!['capture','codex','parameters'].includes(name))focus();
  },dispose(){disposed=true;stop();window.removeEventListener('keydown',keydown,true);}};
}
