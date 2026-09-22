import * as THREE from 'three';
import { requireClip } from './clipCatalog.js';
import { timelineLayers } from './motionScript.js';
import { assertSkeleton } from './skeleton.js';

const smooth = x => {const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
/** Shared pose evaluator. The parent preview applies the root here; the original
 * stage consumes the same root output in its existing world-transform pipeline.
 * World locomotion, physics, IK and scene objects are intentionally not owned here.
 */
export function createClipPlayer(rig,cat,{applyRoot=true}={}) {
  assertSkeleton(rig.skeleton);
  const bones=rig.skeleton.bones,base=cat.position.clone(),baseRotation=cat.quaternion.clone();
  const make=()=>({rotations:bones.map(b=>b.quaternion.clone()),root:new THREE.Vector3(),rotation:new THREE.Quaternion(),state:{}});
  const a=make(),b=make(),entry=make(),shown=make(),mixed=make();
  const euler=new THREE.Euler(),heading=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0);
  let disposed=false;
  function copy(to,from) {
    to.root.copy(from.root);to.rotation.copy(from.rotation);to.state={...from.state};
    for(let i=0;i<bones.length;i++)to.rotations[i].copy(from.rotations[i]);
    return to;
  }
  function mix(to,from,other,w) {
    mixed.root.copy(from.root).lerp(other.root,w);
    mixed.rotation.copy(from.rotation).slerp(other.rotation,w).normalize();
    for(let i=0;i<bones.length;i++)mixed.rotations[i].copy(from.rotations[i]).slerp(other.rotations[i],w).normalize();
    mixed.state={...(w<.5?from:other).state};
    return copy(to,mixed);
  }
  function sample(id,progress,out,motion={}) {
    const clip=requireClip(id);
    const state=rig.update(Math.min(1-1e-7,Math.max(0,progress))*clip.duration,
      {actionId:id,speed:1,intensity:motion.intensity??.85});
    for(let i=0;i<bones.length;i++)out.rotations[i].copy(bones[i].quaternion);
    const lift=cat.userData.animationRootLift||0;
    out.root.set(state.rootX||0,lift*(id==='jump'?(motion.height??.5)/.5:1),state.rootZ||0);
    out.rotation.setFromEuler(euler.set(state.rootPitch||0,state.rootYaw||0,state.rootRoll||0));
    out.state={...state,source:clip.source};
    return out;
  }
  function publish(pose) {
    if(disposed)return null;
    for(let i=0;i<bones.length;i++)bones[i].quaternion.copy(pose.rotations[i]);
    euler.setFromQuaternion(pose.rotation,'XYZ');
    const state={...pose.state,rootX:pose.root.x,rootLift:pose.root.y,rootZ:pose.root.z,
      rootPitch:euler.x,rootYaw:euler.y,rootRoll:euler.z};
    cat.userData.animationRootLift=pose.root.y;
    cat.userData.animationRootX=pose.root.x;cat.userData.animationRootZ=pose.root.z;
    cat.userData.animationState=state;
    if(applyRoot){cat.position.copy(base).add(pose.root);cat.quaternion.copy(baseRotation).multiply(pose.rotation);}
    cat.updateMatrixWorld(true);rig.skeleton.update();
    pose.state=state;copy(shown,pose);
    return state;
  }
  // Capture the actually displayed skeleton, not an unrelated new idle pose.
  shown.root.set(cat.userData.animationRootX||0,cat.userData.animationRootLift||0,cat.userData.animationRootZ||0);
  const initial=cat.userData.animationState||{};
  shown.rotation.setFromEuler(euler.set(initial.rootPitch||0,initial.rootYaw||0,initial.rootRoll||0));
  shown.state={...initial};copy(entry,shown);
  return {
    begin(){if(!disposed)copy(entry,shown);},
    render(plan,time,entryElapsed=time) {
      if(disposed)return null;
      const layers=timelineLayers(plan,Math.max(0,Math.min(time,plan.duration)));
      if(!layers.length)throw new Error('动作时间轴没有有效片段');
      sample(layers[0].clip,layers[0].progress,a,plan.motion);
      if(layers.length>1){sample(layers[1].clip,layers[1].progress,b,plan.motion);mix(a,a,b,layers[1].weight);}
      if(plan.action==='spin') {
        const angle=smooth(time/plan.duration)*Math.PI*2*(plan.motion.turns??1);
        heading.setFromAxisAngle(up,angle);
        a.root.applyQuaternion(heading);a.root.x+=.32*(1-Math.cos(angle));a.root.z+=.32*Math.sin(angle);
        a.rotation.premultiply(heading);
      }
      if(entryElapsed<plan.transition)mix(a,entry,a,smooth(entryElapsed/plan.transition));
      return publish(a);
    },
    idle(time,blend=1) {
      if(disposed)return null;
      sample('idle',(Math.max(0,time)/requireClip('idle').duration)%1,a);
      if(blend<1)mix(a,entry,a,smooth(blend));
      return publish(a);
    },
    getState:()=>({...shown.state}),
    dispose(){disposed=true;},
  };
}
