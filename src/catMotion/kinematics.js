import * as THREE from 'three';

/** Analytic two-link joint positions. No bone scaling or rest-pose mutation.
 * The aim direction is normalized by the ORIGINAL distance (not clamped reach).
 */
export function solveTwoBone(root, target, upperLength, lowerLength, pole) {
  if (![upperLength,lowerLength].every(v=>Number.isFinite(v)&&v>1e-7) ||
      ![root,target,pole].every(v=>v && [v.x,v.y,v.z].every(Number.isFinite))) {
    throw new TypeError('IK 需要有效的两段长度、根位置、目标与膝部方向');
  }
  const aim=target.clone().sub(root), originalDistance=aim.length();
  if(originalDistance>1e-9) aim.multiplyScalar(1/originalDistance); else aim.set(0,-1,0);
  const epsilon=Math.min(upperLength,lowerLength)*1e-5;
  const distance=THREE.MathUtils.clamp(originalDistance,Math.abs(upperLength-lowerLength)+epsilon,upperLength+lowerLength-epsilon);
  const bend=pole.clone().sub(root).addScaledVector(aim,-pole.clone().sub(root).dot(aim));
  if(bend.lengthSq()<1e-12){bend.set(Math.abs(aim.z)<.9?0:1,0,Math.abs(aim.z)<.9?1:0);bend.addScaledVector(aim,-bend.dot(aim));}
  bend.normalize();
  const along=(upperLength*upperLength+distance*distance-lowerLength*lowerLength)/(2*distance);
  const height=Math.sqrt(Math.max(0,upperLength*upperLength-along*along));
  return {joint:root.clone().addScaledVector(aim,along).addScaledVector(bend,height),
    end:root.clone().addScaledVector(aim,distance),clamped:Math.abs(distance-originalDistance)>epsilon*.5};
}
