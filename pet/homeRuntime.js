import { planMotion, canAutoPlay } from './motionPrograms.mjs';
import { PARAM_FIELDS } from './presetSchema.mjs';
import { rugSeedForStyle } from './environment/upstreamAdapters.js';
import { containerSeed } from './environment/containerAdapter.js';
import { RUG_CHOICES } from './environmentSchema.mjs';

export function mountHomeRuntime(runtime,data,defaults){
  let state=data.state,disposed=false,paused=false,pointerHeld=false,raf=0,nextAt=performance.now()+2500,activePlan=null,lastAction='';
  const initial=defaults||runtime.capture();
  let homeView=runtime.capture().camera;
  let poseUntil=0,lastRandomId='';
  const stop=()=>{if(disposed)return;activePlan=null;runtime.clearKeys();runtime.stop(true);nextAt=performance.now()+5000+Math.random()*4000;};
  function applyState(next,first=false){
    if(disposed)return;
    // The parent page calls this bridge directly across an iframe realm.
    // Normalize inputs here so motion validation sees local plain objects.
    next=structuredClone(next);
    if(JSON.stringify(next.randomScript)!==JSON.stringify(state.randomScript)){
      stop();poseUntil=0;
      const removedPose=state.randomScript?.find(r=>r.id===lastRandomId&&r.category==='pose');
      if(removedPose&&!next.randomScript?.some(r=>r.id===lastRandomId))runtime.restore({params:Object.fromEntries(PARAM_FIELDS.pose.map(f=>[f.key,next.params[f.key]??initial.params[f.key]]).filter(([,v])=>v!==undefined))});
    }
    runtime.applyModels(next.models||[]);
    if(next.creation){
      if(first||JSON.stringify(next.creation)!==JSON.stringify(state.creation)){
        stop();runtime.resetRoom();runtime.restore(initial);runtime.restore(next.creation.preset);
        homeView=runtime.capture().camera;
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
    if(first||roomSlots.includes('camera'))homeView=runtime.capture().camera;
    state=next;runtime.setAccess(next.access);
  }
  applyState(state,true);
  function play(action,motion={}){
    if(disposed||paused||document.hidden)return;
    motion=structuredClone(motion);
    if(!state.access.actions.some(a=>a.action===action&&JSON.stringify(a.motion||{})===JSON.stringify(motion)))return;
    activePlan=planMotion(action,motion,motion.script);
    lastAction=action;runtime.clearKeys();runtime.playProgram(activePlan);
  }
  // One render clock drives the program. A background tab never catches up by
  // firing a queue of expired segment timers. Rest restores the selected pose.
  let previousTick=performance.now();
  function tick(now){
    if(disposed)return;
    const delta=Math.max(0,Math.min(.1,(now-previousTick)/1000));previousTick=now;
    runtime.update(delta);
    const blocked=paused||pointerHeld||document.hidden||document.querySelector('#viewport[data-share-card-open="true"]');
    if(blocked){if(activePlan)stop();nextAt=now+2500;}
    else if(poseUntil>now){ /* Hold a chosen static pose before the next script item. */ }
    else if(activePlan||runtime.motionState().active){if(!runtime.motionState().active)stop();}
    else if(now>=nextAt){
      const available=(state.randomScript??state.access.actions).filter(a=>a.category==='pose'||canAutoPlay(a.action,a.motion||{}));
      const pool=available.filter(a=>(a.id||a.action)!==lastRandomId);
      const choices=pool.length?pool:available;
      const chosen=choices[Math.floor(Math.random()*choices.length)];
      if(chosen){
        lastRandomId=chosen.id||chosen.action;
        if(chosen.category==='pose'){stop();runtime.restore({params:chosen.params});poseUntil=now+4500;nextAt=poseUntil;}
        else {poseUntil=0;play(chosen.action,chosen.motion||{});}
      }else nextAt=now+5000;
    }
    if(!disposed)raf=requestAnimationFrame(tick);
  }
  // Keep the upstream tools directly on the stage; export tools belong to parents.
  const photo=document.getElementById('btn-export-png');
  photo.classList.add('child-photo');photo.textContent='📷 拍照 · 留影';
  const photoActions=document.createElement('div');photoActions.className='child-photo-actions';
  const together=document.getElementById('btn-photo-together');together.classList.add('child-photo');
  photoActions.append(photo,together);document.getElementById('viewport').append(photoActions);
  const resetView=document.createElement('button');resetView.type='button';resetView.id='child-reset-view';resetView.className='child-reset-view';resetView.textContent='还原视角';
  const resetCamera=()=>{if(!disposed)runtime.resetView(homeView);};
  resetView.addEventListener('click',resetCamera);
  photoActions.append(resetView);
  for(const id of ['btn-export-glb','btn-codex-pet'])document.getElementById(id)?.remove();
  photo.addEventListener('click',stop,true);
  together.addEventListener('click',stop,true);
  const canvas=document.getElementById('scene');canvas.tabIndex=0;
  const pointers=new Set();
  const down=e=>{pointers.add(e.pointerId);pointerHeld=true;if(activePlan)stop();};
  const up=e=>{if(e.type==='blur')pointers.clear();else pointers.delete(e.pointerId);pointerHeld=pointers.size>0;nextAt=performance.now()+4000;};
  // Restore the selected pose before upstream picking captures mesh references.
  canvas.addEventListener('pointerdown',down,true);
  window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);window.addEventListener('blur',up);
  const keydown=e=>{
    if(e.target?.closest?.('input,select,textarea,button'))return;
    if(/^(Key[WASDQEFHGKCZX]|Arrow(Up|Down|Left|Right)|Space|ShiftLeft|ControlLeft)$/.test(e.code)){e.preventDefault();e.stopImmediatePropagation();}
  };
  window.addEventListener('keydown',keydown,true);
  raf=requestAnimationFrame(tick);
  return {applyState,play,models:()=>runtime.modelDiagnostics(),overlay(open){if(disposed)return;paused=open;if(open)stop();else nextAt=performance.now()+2500;},feature(name){
    if(disposed)return;
    if(name==='capture'){stop();runtime.camera.start();}
    if(name==='music')document.getElementById('bgm-toggle').click();
    if(name==='speech')window.dispatchEvent(new CustomEvent('meow:speech',{detail:{role:'cat'}}));
    if(name==='reset'){stop();runtime.resetRoom();runtime.restore(initial);runtime.restore({params:state.params});applyState(state,true);}
  },dispose(){
    if(disposed)return;
    disposed=true;activePlan=null;cancelAnimationFrame(raf);
    window.removeEventListener('keydown',keydown,true);canvas.removeEventListener('pointerdown',down,true);
    window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);window.removeEventListener('blur',up);
    photo.removeEventListener('click',stop,true);together.removeEventListener('click',stop,true);
    resetView.removeEventListener('click',resetCamera);pointers.clear();photoActions.remove();
    // Cleanup can be requested both by the parent iframe and by pagehide.
    // Stop while the underlying controller is live, and never touch it a second time.
    runtime.clearKeys();runtime.stop(true);runtime.disposeModels();
  }};
}
