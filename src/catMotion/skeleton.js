/** Names and hierarchy of the existing Meow 19-bone quadruped. No new rig. */
export const BONE_PARENT = Object.freeze({
  hips: null,
  spineLow: 'hips',
  spineHigh: 'spineLow',
  head: 'spineHigh',
  frontLUpper: 'spineHigh',
  frontLLower: 'frontLUpper',
  frontLFoot: 'frontLLower',
  frontRUpper: 'spineHigh',
  frontRLower: 'frontRUpper',
  frontRFoot: 'frontRLower',
  backLUpper: 'hips',
  backLLower: 'backLUpper',
  backLFoot: 'backLLower',
  backRUpper: 'hips',
  backRLower: 'backRUpper',
  backRFoot: 'backRLower',
  tailBase: 'hips',
  tailMid: 'tailBase',
  tailTip: 'tailMid',
});
export const BONE_NAMES = Object.freeze(Object.keys(BONE_PARENT));
export const FOOT_BONES = Object.freeze(['frontLFoot','frontRFoot','backLFoot','backRFoot']);
export const TARGET_SLOTS = Object.freeze([...FOOT_BONES,'head','root']);
export function assertSkeleton(skeleton) {
  if(!skeleton || skeleton.bones.length!==BONE_NAMES.length ||
    skeleton.bones.some((bone,i)=>bone.name!==`m2m_${BONE_NAMES[i]}`)) {
    throw new Error('动作框架需要现有 Meow 19 骨骼及其固定顺序');
  }
}
