import { CLIP_BY_ID, timelineLayers } from './motionPrograms.mjs';

/** Sample the existing upstream rig; never allocate a second skeleton or remesh per step. */
export function createMotionTimeline(rig, cat) {
  const bones=rig.skeleton.bones;
  const previous=bones.map(b=>b.quaternion.clone());
  const incoming=bones[0].quaternion.clone();
  let entry=null,lastPlan=null;
  const rootFields=['rootX','rootZ','rootLift','rootPitch','rootYaw','rootRoll'];
  return (plan,time)=>{
    if(lastPlan!==plan){entry=bones.map(b=>b.quaternion.clone());lastPlan=plan;}
    const layers=timelineLayers(plan,Math.min(time,plan.duration-1e-7));
    let result,previousLift=0;
    for(const [index,layer] of layers.entries()){
      const clip=CLIP_BY_ID.get(layer.clip);
      const state={...rig.update(Math.min(1-1e-7,layer.progress)*clip.duration,{actionId:clip.id,speed:1,intensity:plan.motion.intensity})};
      let lift=cat.userData.animationRootLift||0;
      if(clip.id==='jump')lift*=(plan.motion.height??.5)/.5;
      if(index){
        for(let i=0;i<bones.length;i++){
          incoming.copy(bones[i].quaternion);
          bones[i].quaternion.copy(previous[i]).slerp(incoming,layer.weight);
        }
      }
      if(index===0){
        bones.forEach((b,i)=>previous[i].copy(b.quaternion));result=state;previousLift=lift;
      }else{
        for(const key of rootFields)state[key]=(result[key]||0)*(1-layer.weight)+(state[key]||0)*layer.weight;
        result=state;previousLift=previousLift*(1-layer.weight)+lift*layer.weight;
      }
    }
    const entryWeight=Math.min(1,time/plan.transition);
    if(entryWeight<1)bones.forEach((b,i)=>b.quaternion.slerp(entry[i],1-entryWeight*entryWeight*(3-2*entryWeight)));
    if(plan.action==='spin')result.rootYaw=(result.rootYaw||0)+Math.PI*2*(plan.motion.turns??1)*Math.min(1,time/plan.duration);
    cat.userData.animationRootLift=previousLift;
    rig.skeleton.update();
    return result;
  };
}
