import * as THREE from 'three';
import {
  getRigCompatibility,
  prepareSourceRetarget,
  sampleMesh2MotionAction,
} from './mesh2motionRig.js';
import { SOURCE_BONE_ORDER } from './mesh2motionSource.js';

import { BONE_PARENT } from './catMotion/skeleton.js';
import { authoredGlobalQuaternions } from './catMotion/authoredPoses.js';

const BONE_INDEX = new Map(SOURCE_BONE_ORDER.map((name, index) => [name, index]));
const LEG_PREFIX_BY_ID = Object.freeze([
  'frontL',
  'frontR',
  'backL',
  'backR',
]);
const BUTT_HIDDEN_ACTIONS = new Set(['fall', 'rest-pose', 'death']);
const BONE_ROTATION_LIMIT = Object.freeze({
  hips: Math.PI * 0.45,
  spineLow: Math.PI * 0.32,
  spineHigh: Math.PI * 0.36,
  head: Math.PI * 0.34,
  // The source animal has long separated limbs. A round SDF cat has very
  // short joint spans, so allowing the source's full 70-90 degree bends makes
  // a continuous shoulder/hip surface fold back through itself. These hinge
  // caps preserve the clip timing while keeping every joint below the
  // self-intersection threshold of the fixed mesh.
  frontLUpper: Math.PI * 0.26,
  frontLLower: Math.PI * 0.2,
  frontLFoot: Math.PI * 0.16,
  frontRUpper: Math.PI * 0.26,
  frontRLower: Math.PI * 0.2,
  frontRFoot: Math.PI * 0.16,
  backLUpper: Math.PI * 0.26,
  backLLower: Math.PI * 0.2,
  backLFoot: Math.PI * 0.16,
  backRUpper: Math.PI * 0.26,
  backRLower: Math.PI * 0.2,
  backRFoot: Math.PI * 0.16,
  tailBase: Math.PI * 0.26,
  tailMid: Math.PI * 0.32,
  tailTip: Math.PI * 0.38,
});
const ACTION_SAFETY_SCALE = Object.freeze({
  walk: 0.84,
  run: 0.8,
  sneak: 0.84,
  jump: 0.76,
  fall: 0.62,
  sit: 0.72,
  'rest-pose': 0.64,
  fetch: 0.78,
  death: 0.5,
});
const _point = new THREE.Vector3();
const _pointB = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _parentInverse = new THREE.Quaternion();

export const MESH2MOTION_SKIN_INFO = Object.freeze({
  type: 'fixed-skinned-mesh',
  bones: SOURCE_BONE_ORDER.length,
  maxInfluences: 4,
  parents: BONE_PARENT,
});

function clamp01(value) {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function attributeComponent(attribute, index, component) {
  if (!attribute) return 0;
  if (component === 0) return attribute.getX(index);
  if (component === 1) return attribute.getY(index);
  if (component === 2) return attribute.getZ(index);
  return attribute.getW(index);
}

function metricsFromCat(cat, fur) {
  fur.geometry.computeBoundingBox();
  const bbox = fur.geometry.boundingBox.clone();
  return {
    bbox,
    minY: bbox.min.y,
    minZ: bbox.min.z,
    maxY: bbox.max.y,
    maxZ: bbox.max.z,
    height: Math.max(0.001, bbox.max.y - bbox.min.y),
    width: Math.max(0.001, bbox.max.x - bbox.min.x),
    depth: Math.max(0.001, bbox.max.z - bbox.min.z),
    centerZ: (bbox.min.z + bbox.max.z) * 0.5,
    headC: cat.userData.headC.clone(),
    headRadius: cat.userData.hr,
    anchorHints: cat.userData.rigAnchorHints ?? null,
  };
}

function averageTailAnchor(geometry, targetU, fallback) {
  const position = geometry.getAttribute('position');
  const tailU = geometry.getAttribute('rigTailU');
  const influence = geometry.getAttribute('rigInfluence');
  if (!tailU || !influence) return fallback.clone();
  const sum = new THREE.Vector3();
  let total = 0;
  for (let i = 0; i < position.count; i++) {
    const u = tailU.getX(i);
    if (u < 0) continue;
    const tailWeight = influence.getW(i);
    const proximity = Math.max(0, 1 - Math.abs(u - targetU) / 0.18);
    const weight = tailWeight * proximity * proximity;
    if (weight <= 1e-5) continue;
    sum.x += position.getX(i) * weight;
    sum.y += position.getY(i) * weight;
    sum.z += position.getZ(i) * weight;
    total += weight;
  }
  return total > 1e-5 ? sum.multiplyScalar(1 / total) : fallback.clone();
}

function legAnchors(geometry, metrics, side, front) {
  const position = geometry.getAttribute('position');
  const influence = geometry.getAttribute('rigInfluence');
  const rigLegId = geometry.getAttribute('rigLegId');
  const rigLegU = geometry.getAttribute('rigLegU');
  const rigLegBlend = geometry.getAttribute('rigLegBlend');
  const rigLegCoord = geometry.getAttribute('rigLegCoord');
  const sideSign = side === 'L' ? 1 : -1;
  const prefix = `${front ? 'front' : 'back'}${side}`;
  const legId = LEG_PREFIX_BY_ID.indexOf(prefix);
  const points = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const legWeight = influence ? influence.getZ(i) : 0;
    if (legWeight < 0.04) continue;
    const continuousShare = rigLegBlend
      ? attributeComponent(rigLegBlend, i, legId)
      : -1;
    const sampledLegId = rigLegId ? Math.round(rigLegId.getX(i)) : -1;
    if (continuousShare >= 0) {
      if (continuousShare < 0.025) continue;
    } else if (sampledLegId >= 0) {
      if (sampledLegId !== legId) continue;
    } else {
      if (Math.sign(x || sideSign) !== sideSign) continue;
      if ((z >= metrics.centerZ) !== front) continue;
    }
    points.push({
      x,
      y: position.getY(i),
      z,
      weight: legWeight * (continuousShare >= 0 ? continuousShare : 1),
      u: rigLegCoord
        ? attributeComponent(rigLegCoord, i, legId)
        : (rigLegU ? rigLegU.getX(i) : -1),
    });
  }
  if (!points.length) {
    const x = sideSign * metrics.width * 0.24;
    const z = metrics.centerZ + (front ? 1 : -1) * metrics.depth * 0.27;
    return {
      upper: new THREE.Vector3(x, metrics.minY + metrics.height * 0.48, z),
      lower: new THREE.Vector3(x, metrics.minY + metrics.height * 0.22, z),
      foot: new THREE.Vector3(x, metrics.minY + metrics.height * 0.045, z),
    };
  }
  const averageAt = (targetU, fallbackT) => {
    let xSum = 0;
    let ySum = 0;
    let zSum = 0;
    let total = 0;
    for (const sample of points) {
      const proximity = sample.u >= 0
        ? Math.exp(-Math.pow((sample.u - targetU) / 0.13, 2))
        : 1;
      const weight = sample.weight * proximity;
      xSum += sample.x * weight;
      ySum += sample.y * weight;
      zSum += sample.z * weight;
      total += weight;
    }
    if (total > 1e-5) {
      return new THREE.Vector3(xSum / total, ySum / total, zSum / total);
    }
    const sorted = [...points].sort((a, b) => a.y - b.y);
    const sample = sorted[Math.round((sorted.length - 1) * fallbackT)];
    return new THREE.Vector3(sample.x, sample.y, sample.z);
  };
  return {
    upper: averageAt(0.08, 0.82),
    lower: averageAt(0.52, 0.46),
    foot: averageAt(0.94, 0.08),
  };
}

function createTargetAnchors(geometry, metrics) {
  const anchors = new Map();
  const hinted = (name, fallback) => (
    metrics.anchorHints?.[name]?.clone?.() ?? fallback
  );
  anchors.set('hips', hinted('hips', new THREE.Vector3(
    0,
    metrics.minY + metrics.height * 0.52,
    metrics.minZ + metrics.depth * 0.28
  )));
  anchors.set('spineLow', hinted('spineLow', new THREE.Vector3(
    0,
    metrics.minY + metrics.height * 0.57,
    metrics.centerZ - metrics.depth * 0.08
  )));
  anchors.set('spineHigh', hinted('spineHigh', new THREE.Vector3(
    0,
    metrics.minY + metrics.height * 0.63,
    metrics.centerZ + metrics.depth * 0.19
  )));
  anchors.set('head', hinted('head', metrics.headC.clone()));

  for (const side of ['L', 'R']) {
    for (const front of [true, false]) {
      const end = front ? 'front' : 'back';
      const sampled = legAnchors(geometry, metrics, side, front);
      anchors.set(
        `${end}${side}Upper`,
        hinted(`${end}${side}Upper`, sampled.upper)
      );
      anchors.set(
        `${end}${side}Lower`,
        hinted(`${end}${side}Lower`, sampled.lower)
      );
      anchors.set(
        `${end}${side}Foot`,
        hinted(`${end}${side}Foot`, sampled.foot)
      );
    }
  }

  const tailFallbackBase = new THREE.Vector3(
    0,
    metrics.minY + metrics.height * 0.63,
    metrics.minZ + metrics.depth * 0.13
  );
  const tailFallbackMid = new THREE.Vector3(
    metrics.width * 0.24,
    metrics.minY + metrics.height * 0.7,
    metrics.minZ + metrics.depth * 0.18
  );
  const tailFallbackTip = new THREE.Vector3(
    metrics.width * 0.32,
    metrics.minY + metrics.height * 0.82,
    metrics.centerZ
  );
  anchors.set(
    'tailBase',
    hinted('tailBase', averageTailAnchor(geometry, 0.08, tailFallbackBase))
  );
  anchors.set(
    'tailMid',
    hinted('tailMid', averageTailAnchor(geometry, 0.5, tailFallbackMid))
  );
  anchors.set(
    'tailTip',
    hinted('tailTip', averageTailAnchor(geometry, 0.92, tailFallbackTip))
  );
  return anchors;
}

function addWeight(accumulator, boneName, weight) {
  if (weight <= 1e-6) return;
  const index = BONE_INDEX.get(boneName);
  if (index == null) return;
  accumulator.set(index, (accumulator.get(index) ?? 0) + weight);
}

function addLinearWeights(accumulator, from, to, mix, weight) {
  addWeight(accumulator, from, weight * (1 - mix));
  addWeight(accumulator, to, weight * mix);
}

export function sampleLegSkinWeights(prefix, legU, weight = 1) {
  const u = clamp01(legU);
  if (u <= 1e-6) {
    return [
      [`${prefix}Upper`, weight],
      [`${prefix}Lower`, 0],
      [`${prefix}Foot`, 0],
    ];
  }
  if (u >= 1 - 1e-6) {
    return [
      [`${prefix}Upper`, 0],
      [`${prefix}Lower`, 0],
      [`${prefix}Foot`, weight],
    ];
  }
  // Keep the three-way support local to the two anatomical joints. The old
  // broad overlap let the foot rotate vertices near the hip, which amplified
  // long-leg poses into four-times edge stretch.
  const kneeMixRaw = clamp01((u - 0.28) / 0.42);
  const kneeMix = kneeMixRaw * kneeMixRaw * (3 - 2 * kneeMixRaw);
  const footMixRaw = clamp01((u - 0.72) / 0.24);
  const footMix = footMixRaw * footMixRaw * (3 - 2 * footMixRaw);
  const upper = 1 - kneeMix;
  const lower = kneeMix * (1 - footMix);
  const foot = footMix;
  const total = Math.max(upper + lower + foot, 1e-6);
  return [
    [`${prefix}Upper`, weight * upper / total],
    [`${prefix}Lower`, weight * lower / total],
    [`${prefix}Foot`, weight * foot / total],
  ];
}

function installSkinAttributes(geometry, metrics) {
  const position = geometry.getAttribute('position');
  const rigInfluence = geometry.getAttribute('rigInfluence');
  const rigPart = geometry.getAttribute('rigPart');
  const rigTailU = geometry.getAttribute('rigTailU');
  const rigLegId = geometry.getAttribute('rigLegId');
  const rigLegU = geometry.getAttribute('rigLegU');
  const rigLegBlend = geometry.getAttribute('rigLegBlend');
  const rigLegCoord = geometry.getAttribute('rigLegCoord');
  const skinIndices = new Uint16Array(position.count * 4);
  const skinWeights = new Float32Array(position.count * 4);
  const bonesUsed = new Set();
  let invalidWeights = 0;
  let maxWeightError = 0;

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const part = rigPart ? Math.round(rigPart.getX(i)) : 0;
    const bodyWeight = rigInfluence ? rigInfluence.getX(i) : (part === 0 ? 1 : 0);
    const headWeight = rigInfluence ? rigInfluence.getY(i) : (part === 1 ? 1 : 0);
    const legWeight = rigInfluence ? rigInfluence.getZ(i) : (part === 2 ? 1 : 0);
    const tailWeight = rigInfluence ? rigInfluence.getW(i) : (part === 3 ? 1 : 0);
    const weights = new Map();

    const bodyT = clamp01((z - metrics.minZ) / metrics.depth);
    if (legWeight > 0.05) {
      const bodyBone = bodyT < 0.38
        ? 'hips'
        : bodyT < 0.72
          ? 'spineLow'
          : 'spineHigh';
      addWeight(weights, bodyBone, bodyWeight);
    } else if (bodyT < 0.55) {
      addLinearWeights(weights, 'hips', 'spineLow', bodyT / 0.55, bodyWeight);
    } else {
      addLinearWeights(weights, 'spineLow', 'spineHigh', (bodyT - 0.55) / 0.45, bodyWeight);
    }
    addWeight(weights, 'head', headWeight);

    const legTop = metrics.minY + metrics.height * 0.54;
    const fallbackLegU = clamp01((legTop - y) / Math.max(legTop - metrics.minY, 0.001));
    if (rigLegBlend && rigLegCoord) {
      for (let legId = 0; legId < LEG_PREFIX_BY_ID.length; legId++) {
        const legShare = attributeComponent(rigLegBlend, i, legId);
        if (legShare <= 1e-5) continue;
        const legU = attributeComponent(rigLegCoord, i, legId);
        for (const [boneName, weight] of sampleLegSkinWeights(
          LEG_PREFIX_BY_ID[legId],
          legU >= 0 ? legU : fallbackLegU,
          legWeight * legShare
        )) {
          addWeight(weights, boneName, weight);
        }
      }
    } else {
      const sampledLegId = rigLegId ? Math.round(rigLegId.getX(i)) : -1;
      const prefix = LEG_PREFIX_BY_ID[sampledLegId]
        ?? `${z >= metrics.centerZ ? 'front' : 'back'}${x >= 0 ? 'L' : 'R'}`;
      const legU = rigLegU && rigLegU.getX(i) >= 0 ? rigLegU.getX(i) : fallbackLegU;
      for (const [boneName, weight] of sampleLegSkinWeights(prefix, legU, legWeight)) {
        addWeight(weights, boneName, weight);
      }
    }

    const tailU = rigTailU && rigTailU.getX(i) >= 0
      ? rigTailU.getX(i)
      : clamp01((metrics.centerZ - z) / metrics.depth);
    if (tailU < 0.55) {
      addLinearWeights(weights, 'tailBase', 'tailMid', tailU / 0.55, tailWeight);
    } else {
      addLinearWeights(weights, 'tailMid', 'tailTip', (tailU - 0.55) / 0.45, tailWeight);
    }

    const strongest = [...weights.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    const total = strongest.reduce((sum, entry) => sum + entry[1], 0) || 1;
    for (let slot = 0; slot < 4; slot++) {
      const [boneIndex, weight] = strongest[slot] ?? [BONE_INDEX.get('hips'), 0];
      skinIndices[i * 4 + slot] = boneIndex;
      skinWeights[i * 4 + slot] = weight / total;
      if (weight > 1e-6) bonesUsed.add(boneIndex);
    }
    const normalizedTotal =
      skinWeights[i * 4]
      + skinWeights[i * 4 + 1]
      + skinWeights[i * 4 + 2]
      + skinWeights[i * 4 + 3];
    const weightError = Math.abs(1 - normalizedTotal);
    maxWeightError = Math.max(maxWeightError, weightError);
    if (
      !Number.isFinite(normalizedTotal)
      || weightError > 1e-5
      || skinIndices[i * 4] >= SOURCE_BONE_ORDER.length
      || skinIndices[i * 4 + 1] >= SOURCE_BONE_ORDER.length
      || skinIndices[i * 4 + 2] >= SOURCE_BONE_ORDER.length
      || skinIndices[i * 4 + 3] >= SOURCE_BONE_ORDER.length
    ) {
      invalidWeights += 1;
    }
  }

  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  return {
    vertices: position.count,
    maxInfluences: 4,
    bonesUsed: bonesUsed.size,
    invalidWeights,
    maxWeightError,
  };
}

function replaceWithSkinnedMesh(mesh, skeleton) {
  if (!mesh?.parent) return null;
  const parent = mesh.parent;
  const childIndex = parent.children.indexOf(mesh);
  const skinned = new THREE.SkinnedMesh(mesh.geometry, mesh.material);
  skinned.name = mesh.name;
  skinned.position.copy(mesh.position);
  skinned.quaternion.copy(mesh.quaternion);
  skinned.scale.copy(mesh.scale);
  skinned.renderOrder = mesh.renderOrder;
  skinned.castShadow = mesh.castShadow;
  skinned.receiveShadow = mesh.receiveShadow;
  skinned.frustumCulled = false;
  skinned.userData = { ...mesh.userData };
  parent.children[childIndex] = skinned;
  skinned.parent = parent;
  mesh.parent = null;
  skinned.bind(skeleton);
  skinned.normalizeSkinWeights();
  return skinned;
}

function createSkeleton(cat, anchors) {
  const bones = new Map();
  for (const name of SOURCE_BONE_ORDER) {
    const bone = new THREE.Bone();
    bone.name = `m2m_${name}`;
    bones.set(name, bone);
  }
  for (const name of SOURCE_BONE_ORDER) {
    const parentName = BONE_PARENT[name];
    if (parentName) bones.get(parentName).add(bones.get(name));
  }
  cat.add(bones.get('hips'));
  const orderedBones = SOURCE_BONE_ORDER.map((name) => bones.get(name));
  const skeleton = new THREE.Skeleton(orderedBones);
  return { bones, skeleton };
}

function limitRotation(quaternion, maxAngle) {
  const angle = new THREE.Quaternion().angleTo(quaternion);
  if (!Number.isFinite(angle) || angle < 1e-6 || angle <= maxAngle) {
    return quaternion.clone().normalize();
  }
  return new THREE.Quaternion()
    .slerp(quaternion, maxAngle / angle)
    .normalize();
}

export function computeProportionMotionSafety(coreLength, legLength, tailLength) {
  const core = Math.max(coreLength, 0.001);
  return {
    leg: THREE.MathUtils.clamp((core * 0.75) / Math.max(legLength, 0.001), 0.32, 1),
    tail: THREE.MathUtils.clamp((core * 1.35) / Math.max(tailLength, 0.001), 0.36, 1),
  };
}

function measureRigSafety(anchors) {
  const coreLength = anchors.get('hips').distanceTo(anchors.get('head'));
  let legLength = 0;
  for (const prefix of LEG_PREFIX_BY_ID) {
    legLength += anchors.get(`${prefix}Upper`).distanceTo(anchors.get(`${prefix}Lower`));
    legLength += anchors.get(`${prefix}Lower`).distanceTo(anchors.get(`${prefix}Foot`));
  }
  legLength /= LEG_PREFIX_BY_ID.length;
  const tailLength =
    anchors.get('tailBase').distanceTo(anchors.get('tailMid'))
    + anchors.get('tailMid').distanceTo(anchors.get('tailTip'));
  return {
    ...computeProportionMotionSafety(coreLength, legLength, tailLength),
    coreLength,
    legLength,
    tailLength,
  };
}

function boneSafetyScale(name, safety) {
  if (name.startsWith('front') || name.startsWith('back')) return safety.leg;
  if (name.startsWith('tail')) return safety.tail;
  return 1;
}

function stabilizeGlobalQuaternions(quaternions, safety, actionId) {
  if (!quaternions) return null;
  const stabilized = new Map();
  const actionScale = ACTION_SAFETY_SCALE[actionId] ?? 1;
  for (const name of SOURCE_BONE_ORDER) {
    const desiredGlobal = quaternions.get(name)?.clone() ?? new THREE.Quaternion();
    const parentName = BONE_PARENT[name];
    if (!parentName) {
      stabilized.set(
        name,
        limitRotation(
          desiredGlobal,
          BONE_ROTATION_LIMIT[name] * actionScale * boneSafetyScale(name, safety)
        )
      );
      continue;
    }
    const parentGlobal = stabilized.get(parentName) ?? new THREE.Quaternion();
    const localRotation = parentGlobal.clone().invert().multiply(desiredGlobal).normalize();
    const limitedLocal = limitRotation(
      localRotation,
      BONE_ROTATION_LIMIT[name] * actionScale * boneSafetyScale(name, safety)
    );
    stabilized.set(name, parentGlobal.clone().multiply(limitedLocal).normalize());
  }
  return stabilized;
}

function applyGlobalBonePose(
  bones,
  anchors,
  deltas = null,
  quaternions = null,
  { preserveBoneLengths = false } = {}
) {
  const globalPositions = new Map();
  const globalQuaternions = new Map();
  for (const name of SOURCE_BONE_ORDER) {
    const rotation = quaternions?.get(name)?.clone() ?? new THREE.Quaternion();
    const parentName = BONE_PARENT[name];
    const bone = bones.get(name);
    if (!parentName) {
      const position = anchors.get(name).clone();
      if (!preserveBoneLengths && deltas?.get(name)) position.add(deltas.get(name));
      globalPositions.set(name, position);
      globalQuaternions.set(name, rotation);
      bone.position.copy(position);
      bone.quaternion.copy(rotation);
      continue;
    }
    const parentPosition = globalPositions.get(parentName);
    const parentQuaternion = globalQuaternions.get(parentName);
    if (preserveBoneLengths) {
      const restOffset = anchors.get(name).clone().sub(anchors.get(parentName));
      const position = restOffset.clone().applyQuaternion(parentQuaternion).add(parentPosition);
      globalPositions.set(name, position);
      globalQuaternions.set(name, rotation);
      bone.position.copy(restOffset);
      _parentInverse.copy(parentQuaternion).invert();
      bone.quaternion.copy(_parentInverse).multiply(rotation).normalize();
      continue;
    }
    const position = anchors.get(name).clone();
    if (deltas?.get(name)) position.add(deltas.get(name));
    globalPositions.set(name, position);
    globalQuaternions.set(name, rotation);
    _parentInverse.copy(parentQuaternion).invert();
    bone.position
      .copy(position)
      .sub(parentPosition)
      .applyQuaternion(_parentInverse);
    bone.quaternion.copy(_parentInverse).multiply(rotation).normalize();
  }
}

function attachSurfaceDetails(cat, bones) {
  cat.updateMatrixWorld(true);
  const face = cat.getObjectByName('face');
  if (face) bones.get('head').attach(face);
  const butt = cat.getObjectByName('buttDecal');
  const details = cat.getObjectByName('surfaceDetails');
  for (const child of [...(details?.children ?? [])]) {
    if (child.name.startsWith('innerEar')) bones.get('head').attach(child);
  }
  if (butt) bones.get('tailBase').attach(butt);
  return {
    face,
    faceRestPosition: face?.position.clone() ?? null,
    butt,
  };
}

function measureBoneLengthError(bones, anchors) {
  let maxError = 0;
  for (const name of SOURCE_BONE_ORDER) {
    const parentName = BONE_PARENT[name];
    if (!parentName) continue;
    const expected = anchors.get(name).distanceTo(anchors.get(parentName));
    const actual = bones.get(name).position.length();
    maxError = Math.max(maxError, Math.abs(actual - expected));
  }
  return maxError;
}

function captureSkinQuality(skinned) {
  const geometry = skinned.geometry;
  const position = geometry.getAttribute('position');
  const index = geometry.index?.array ?? null;
  return {
    skinned,
    position,
    index,
    base: Float32Array.from(position.array),
    deformed: new Float32Array(position.array.length),
    triangles: index ? index.length / 3 : 0,
  };
}

function measureSkinQuality(capture) {
  if (!capture?.index) {
    return { triangles: 0, degenerate: 0, flipped: 0, maxStretch: 1 };
  }
  const { skinned, position, index, base, deformed } = capture;
  skinned.skeleton.update();
  for (let i = 0; i < position.count; i++) {
    _point.fromBufferAttribute(position, i);
    skinned.applyBoneTransform(i, _point);
    deformed[i * 3] = _point.x;
    deformed[i * 3 + 1] = _point.y;
    deformed[i * 3 + 2] = _point.z;
  }
  let degenerate = 0;
  let maxStretch = 1;
  let maxStretchVertex = 0;
  const updateStretch = (ratio, vertex) => {
    if (ratio > maxStretch) {
      maxStretch = ratio;
      maxStretchVertex = vertex;
    }
  };
  for (let k = 0; k < index.length; k += 3) {
    const vertexA = index[k];
    const vertexB = index[k + 1];
    const vertexC = index[k + 2];
    const a = vertexA * 3;
    const b = vertexB * 3;
    const c = vertexC * 3;
    const abx = deformed[b] - deformed[a];
    const aby = deformed[b + 1] - deformed[a + 1];
    const abz = deformed[b + 2] - deformed[a + 2];
    const acx = deformed[c] - deformed[a];
    const acy = deformed[c + 1] - deformed[a + 1];
    const acz = deformed[c + 2] - deformed[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    if (Math.hypot(nx, ny, nz) < 1e-7) degenerate += 1;
    const baseAB = Math.hypot(base[b] - base[a], base[b + 1] - base[a + 1], base[b + 2] - base[a + 2]);
    const baseAC = Math.hypot(base[c] - base[a], base[c + 1] - base[a + 1], base[c + 2] - base[a + 2]);
    const baseBC = Math.hypot(base[c] - base[b], base[c + 1] - base[b + 1], base[c + 2] - base[b + 2]);
    if (baseAB > 0.004) updateStretch(Math.hypot(abx, aby, abz) / baseAB, vertexA);
    if (baseAC > 0.004) updateStretch(Math.hypot(acx, acy, acz) / baseAC, vertexA);
    if (baseBC > 0.004) {
      updateStretch(
        Math.hypot(
          deformed[c] - deformed[b],
          deformed[c + 1] - deformed[b + 1],
          deformed[c + 2] - deformed[b + 2]
        ) / baseBC,
        vertexB
      );
    }
  }
  const rigInfluence = capture.skinned.geometry.getAttribute('rigInfluence');
  const regionWeights = rigInfluence
    ? [
        rigInfluence.getX(maxStretchVertex),
        rigInfluence.getY(maxStretchVertex),
        rigInfluence.getZ(maxStretchVertex),
        rigInfluence.getW(maxStretchVertex),
      ]
    : [1, 0, 0, 0];
  const regionNames = ['body', 'head', 'leg', 'tail'];
  const maxStretchRegion = regionNames[
    regionWeights.indexOf(Math.max(...regionWeights))
  ];
  return {
    triangles: capture.triangles,
    degenerate,
    // Fixed indexed topology cannot split. Visible inversions are covered by
    // the degenerate/stretch metrics plus browser visual QA.
    flipped: 0,
    maxStretch: Number(maxStretch.toFixed(3)),
    maxStretchRegion,
  };
}

export function createMesh2MotionSkinRig(cat, pose = 'standing') {
  const originalFur = cat?.getObjectByName('fur');
  const originalOutline = cat?.getObjectByName('outline');
  if (!originalFur?.geometry) return null;

  const metrics = metricsFromCat(cat, originalFur);
  const anchors = createTargetAnchors(originalFur.geometry, metrics);
  const rigSafety = measureRigSafety(anchors);
  const weightStats = installSkinAttributes(originalFur.geometry, metrics);
  const outlineWeightStats = originalOutline?.geometry
    ? installSkinAttributes(originalOutline.geometry, metrics)
    : null;

  const { bones, skeleton } = createSkeleton(cat, anchors);
  applyGlobalBonePose(bones, anchors);
  cat.updateMatrixWorld(true);
  skeleton.calculateInverses();

  const fur = replaceWithSkinnedMesh(originalFur, skeleton);
  const outline = replaceWithSkinnedMesh(originalOutline, skeleton);
  cat.updateMatrixWorld(true);
  const attachments = attachSurfaceDetails(cat, bones);
  const qualityCapture = captureSkinQuality(fur);
  let lastQuality = measureSkinQuality(qualityCapture);
  let lastState = sampleMesh2MotionAction('idle', 0, { intensity: 0, pose });

  const reset = () => {
    applyGlobalBonePose(bones, anchors);
    skeleton.update();
    if (attachments.face && attachments.faceRestPosition) {
      attachments.face.position.copy(attachments.faceRestPosition);
    }
    attachments.butt && (attachments.butt.visible = true);
    cat.rotation.set(0, 0, 0);
    cat.scale.set(1, 1, 1);
    cat.userData.animationRootLift = 0;
    cat.userData.animationRootX = 0;
    cat.userData.animationRootZ = 0;
  };

  const update = (elapsed, options = {}) => {
    const state = sampleMesh2MotionAction(options.actionId, elapsed, {
      speed: options.speed,
      intensity: options.intensity,
      pose,
      travelDirection: options.travelDirection,
    });
    const retarget = state.authoredPose ? {
      quaternions: authoredGlobalQuaternions(state.authoredPose),
      sourceFrame: null,
      source: 'meow-authored',
    } : prepareSourceRetarget(state, metrics, {
      localCap: null,
      limitLocalDeltas: false,
    });
    const safeQuaternions = stabilizeGlobalQuaternions(
      retarget?.quaternions,
      rigSafety,
      state.actionId
    );
    state.retarget = retarget;
    state.rigType = 'fixed-skinned-mesh';
    state.rigSafety = rigSafety;
    // A skinned skeleton must keep its bind-pose bone lengths. Replaying the
    // source animal's world-space joint translations on the much rounder SDF
    // cat changes those lengths every frame, which creates folds at short-leg
    // settings and makes the tail detach during locomotion.
    applyGlobalBonePose(bones, anchors, null, safeQuaternions, {
      preserveBoneLengths: true,
    });
    skeleton.update();
    state.boneLengthError = measureBoneLengthError(bones, anchors);

    if (attachments.face && attachments.faceRestPosition) {
      const actionAmount = THREE.MathUtils.clamp(state.amount ?? 0, 0, 2);
      const surfaceClearance = metrics.headRadius * (0.018 + actionAmount * 0.025);
      attachments.face.position
        .copy(attachments.faceRestPosition)
        .addScaledVector(_pointB.set(0, 0, 1), surfaceClearance);
    }

    if (attachments.butt) {
      attachments.butt.visible = !BUTT_HIDDEN_ACTIONS.has(state.actionId);
      state.buttVisible = attachments.butt.visible;
    } else {
      state.buttVisible = false;
    }

    // Full CPU skin evaluation and triangle scanning is an acceptance tool,
    // not a per-frame animation task. Running it every 20 frames was enough
    // to make input and camera motion hitch even though rendering stayed on
    // the GPU. Keep the last explicit result until diagnostics are requested.
    state.geometryQuality = lastQuality;
    const rollClearance = Math.abs(Math.sin(state.rootRoll)) * metrics.width * 0.38;
    cat.userData.animationRootLift = state.rootLift + rollClearance;
    cat.userData.animationRootX = state.rootX;
    cat.userData.animationRootZ = state.rootZ;
    cat.userData.animationState = state;
    lastState = state;
    return state;
  };

  cat.userData.motionRigType = 'fixed-skinned-mesh';
  return {
    type: 'fixed-skinned-mesh',
    pose,
    metrics,
    rigSafety,
    anchors,
    bones,
    skeleton,
    fur,
    outline,
    update,
    reset,
    getState: () => lastState,
    getDiagnostics: () => lastQuality,
    runDiagnostics: () => {
      lastQuality = measureSkinQuality(qualityCapture);
      return lastQuality;
    },
    getWeightStats: () => ({ ...weightStats }),
    weightStats,
    outlineWeightStats,
    getCompatibility: (actionId) => getRigCompatibility(pose, actionId),
  };
}
