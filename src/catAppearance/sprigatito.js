import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { BONE_NAMES, assertSkeleton } from '../catMotion/skeleton.js';
import { createRealtimePlayer } from '../catMotion/realtimePlayer.js';
import { requireClip } from '../catMotion/clipCatalog.js';

let template, loading;
// The source is three units tall; the room's original cat is about 1.8 units.
// Place a uniformly scaled instance in the room without editing source vertices.
export const SPRIGATITO_ROOM_SCALE = .6;
export function loadSprigatito() {
  if (!loading) loading = new GLTFLoader().loadAsync(new URL('../assets/sprigatito-0906.glb', import.meta.url).href)
    .then(value => { template = value; return value; })
    .catch(error => { loading = null; throw new Error(`新叶喵模型加载失败：${error.message}`); });
  return loading;
}

const facialClips = { 'sprigatito-wink-left': 'wink_left', 'sprigatito-wink-right': 'wink_right', 'sprigatito-mouth': 'mouth_open_close' };
const clamp = value => THREE.MathUtils.clamp(value ?? 0, 0, 1);

/** Keep the authored mesh, materials, UVs and skin intact. Only sample the
 * existing 19-bone animation into the same player used by the original cat. */
export function buildSprigatito(params = {}, source = template) {
  if (!source) throw new Error('新叶喵模型尚未载入');
  const cat = new THREE.Group(); cat.name = 'Sprigatito0906';
  const scene = cloneSkeleton(source.scene); scene.scale.multiplyScalar(SPRIGATITO_ROOM_SCALE); cat.add(scene);
  const meshes = [], materialCopies = new Map(), textureCopies = new Map();
  const copyMaterial = material => {
    if (!materialCopies.has(material)) {
      const copy = material.clone();
      for (const key of Object.keys(copy)) if (copy[key]?.isTexture) {
        if (!textureCopies.has(copy[key])) textureCopies.set(copy[key], copy[key].clone());
        copy[key] = textureCopies.get(copy[key]);
      }
      materialCopies.set(material, copy);
    }
    return materialCopies.get(material);
  };
  scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.geometry = mesh.geometry.clone();
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copyMaterial) : copyMaterial(mesh.material);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    meshes.push(mesh);
  });
  const root = scene.getObjectByName('MeowMotionRoot');
  const skeleton = meshes.find(mesh => mesh.isSkinnedMesh)?.skeleton;
  assertSkeleton(skeleton);
  const bones = new Map(BONE_NAMES.map((name, i) => [name, skeleton.bones[i]]));
  cat.updateMatrixWorld(true);
  const anchors = new Map([...bones].map(([name, bone]) => [name, bone.getWorldPosition(new THREE.Vector3())]));
  const headC = anchors.get('head').clone(), hr = .68*SPRIGATITO_ROOM_SCALE;
  Object.assign(cat.userData, { catAppearance: 'sprigatito', modelVersion: '0906', materialStyle: 'original', headC, hr,
    motionScale:SPRIGATITO_ROOM_SCALE,
    muzzle: headC.clone().add(new THREE.Vector3(0,-.15,.45).multiplyScalar(SPRIGATITO_ROOM_SCALE)), buttC: anchors.get('hips').clone(),
    rigAnchorHints: Object.fromEntries(anchors), colliders: [
      { c: anchors.get('spineLow').clone(), r: .43*SPRIGATITO_ROOM_SCALE }, { c: headC.clone(), r: hr },
    ] });
  const channels = new Map(source.animations.map(clip => [clip.name, {
    duration: clip.duration,
    tracks: clip.tracks.map(track => {
      const binding = THREE.PropertyBinding.parseTrackName(track.name);
      const target = scene.getObjectByName(binding.nodeName);
      if (!target) throw new Error(`新叶喵动画节点缺失：${binding.nodeName}`);
      return { target, property: binding.propertyName, interpolant: track.createInterpolant() };
    }),
  }]));
  let state = { active:false, mouthOpen:0, blinkLeft:0, blinkRight:0 }, realtime;
  const euler = new THREE.Euler();
  function applyFace() {
    for (const mesh of meshes) {
      const dictionary = mesh.morphTargetDictionary;
      if (!dictionary) continue;
      for (const [name, value] of Object.entries({ Blink_L:clamp(state.blinkLeft), Blink_R:clamp(state.blinkRight), Mouth_Open:clamp(state.mouthOpen), Mouth_Close:1-clamp(state.mouthOpen) })) {
        if (dictionary[name] !== undefined) mesh.morphTargetInfluences[dictionary[name]] = value;
      }
    }
  }
  function sample(elapsed, options = {}) {
    const id = options.actionId ?? 'idle', clip = channels.get(facialClips[id] ?? id);
    if (!clip) throw new Error(`新叶喵缺少动作：${id}`);
    const meta = id === 'standing' ? {loop:false} : requireClip(id);
    const raw = Math.max(0, elapsed * (options.speed ?? 1));
    let time = meta.loop ? raw % clip.duration : Math.min(raw, clip.duration);
    if (options.travelDirection < 0 && ['walk','run','sneak'].includes(id)) time = clip.duration - time;
    for (const bone of skeleton.bones) bone.quaternion.identity();
    for (const mesh of meshes) mesh.morphTargetInfluences?.fill(0);
    root.position.set(0,0,0); root.quaternion.identity();
    for (const {target,property,interpolant} of clip.tracks) {
      const value = interpolant.evaluate(time);
      if (property === 'morphTargetInfluences') value.forEach((v,i) => { target.morphTargetInfluences[i] = v; });
      else target[property].fromArray(value);
    }
    const face = meshes.find(mesh => mesh.morphTargetDictionary?.Blink_L !== undefined);
    const weight = name => face?.morphTargetInfluences[face.morphTargetDictionary[name]] ?? 0;
    euler.setFromQuaternion(root.quaternion);
    const next = { active:true, actionId:id, amount:options.intensity ?? .85, phase:time/clip.duration,
      rootX:root.position.x*SPRIGATITO_ROOM_SCALE, rootLift:root.position.y*SPRIGATITO_ROOM_SCALE, rootZ:root.position.z*SPRIGATITO_ROOM_SCALE,
      rootPitch:euler.x, rootYaw:euler.y, rootRoll:euler.z,
      mouthOpen:weight('Mouth_Open'), blinkLeft:weight('Blink_L'), blinkRight:weight('Blink_R'),
      expressionSource:`clip:${id}`, compatibility:{grade:'good',label:'原版骨骼动作'}, boneLengthError:0,
    };
    // World placement is applied by the shared stage exactly once.
    root.position.set(0,0,0); root.quaternion.identity();
    return options.sampleOnly ? next : finalizePose(next);
  }
  function finalizePose(next) {
    state = {...next}; Object.assign(cat.userData, {animationState:state,
      animationRootLift:state.rootLift ?? 0, animationRootX:state.rootX ?? 0, animationRootZ:state.rootZ ?? 0});
    applyFace(); cat.updateMatrixWorld(true); skeleton.update(); return state;
  }
  function reset() {
    sample(0,{actionId:'standing'}); cat.quaternion.identity(); realtime?.reset();
  }
  const rig = { type:'sprigatito-0906-skinned', skeleton, bones, anchors, pose:'standing',
    update:(elapsed,options={}) => options.delta !== undefined ? realtime.update(options.delta,{...options,elapsed}) : sample(elapsed,options),
    finalizePose, reset, getState:()=>state, getCompatibility:()=>({grade:'good',label:'原版骨骼动作'}),
  };
  realtime = createRealtimePlayer(rig,cat);
  cat.userData.motionRig = rig;
  cat.userData.updateMouthAnimation = applyFace;
  cat.userData.updateEyeAnimation = () => {};
  cat.userData.updateStaticIdle = (time,enabled) => {
    if (enabled) {
      if (params.pose === 'stretch') sample(channels.get('stretch').duration*.48,{actionId:'stretch'});
      else sample(time,{actionId:'idle'});
    }
    return {enabled};
  };
  reset();
  return cat;
}
