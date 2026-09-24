import * as THREE from 'three';
import { BONE_NAMES, BONE_PARENT } from './skeleton.js';
import { solveTwoBone } from './kinematics.js';
import { smooth01 } from './expression.js';

// Preserve the source flight phase and non-standing poses. This is a bounded
// plane-contact refinement, NOT a terrain solver or world-space foot lock.
const GROUNDED = new Set(['idle','idle-alert','walk','sneak','bark','bite','howl']);
export const groundWeightFor = action => GROUNDED.has(action)?1:0;
const PREFIXES=['frontL','frontR','backL','backR'];
export function createGrounding(bones, anchors, {pose='standing',limitLocal=(name,q)=>q}={}) {
  const positions=new Map(BONE_NAMES.map(n=>[n,new THREE.Vector3()]));
  const rotations=new Map(BONE_NAMES.map(n=>[n,new THREE.Quaternion()]));
  const rootQ=new THREE.Quaternion(), inverseRoot=new THREE.Quaternion(), euler=new THREE.Euler();
  const identity=new THREE.Quaternion(), delta=new THREE.Quaternion(), local=new THREE.Quaternion();
  const from=new THREE.Vector3(), to=new THREE.Vector3();
  const legs=PREFIXES.map(prefix=>({prefix,
    upper:anchors.get(prefix+'Upper').distanceTo(anchors.get(prefix+'Lower')),
    lower:anchors.get(prefix+'Lower').distanceTo(anchors.get(prefix+'Foot')),
    soleY:anchors.get(prefix+'Foot').y}));
  const meanLength=legs.reduce((s,l)=>s+l.upper+l.lower,0)/4;
  function fk(){
    for(const name of BONE_NAMES){
      const bone=bones.get(name),parent=BONE_PARENT[name],p=positions.get(name),q=rotations.get(name);
      p.copy(bone.position); q.copy(bone.quaternion);
      if(parent){p.applyQuaternion(rotations.get(parent)).add(positions.get(parent));q.premultiply(rotations.get(parent)).normalize();}
    }
  }
  function aimBone(name,endName,target,limit,actionId){
    const p=positions.get(name),q=rotations.get(name),parent=BONE_PARENT[name];
    from.copy(positions.get(endName)).sub(p).normalize();to.copy(target).sub(p).normalize();
    if(from.lengthSq()<.5||to.lengthSq()<.5)return;
    delta.setFromUnitVectors(from,to);const angle=identity.angleTo(delta);
    if(angle>limit){const full=delta.clone();delta.copy(identity).slerp(full,limit/angle);}
    local.copy(delta).multiply(q);
    if(parent)local.premultiply(rotations.get(parent).clone().invert());
    bones.get(name).quaternion.copy(limitLocal(name,local,actionId)).normalize();fk();
  }
  function clearance(leg,lift){return positions.get(leg.prefix+'Foot').clone().applyQuaternion(rootQ).y+lift-leg.soleY;}
  return {
    apply(state) {
      const weight=pose==='standing'?THREE.MathUtils.clamp(state.groundWeight??groundWeightFor(state.actionId),0,1):0;
      if(weight<=1e-6)return {...state,grounding:{enabled:false,weight:0}};
      fk();rootQ.setFromEuler(euler.set(state.rootPitch||0,state.rootYaw||0,state.rootRoll||0));inverseRoot.copy(rootQ).invert();
      const before=legs.map(l=>clearance(l,state.rootLift||0));
      const bodyShift=THREE.MathUtils.clamp(-Math.min(...before),-meanLength*.15,meanLength*.15)*weight;
      let lift=(state.rootLift||0)+bodyShift;
      let adjusted=0,clampedTargets=0;
      for(const leg of legs){
        const {prefix,upper,lower}=leg, length=upper+lower;
        const gap=clearance(leg,lift);
        const contact=(1-smooth01(Math.max(0,gap)/(length*.16)))*weight;
        if(contact<1e-5||Math.abs(gap)<1e-7||Math.min(upper,lower)<1e-7)continue;
        const world=positions.get(prefix+'Foot').clone().applyQuaternion(rootQ);
        world.y-=THREE.MathUtils.clamp(gap,-length*.18,length*.18)*contact;
        const target=world.applyQuaternion(inverseRoot);
        const desired=solveTwoBone(positions.get(prefix+'Upper'),target,upper,lower,positions.get(prefix+'Lower'));
        const footRotation=rotations.get(prefix+'Foot').clone();
        if(desired.clamped)clampedTargets++;
        // Small corrections preserve main's existing short-limb safety envelope.
        aimBone(prefix+'Upper',prefix+'Lower',desired.joint,.18*contact,state.actionId);
        aimBone(prefix+'Lower',prefix+'Foot',desired.end,.22*contact,state.actionId);
        const footLocal=rotations.get(prefix+'Lower').clone().invert().multiply(footRotation);
        bones.get(prefix+'Foot').quaternion.copy(limitLocal(prefix+'Foot',footLocal,state.actionId)).normalize();
        fk();adjusted++;
      }
      // Angular safety caps take precedence over an exact IK target. Resolve any
      // remaining negative clearance only within the SAME bounded root budget.
      const residual=Math.min(...legs.map(l=>clearance(l,lift)));
      if(residual<0)lift+=Math.min(-residual,Math.max(0,meanLength*.15*weight-bodyShift));
      return {...state,rootLift:lift,grounding:{enabled:true,weight,adjusted,clampedTargets,
        bodyShift:lift-(state.rootLift||0),minClearanceBefore:Math.min(...before),minClearanceAfter:Math.min(...legs.map(l=>clearance(l,lift))),
        meanLegLength:meanLength}};
    },
  };
}
