import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildLeafCat } from './buildLeafCat.js';
import { createMesh2MotionSkinRig } from '../../mesh2motionSkinRig.js';
import { CLIP_BY_ID } from '../../catMotion/clipCatalog.js';

export function disposeLeafCat(cat) {
  const geometries = new Set(), materials = new Set(), skeletons = new Set();
  cat.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    for (const mat of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) materials.add(mat);
    if (node.skeleton) skeletons.add(node.skeleton);
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
  for (const s of skeletons) s.dispose();
  cat.removeFromParent();
}

/** Bake the existing rig, rather than inventing a second motion implementation. */
export function bakeLeafClips(cat, rig, ids = ['idle', 'walk', 'paw', 'jump'], fps = 24) {
  return ids.map(id => {
    const source = CLIP_BY_ID.get(id);
    if (!source) throw new RangeError(`Unknown leaf-cat clip: ${id}`);
    const frames = Math.ceil(source.duration * fps), times = [];
    const nodes = [cat, ...rig.skeleton.bones];
    const samples = nodes.map(() => ({ position: [], quaternion: [] }));
    for (let frame = 0; frame <= frames; frame++) {
      const t = frame / frames * source.duration; times.push(t);
      const state = rig.update(t, { actionId: id, intensity: .65 });
      cat.position.set(state.rootX ?? 0, cat.userData.animationRootLift ?? 0, state.rootZ ?? 0);
      cat.rotation.set(state.rootPitch ?? 0, state.rootYaw ?? 0, state.rootRoll ?? 0);
      for (let i = 0; i < nodes.length; i++) {
        samples[i].position.push(...nodes[i].position.toArray());
        samples[i].quaternion.push(...nodes[i].quaternion.toArray());
      }
    }
    const tracks = nodes.flatMap((node, i) => [
      new THREE.VectorKeyframeTrack(`${node.name}.position`, times, samples[i].position),
      new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, samples[i].quaternion),
    ]);
    return new THREE.AnimationClip(id, source.duration, tracks);
  });
}

/** A fresh model avoids disturbing a live child's animation or disposing its assets. */
export async function exportLeafCat(params = {}, { animated = true } = {}) {
  const cat = buildLeafCat(params), rig = createMesh2MotionSkinRig(cat, 'standing');
  try {
    const animations = animated ? bakeLeafClips(cat, rig) : [];
    rig.reset(); cat.position.set(0, 0, 0); cat.updateMatrixWorld(true); rig.skeleton.update();
    // Builder-only attributes/functions are not model assets; omit them from GLB.
    cat.traverse(node => {
      if (node.geometry) for (const name of Object.keys(node.geometry.attributes)) {
        if (name.startsWith('rig')) node.geometry.deleteAttribute(name);
      }
      node.userData = {};
    });
    cat.userData = { characterModel: 'leaf-cat', version: 1, sourceProject: 'cy677/Meow',
      note: 'Procedural reference-sheet reconstruction. Original project license applies.' };
    return await new GLTFExporter().parseAsync(cat, { binary: true, animations, onlyVisible: true });
  } finally { disposeLeafCat(cat); }
}
