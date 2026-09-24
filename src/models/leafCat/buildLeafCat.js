import * as THREE from 'three';
import { injectPoke } from '../../softPoke.js';
import { leafCatOptions, LEAF_CAT_ID } from './config.js';
import { createLeafBody } from './body.js';
import { createLeafDetails } from './details.js';

/** Same buildCat contract, SDF kernel, rig hints and renderer clock; different anatomy. */
export function buildLeafCat(params = {}, quality = 'full') {
  const started = performance.now(), options = leafCatOptions(params, quality);
  const body = createLeafBody(options), cat = new THREE.Group(); cat.name = 'LeafCat';
  const material = injectPoke(new THREE.MeshStandardMaterial({ color: options.palette.body, roughness: .82, metalness: 0 }));
  const fur = new THREE.Mesh(body.geometry, material); fur.name = 'fur'; fur.castShadow = true; cat.add(fur);
  const details = createLeafDetails(cat, body, options);
  Object.assign(cat.userData, {
    characterModel: LEAF_CAT_ID, modelVersion: 1, rigidFaceSurface: true,
    headC: body.headC.clone(), hr: body.hr, muzzle: body.muzzle.clone(),
    rigAnchorHints: body.hints, buttC: body.hints.tailBase.clone(),
    colliders: [{ c: new THREE.Vector3(0, .56 + body.lift, -.12), r: .38 * options.width }, { c: body.headC.clone(), r: body.hr * 1.10 }],
    updateEyeAnimation: details.updateEyes, updateStaticIdle: details.updateIdle,
    updateDynamicCoat: () => false,
    buildTimings: { totalMs: performance.now() - started },
    // Special original-cat SDF poses are not silently described as leaf-cat poses.
    referencePose: 'standing', requestedPose: params.pose ?? 'standing',
  });
  return cat;
}
