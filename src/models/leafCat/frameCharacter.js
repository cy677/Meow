import * as THREE from 'three';

/** Fit once on a character switch. Do not fight orbit/zoom on every frame. */
export function frameCharacter(cat, camera, controls) {
  const box = new THREE.Box3().setFromObject(cat);
  if (box.isEmpty() || !camera.isPerspectiveCamera) return;
  const center = box.getCenter(new THREE.Vector3());
  const back = camera.position.clone().sub(controls.target).normalize();
  const right = new THREE.Vector3().crossVectors(camera.up, back).normalize();
  const up = new THREE.Vector3().crossVectors(back, right).normalize();
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tanH = tanV * camera.aspect;
  let distance = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const offset = new THREE.Vector3(x, y, z).sub(center), depth = offset.dot(back);
    distance = Math.max(distance, depth + Math.abs(offset.dot(right)) / (tanH * .83), depth + Math.abs(offset.dot(up)) / (tanV * .83));
  }
  distance = THREE.MathUtils.clamp(distance, controls.minDistance, controls.maxDistance);
  controls.target.copy(center); camera.position.copy(center).addScaledVector(back, distance); controls.update();
}
