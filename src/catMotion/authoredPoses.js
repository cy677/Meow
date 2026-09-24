import * as THREE from 'three';
import { BONE_NAMES, BONE_PARENT } from './skeleton.js';
import { smooth01 as smooth } from './expression.js';

/** Meow-authored local joint curves, not renamed Mesh2Motion clips.
 * Coordinates: +Y up, +Z forward. Angles are local XYZ radians.
 * These are in-place pose exercises; no climbing height or contact is inferred.
 * SkinRig still enforces its existing proportion-aware joint limits.
 */
const zero = () => ({angles:{},root:{rootX:0,rootZ:0,rootLift:0,rootPitch:0,rootYaw:0,rootRoll:0}});
const set = (pose,bone,x=0,y=0,z=0) => {pose.angles[bone]=[x,y,z];};
function keyframes(frames,phase) {
  let i=1;
  while(i<frames.length-1 && phase>frames[i][0])i++;
  const [a,from]=frames[i-1],[b,to]=frames[i],w=smooth((phase-a)/(b-a));
  const result={};
  for(const bone of new Set([...Object.keys(from),...Object.keys(to)])) {
    result[bone]=[0,1,2].map(k=>(from[bone]?.[k]||0)*(1-w)+(to[bone]?.[k]||0)*w);
  }
  return result;
}
// Each one-shot starts/ends at the bind-neutral pose. The runtime crossfades it
// with the live pose; the sampler never accumulates rotations from prior frames.
const PAW=[
  [0,{}],
  [.22,{frontLUpper:[-.28,0,.08],frontLLower:[.32],spineHigh:[0,-.04,-.025],head:[-.08,.1]}],
  [.4,{frontLUpper:[-.72,0,.18],frontLLower:[.58],frontLFoot:[-.22],spineLow:[0,0,-.035],head:[-.12,.14],tailBase:[0,-.09]}],
  [.54,{frontLUpper:[-.62,-.3,-.1],frontLLower:[.2],frontLFoot:[.16],spineHigh:[-.06,-.08,-.04],head:[-.08,.04],backRUpper:[-.05],tailBase:[0,.09]}],
  [.78,{frontLUpper:[-.22,.1,.08],frontLLower:[.36],head:[-.02,-.06]}],
  [1,{}],
];
const MANTLE=[
  [0,{}],
  [.12,{hips:[-.08],spineLow:[-.06],head:[-.12],backLUpper:[-.2],backLLower:[.26],backRUpper:[-.2],backRLower:[.26]}],
  [.25,{hips:[-.18],spineLow:[-.15],spineHigh:[-.18],frontLUpper:[-.72],frontRUpper:[-.72],frontLLower:[.2],frontRLower:[.2],frontLFoot:[.2],frontRFoot:[.2],head:[.12]}],
  [.5,{hips:[-.14],spineHigh:[-.2],frontLUpper:[-.38],frontRUpper:[-.38],frontLLower:[.57],frontRLower:[.57],head:[.16],backLUpper:[-.28],backLLower:[.4],tailBase:[.14]}],
  [.7,{spineLow:[.08],frontLUpper:[-.15],frontRUpper:[-.15],frontLLower:[.2],frontRLower:[.2],backLUpper:[-.45],backLLower:[.48],backRUpper:[.2],backRLower:[-.12],head:[-.1],tailBase:[.12]}],
  [.85,{hips:[.04],backLUpper:[-.08],backRUpper:[-.2],backRLower:[.2],spineHigh:[.05],head:[-.04]}],
  [1,{}],
];
const STRETCH=[
  [0,{}],
  [.2,{hips:[.08],spineLow:[.08],spineHigh:[.12],head:[-.12],frontLUpper:[-.2],frontRUpper:[-.2]}],
  [.48,{hips:[.14],spineLow:[.2],spineHigh:[.28],head:[-.25],frontLUpper:[-.65],frontRUpper:[-.65],frontLLower:[.12],frontRLower:[.12],frontLFoot:[.1],frontRFoot:[.1],backLUpper:[.15],backRUpper:[.15],tailBase:[-.18],tailMid:[-.12]}],
  [.7,{hips:[.12],spineLow:[.14],spineHigh:[.2],head:[-.18],frontLUpper:[-.45],frontRUpper:[-.45],frontLLower:[.2],frontRLower:[.2],tailBase:[-.1]}],
  [1,{}],
];
const BOW=[
  [0,{}],
  [.24,{head:[.1],spineHigh:[.06],tailBase:[-.12]}],
  [.48,{hips:[-.04],spineLow:[.12],spineHigh:[.19],head:[.26],frontLUpper:[-.32],frontRUpper:[-.32],frontLLower:[.36],frontRLower:[.36],frontLFoot:[-.08],frontRFoot:[-.08],tailBase:[-.18],tailMid:[-.1]}],
  [.65,{hips:[-.04],spineLow:[.12],spineHigh:[.19],head:[.28],frontLUpper:[-.32],frontRUpper:[-.32],frontLLower:[.36],frontRLower:[.36],tailBase:[-.18],tailMid:[-.1]}],
  [.86,{head:[-.1],spineHigh:[-.025],tailBase:[0,.08]}],
  [1,{}],
];
const HEAD_TILT=[
  [0,{}],
  [.22,{head:[-.08,.12,.26],spineHigh:[0,.03,.025],tailBase:[-.08,.16],tailMid:[0,.1]}],
  [.4,{head:[-.1,.1,.28],spineHigh:[0,.03,.025],tailBase:[-.08,-.1],tailMid:[0,-.08]}],
  [.65,{head:[-.06,-.14,-.26],spineHigh:[0,-.03,-.025],tailBase:[-.08,.16],tailMid:[0,.1]}],
  [.8,{head:[-.08,-.1,-.24],spineHigh:[0,-.03,-.025],tailBase:[-.08,-.08],tailMid:[0,-.06]}],
  [1,{}],
];
export function sampleAuthoredPose(id,phase,intensity=1) {
  if(!Number.isFinite(phase)||!Number.isFinite(intensity))throw new TypeError('动作采样参数必须为有限数');
  const p=Math.max(0,Math.min(1,phase)),amount=Math.max(0,Math.min(1.6,intensity));
  const pose=zero(),wave=Math.sin(p*Math.PI*2);
  if(id==='paw')pose.angles=keyframes(PAW,p);
  else if(id==='wave') {
    const hold=smooth(p/.24)*(1-smooth((p-.76)/.24));
    const swing=Math.sin(smooth((p-.22)/.56)*Math.PI*4)*hold;
    set(pose,'frontLUpper',-.8*hold,0,(.17+.07*swing)*hold);
    set(pose,'frontLLower',-.58*hold,0,.14*swing);
    set(pose,'frontLFoot',.28*hold,0,.22*swing);
    set(pose,'spineLow',0,0,-.03*hold);set(pose,'spineHigh',0,-.035*hold,-.025*hold);
    set(pose,'head',-.1*hold,.12*hold,.05*swing);
    set(pose,'tailBase',-.08*hold,.16*swing);set(pose,'tailMid',0,.1*swing);
  } else if(id==='bow')pose.angles=keyframes(BOW,p);
  else if(id==='head-tilt')pose.angles=keyframes(HEAD_TILT,p);
  else if(id==='mantle') {
    pose.angles=keyframes(MANTLE,p);
    pose.root.rootPitch=-.18*Math.sin(p*Math.PI);
    pose.root.rootLift=.08*Math.sin(p*Math.PI);
  } else if(id==='stretch') {
    pose.angles=keyframes(STRETCH,p);
    pose.root.rootLift=.035*Math.sin(p*Math.PI);
  } else if(id==='scratch') {
    set(pose,'hips',-.06);set(pose,'spineLow',-.07);set(pose,'spineHigh',-.1);
    set(pose,'head',.12,0,.025*wave);set(pose,'tailBase',0,.1*wave);
    for(const [side,sign] of [['L',1],['R',-1]]) {
      const s=wave*sign;
      set(pose,`front${side}Upper`,-.4-.24*s,0,.07*sign);
      set(pose,`front${side}Lower`,.3+.2*s);
      set(pose,`front${side}Foot`,-.08+.18*s);
      set(pose,`back${side}Upper`,.04+.035*s);
    }
    pose.root.rootPitch=-.12;pose.root.rootLift=.025;
  } else if(id==='climb-up' || id==='climb-down') {
    const down=id==='climb-down',q=Math.sin((p+(down?.08:0))*Math.PI*2);
    set(pose,'hips',down?-.1:-.18);set(pose,'spineLow',-.12);set(pose,'spineHigh',-.14);
    set(pose,'head',down?.32:.18,0,.025*q);
    set(pose,'tailBase',.12,.12*q);set(pose,'tailMid',.08,.08*q);
    for(const [side,sign] of [['L',1],['R',-1]]) {
      const s=q*sign;
      set(pose,`front${side}Upper`,-.4+(down?.2:-.28)*s,0,.06*sign);
      set(pose,`front${side}Lower`,.28+(down?-.16:.22)*s);
      set(pose,`front${side}Foot`,(down?.1:-.05)+.12*s);
      set(pose,`back${side}Upper`,-.06+(down?.18:-.22)*s);
      set(pose,`back${side}Lower`,.16-(down?.12:.18)*s);
      set(pose,`back${side}Foot`,-.08+.08*s);
    }
    pose.root.rootPitch=down?-.32:-.4;
    pose.root.rootLift=.08+.012*Math.cos(p*4*Math.PI);
  } else throw new RangeError(`未知新增动作: ${id}`);
  for(const angles of Object.values(pose.angles))for(let k=0;k<3;k++)angles[k]=(angles[k]||0)*amount;
  for(const key of Object.keys(pose.root))pose.root[key]*=amount;
  return pose;
}
export function authoredGlobalQuaternions(pose) {
  const globals=new Map(),euler=new THREE.Euler();
  for(const name of BONE_NAMES) {
    const [x=0,y=0,z=0]=pose.angles[name]||[];
    const local=new THREE.Quaternion().setFromEuler(euler.set(x,y,z));
    const parent=BONE_PARENT[name];
    globals.set(name,parent?globals.get(parent).clone().multiply(local).normalize():local);
  }
  return globals;
}
