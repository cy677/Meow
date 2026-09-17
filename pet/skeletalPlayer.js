import * as THREE from 'three';
import { createMesh2MotionSkinRig } from '../src/mesh2motionSkinRig.js';
import { CLIP_BY_ID, planMotion, timelineLayers } from './motionPrograms.mjs';

/** Reuses the upstream fixed 19-bone mesh. Playback NEVER rewrites the geometry. */
export function createSkeletalPlayer(cat) {
  const rig=createMesh2MotionSkinRig(cat,'standing');
  if(!rig||rig.weightStats.invalidWeights)throw new Error('小猫骨骼绑定失败');
  cat.userData.updateStaticIdle?.(0,false);
  const bones=rig.skeleton.bones;
  const base=cat.position.clone();
  const capture=()=>({rotations:bones.map(b=>b.quaternion.clone()),root:new THREE.Vector3(),rotation:new THREE.Quaternion()});
  const a=capture(),b=capture(),entry=capture(),finish=capture(),shown=capture(),mixed=capture();
  let plan=null,elapsed=0,idleTime=0,ending=null,disposed=false;
  let lastClip='idle',sourceFrame=0;
  const smooth=x=>{const t=THREE.MathUtils.clamp(x,0,1);return t*t*(3-2*t);};
  function copy(to,from){to.root.copy(from.root);to.rotation.copy(from.rotation);for(let i=0;i<bones.length;i++)to.rotations[i].copy(from.rotations[i]);return to;}
  function mix(to,from,other,w){mixed.root.copy(from.root).lerp(other.root,w);mixed.rotation.copy(from.rotation).slerp(other.rotation,w);for(let i=0;i<bones.length;i++)mixed.rotations[i].copy(from.rotations[i]).slerp(other.rotations[i],w);copy(to,mixed);}
  function sample(clip,progress,out,motion={}){
    // Upstream manual-preview sampler loops automatically. Clamp below its wrap point.
    const c=CLIP_BY_ID.get(clip);
    const state=rig.update(Math.min(1-1e-7,Math.max(0,progress))*c.duration,{actionId:clip,speed:1,intensity:motion.intensity??0.85});
    for(let i=0;i<bones.length;i++)out.rotations[i].copy(bones[i].quaternion);
    const lift=cat.userData.animationRootLift??0;
    out.root.set(state.rootX,lift*(clip==='jump'?(motion.height??0.5)/0.5:1),state.rootZ);
    out.rotation.setFromEuler(new THREE.Euler(state.rootPitch,state.rootYaw,state.rootRoll));
    lastClip=clip;sourceFrame=state.retarget?.sourceFrame??0;
    return out;
  }
  function apply(pose){
    for(let i=0;i<bones.length;i++)bones[i].quaternion.copy(pose.rotations[i]);
    cat.position.copy(base).add(pose.root);cat.quaternion.copy(pose.rotation);
    cat.updateMatrixWorld(true);rig.skeleton.update();
    copy(shown,pose);
  }
  sample('idle',0,a);apply(a);
  function stop(){if(plan&&!ending){copy(finish,shown);ending=0;}}
  function update(dt){
    if(disposed)return false;
    const delta=Math.min(0.1,Math.max(0,dt));idleTime+=delta;
    const idleProgress=(idleTime/CLIP_BY_ID.get('idle').duration)%1;
    if(!plan){sample('idle',idleProgress,a);apply(a);return false;}
    if(ending!==null){
      ending+=delta;sample('idle',idleProgress,b);mix(a,finish,b,smooth(ending/plan.transition));apply(a);
      if(ending>=plan.transition){plan=null;ending=null;}
      return !!plan;
    }
    elapsed+=delta;
    const layers=timelineLayers(plan,elapsed);
    sample(layers[0].clip,layers[0].progress,a,plan.motion);
    if(layers.length>1){sample(layers[1].clip,layers[1].progress,b,plan.motion);mix(a,a,b,layers[1].weight);}
    // Walk around a small closed circle. The legs are animated; this is not a rigid spin.
    if(plan.action==='spin'){
      const angle=smooth(elapsed/plan.duration)*Math.PI*2*plan.motion.turns;
      const heading=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),angle);
      a.root.applyQuaternion(heading).add(new THREE.Vector3(.32*(1-Math.cos(angle)),0,.32*Math.sin(angle)));
      a.rotation.premultiply(heading);
    }
    if(elapsed<plan.transition)mix(a,entry,a,smooth(elapsed/plan.transition));
    apply(a);
    if(elapsed>=plan.duration)stop();
    return true;
  }
  return {
    rig,
    play(action,motion={},script){const next=planMotion(action,motion,script);copy(entry,shown);plan=next;elapsed=0;ending=null;return next.duration+next.transition;},
    stop,update,
    cancel(){plan=null;ending=null;sample('idle',0,a);apply(a);},
    get active(){return !!plan;},
    getDiagnostics(){
      const position=rig.fur.geometry.getAttribute('position');
      const deformed=[];
      for(let i=0;i<position.count;i+=Math.max(1,Math.floor(position.count/32))){const p=new THREE.Vector3().fromBufferAttribute(position,i);rig.fur.applyBoneTransform(i,p);deformed.push(...p.toArray());}
      return {type:rig.type,action:plan?.action??'idle',clip:lastClip,sourceFrame,bones:bones.length,weights:rig.weightStats,
        geometryId:rig.fur.geometry.uuid,vertices:position.count,positionVersion:position.version,
        active:!!plan,elapsed,boneQuaternions:bones.map(x=>x.quaternion.toArray()),deformed,
        boneLengthError:rig.getState()?.boneLengthError??0};
    },
    dispose(){disposed=true;plan=null;rig.skeleton.dispose();},
  };
}
