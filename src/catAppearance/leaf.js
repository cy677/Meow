import * as THREE from 'three';
import { roundCone, meshFromSDF } from '../sdf.js';
import { injectPoke } from '../softPoke.js';
import { injectStaticIdle } from '../staticIdle.js';
import { LEAF_PALETTE } from './catalog.js';
import { installMouth } from './mouth.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
/** Small ornament primitive only; never used to construct the cat body or its tail. */
function petal(name, length, width, depth, color, gradientMap) {
  const geometry = new THREE.SphereGeometry(1, 20, 14), p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + 1) / 2, taper = 1 - .45 * t;
    p.setXYZ(i, p.getX(i) * width * taper / 2, t * length,
      p.getZ(i) * depth / 2 + Math.sin(t * Math.PI) * depth * .16);
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshToonMaterial({ color, gradientMap }));
  mesh.name = name; mesh.castShadow = true; return mesh;
}

function markingTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = LEAF_PALETTE.green; ctx.beginPath();
  ctx.moveTo(256, 118); ctx.bezierCurveTo(187, 77, 136, 46, 110, 62);
  ctx.bezierCurveTo(87, 84, 103, 151, 88, 174);
  ctx.lineTo(43, 202); ctx.bezierCurveTo(52, 262, 144, 350, 256, 403);
  ctx.bezierCurveTo(368, 350, 460, 262, 469, 202); ctx.lineTo(424, 174);
  ctx.bezierCurveTo(409, 151, 425, 84, 402, 62);
  ctx.bezierCurveTo(376, 46, 325, 77, 256, 118); ctx.closePath(); ctx.fill();
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Decorate the native cat in its ACTUAL pose. Native fur/index/weights/anchors are
 * untouched. The existing face and innerEar attachment paths are sufficient for
 * the unchanged 19-bone rig; there is no leaf-specific rig or action evaluator.
 */
export function decorateLeafCat(cat, {
  params, headC, hr, muzzle, earDef, staticIdleState,
  project, decal, innerEar, gradientMap,
}) {
  const face = cat.getObjectByName('face'), details = cat.getObjectByName('surfaceDetails');
  const mask = decal(project(V(0, .06, 1).normalize(), hr * 2.55, hr * 1.95, hr, 28),
    markingTexture(), 'leafFaceMarking', 1);
  face.add(mask);
  cat.getObjectByName('nose').material.color.set(LEAF_PALETTE.nose);

  for (const ear of earDef) {
    const original = cat.getObjectByName(ear.side < 0 ? 'innerEarDecalLeft' : 'innerEarDecalRight');
    if (original) original.visible = false;
    // A leaf-shaped cover over the ORIGINAL native ear, built with main's same
    // roundCone/SDF primitive. Do not change main's shared body geometry or bounds.
    const cover = { ...ear, len: ear.len * 1.7, r1: ear.r1 * 1.08, r2: ear.r2 * .55 };
    const primitive = roundCone({ a: cover.a, b: cover.a.clone().addScaledVector(cover.dir, cover.len),
      r1: cover.r1, r2: cover.r2, k: .02, tag: 'ear', u0: 0, u1: 1 });
    const geometry = meshFromSDF([primitive], Math.max(.008, Math.min(.02, hr * .035)));
    const p = geometry.attributes.position, idle = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const t = primitive.uAt(p.getX(i), p.getY(i), p.getZ(i));
      idle[i * 3 + (ear.side < 0 ? 1 : 2)] = THREE.MathUtils.smoothstep(t, .04, .34);
    }
    geometry.setAttribute('idleRegion', new THREE.BufferAttribute(idle, 3));
    geometry.setAttribute('idleTailU', new THREE.BufferAttribute(new Float32Array(p.count), 1));
    const material = injectStaticIdle(injectPoke(new THREE.MeshToonMaterial({ color: LEAF_PALETTE.green, gradientMap })), staticIdleState);
    const shell = new THREE.Mesh(geometry, material); shell.name = 'leafEarCover'; shell.castShadow = true;
    const group = new THREE.Group(); group.name = ear.side < 0 ? 'innerEarLeafLeft' : 'innerEarLeafRight';
    const inlay = innerEar([primitive], cover, staticIdleState, LEAF_PALETTE.inner);
    inlay.name = 'leafEarInlay'; group.add(shell, inlay); details.add(group);
  }

  for (const side of [-1, 1]) {
    const cheek = new THREE.Group(); cheek.name = side < 0 ? 'leafCheekLeft' : 'leafCheekRight';
    cheek.position.copy(headC).add(V(side * hr * .93, -hr * .28, hr * .13));
    for (let i = 0; i < 3; i++) {
      const lobe = petal(`cheekTuft${i}`, hr * (.45 - i * .055), hr * .34, hr * .28, LEAF_PALETTE.body, gradientMap);
      lobe.position.y = -hr * i * .105;
      lobe.quaternion.setFromUnitVectors(V(0, 1, 0), V(side, .55 - i * .62, .10).normalize()); cheek.add(lobe);
    }
    face.add(cheek);
  }

  // Neck bow follows the same native head attachment as the muzzle, using the
  // current pose's head centre, not hard-coded world coordinates or a new torso.
  const bow = new THREE.Group(); bow.name = 'leafNeckBow';
  bow.position.copy(headC).add(V(0, -hr * .80, hr * .30));
  const available = Math.max(hr * .06, bow.position.y - .015);
  for (const layer of [0, 1]) for (let i = -2; i <= 2; i++) {
    const length = Math.min(hr * (layer ? .29 : .48), available * .94);
    const leaf = petal(`neckLeaf${layer}_${i + 2}`, length, hr * (layer ? .20 : .31), hr * .13,
      layer ? LEAF_PALETTE.under : LEAF_PALETTE.green, gradientMap);
    leaf.position.set(i * hr * .18, Math.abs(i) * hr * .042 + layer * hr * .04,
      hr * (.26 - Math.abs(i) * .05 + layer * .025));
    leaf.quaternion.setFromUnitVectors(V(0, 1, 0), V(i * .48, -1, .08).normalize()); bow.add(leaf);
  }
  face.add(bow);
  installMouth(cat, { face, headC, hr, muzzle, project, decal, mode: params.mouthMode ?? 'auto' });
  // The native face soft-poke synchroniser moves child groups using their anchor.
  // Surface-projected decals already carry the native GPU poke shader.
  for (const node of face.children) if (!node.userData.skipPokeSync && !node.userData.basePos) {
    node.userData.basePos = node.position.clone(); node.userData.refPos = node.position.clone();
  }
  cat.userData.appearanceParts = ['leafFaceMarking', 'innerEarLeafLeft', 'innerEarLeafRight',
    'leafCheekLeft', 'leafCheekRight', 'leafNeckBow', 'leafOpenMouth'];
}
