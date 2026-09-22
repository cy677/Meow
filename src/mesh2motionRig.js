import * as THREE from 'three';
import {
  getRestBone,
  getSourceBone,
  restGroundHeight,
  sampleMesh2MotionSource,
  sourceGroundHeight,
} from './mesh2motionSource.js';

// Source timing is read from the 14 CC0 fox/cat action .blend files.
// The procedural cat cannot reuse the source skin weights, so these clips are
// retargeted as body-region controls that survive every SDF remesh.
import { SOURCE_CLIPS, CAT_MOTION_CLIPS } from './catMotion/clipCatalog.js';
import { sampleAuthoredPose } from './catMotion/authoredPoses.js';
export const MESH2MOTION_ACTIONS = SOURCE_CLIPS;

const ACTION_BY_ID = new Map(CAT_MOTION_CLIPS.map((action) => [action.id, action]));

const POSE_COMPATIBILITY = {
  standing: { grade: 'full', scale: 1, label: '完整四足绑定' },
  loaf: { grade: 'adapted', scale: 0.78, label: '团坐表面绑定' },
  stretch: { grade: 'adapted', scale: 0.78, label: '伸展四足绑定' },
  slouchSit: { grade: 'adapted', scale: 0.68, label: '坐姿表面绑定' },
  sleeping: { grade: 'expressive', scale: 0.5, label: '卧姿表情绑定' },
  biped: { grade: 'expressive', scale: 0.48, label: '双足表情绑定' },
  sideFlat: { grade: 'expressive', scale: 0.45, label: '侧卧表情绑定' },
  maxwellBlock: { grade: 'expressive', scale: 0.42, label: '方块表情绑定' },
  banana: { grade: 'expressive', scale: 0.38, label: '香蕉外壳安全绑定' },
  twistedMelt: { grade: 'expressive', scale: 0.36, label: '扭结轮廓安全绑定' },
};

const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);
const smooth01 = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const pulse = (phase, power = 2) => Math.pow(Math.max(0, Math.sin(phase)), power);

export function getRigCompatibility(pose = 'standing', actionId = 'idle') {
  const base = POSE_COMPATIBILITY[pose] ?? POSE_COMPATIBILITY.loaf;
  const action = ACTION_BY_ID.get(actionId) ?? ACTION_BY_ID.get('idle');
  let scale = base.scale;
  let label = base.label;
  if (action.family === 'locomotion' && base.grade === 'expressive') {
    scale *= 0.58;
    label += '（步态降级为原地表演）';
  }
  if (action.family === 'collapse' && pose === 'banana') {
    scale *= 0.72;
    label += '（保护香蕉外壳）';
  }
  return { ...base, scale, label, actionFamily: action.family };
}

function blankState(action, phase, progress) {
  return {
    actionId: action.id,
    sourceName: action.sourceName,
    phase,
    progress,
    rootLift: 0,
    rootPitch: 0,
    rootYaw: 0,
    rootRoll: 0,
    rootX: 0,
    rootZ: 0,
    squash: 0,
    crouch: 0,
    bodyWave: 0,
    headLift: 0,
    headX: 0,
    headThrust: 0,
    headYaw: 0,
    gaitAmplitude: 0,
    stride: 0,
    tailSway: 0,
  };
}

export function sampleMesh2MotionAction(
  actionId,
  elapsed,
  { speed = 1, intensity = 1, pose = 'standing', travelDirection = 1 } = {}
) {
  const action = ACTION_BY_ID.get(actionId) ?? ACTION_BY_ID.get('idle');
  const safeSpeed = THREE.MathUtils.clamp(Number(speed) || 1, 0.1, 3);
  const safeIntensity = THREE.MathUtils.clamp(Number(intensity) || 0, 0, 2);
  const compatibility = getRigCompatibility(pose, action.id);
  const amount = safeIntensity * compatibility.scale;
  const activeTime = Math.max(0, Number(elapsed) || 0) * safeSpeed;
  const hold = action.loop ? 0 : Math.max(0.32, action.duration * 0.28);
  const cycle = action.duration + hold;
  const localTime = activeTime % cycle;
  const progress = action.loop
    ? (localTime / action.duration) % 1
    : clamp01(localTime / action.duration);
  const phase = progress * Math.PI * 2;
  const state = blankState(action, phase, progress);
  state.travelDirection = travelDirection < 0 ? -1 : 1;
  const pingPong = 0.5 - 0.5 * Math.cos(phase);

  if (action.source === 'meow-authored') {
    const authored = sampleAuthoredPose(action.id, progress, amount);
    Object.assign(state, authored.root, {authoredPose:authored, sourceExact:false,
      source:'meow-authored', compatibility, amount, sourcePose:null});
    return state;
  }

  switch (action.id) {
    case 'idle':
      state.rootLift = (0.008 + Math.sin(phase) * 0.006) * amount;
      state.squash = (0.012 + Math.sin(phase) * 0.008) * amount;
      state.headYaw = Math.sin(phase * 0.5) * 0.018 * amount;
      state.tailSway = 0.035 * amount;
      break;
    case 'idle-alert':
      state.rootLift = (0.014 + Math.sin(phase * 2) * 0.008) * amount;
      state.headLift = (0.035 + Math.sin(phase) * 0.012) * amount;
      state.headX = Math.sin(phase * 0.5) * 0.022 * amount;
      state.headYaw = Math.sin(phase * 0.5) * 0.04 * amount;
      state.tailSway = 0.055 * amount;
      break;
    case 'walk':
      state.rootLift = (0.018 + Math.abs(Math.sin(phase)) * 0.024) * amount;
      state.rootPitch = Math.sin(phase * 2) * 0.018 * amount;
      state.bodyWave = Math.sin(phase) * 0.026 * amount;
      state.gaitAmplitude = 0.105 * amount;
      state.stride = 0.072 * amount;
      state.tailSway = 0.065 * amount;
      break;
    case 'run':
      state.rootLift = (0.035 + Math.abs(Math.sin(phase)) * 0.075) * amount;
      state.rootPitch = Math.sin(phase * 2) * 0.045 * amount;
      state.bodyWave = Math.sin(phase * 2) * 0.05 * amount;
      state.squash = Math.max(0, Math.sin(phase * 2)) * 0.06 * amount;
      state.gaitAmplitude = 0.19 * amount;
      state.stride = 0.14 * amount;
      state.tailSway = 0.105 * amount;
      break;
    case 'sneak':
      state.rootLift = 0.012 * amount;
      state.crouch = (0.07 + Math.sin(phase * 2) * 0.012) * amount;
      state.headLift = -0.024 * amount;
      state.bodyWave = Math.sin(phase) * 0.018 * amount;
      state.gaitAmplitude = 0.072 * amount;
      state.stride = 0.052 * amount;
      state.tailSway = 0.035 * amount;
      break;
    case 'jump': {
      const air = Math.sin(progress * Math.PI);
      const takeoff = smooth01(progress / 0.2);
      const landing = smooth01((progress - 0.72) / 0.28);
      state.rootLift = Math.max(0, air) * 0.62 * amount;
      state.crouch = ((1 - takeoff) * 0.12 + landing * 0.1) * amount;
      state.rootPitch = Math.sin(progress * Math.PI) * -0.075 * amount;
      state.squash = ((1 - takeoff) * 0.08 + landing * 0.11) * amount;
      state.gaitAmplitude = Math.max(0, air) * 0.08 * amount;
      state.headLift = Math.max(0, air) * 0.035 * amount;
      state.tailSway = 0.08 * amount;
      break;
    }
    case 'fall': {
      const landing = smooth01((progress - 0.68) / 0.32);
      state.rootLift = Math.max(0, (1 - progress) * 0.48) * amount;
      state.rootPitch = Math.sin(progress * Math.PI) * 0.13 * amount;
      state.rootRoll = Math.sin(progress * Math.PI) * 0.08 * amount;
      state.squash = landing * 0.14 * amount;
      state.crouch = landing * 0.1 * amount;
      state.gaitAmplitude = (1 - landing) * 0.06 * amount;
      break;
    }
    case 'sit':
      state.crouch = pingPong * 0.17 * amount;
      state.rootPitch = pingPong * -0.055 * amount;
      state.headLift = pingPong * 0.038 * amount;
      state.tailSway = 0.025 * amount;
      break;
    case 'rest-pose':
      state.rootLift = (0.004 + Math.sin(phase) * 0.003) * amount;
      state.crouch = 0.025 * amount;
      state.squash = (0.009 + Math.sin(phase) * 0.006) * amount;
      state.tailSway = 0.015 * amount;
      break;
    case 'bark': {
      const accent = pulse(phase * 3, 5);
      state.rootLift = accent * 0.055 * amount;
      state.rootPitch = -accent * 0.065 * amount;
      state.headLift = accent * 0.055 * amount;
      state.headThrust = accent * 0.075 * amount;
      state.squash = accent * 0.035 * amount;
      state.tailSway = 0.05 * amount;
      break;
    }
    case 'bite': {
      const accent = pulse(phase, 4);
      state.rootZ = accent * 0.035 * amount;
      state.rootPitch = accent * 0.055 * amount;
      state.headThrust = accent * 0.16 * amount;
      state.headLift = -accent * 0.035 * amount;
      state.crouch = accent * 0.04 * amount;
      break;
    }
    case 'fetch': {
      const hop = pulse(phase, 2);
      const bow = pulse(phase + Math.PI * 0.55, 3);
      state.rootLift = hop * 0.2 * amount;
      state.rootPitch = (bow * 0.1 - hop * 0.06) * amount;
      state.crouch = bow * 0.08 * amount;
      state.headLift = (hop * 0.06 - bow * 0.06) * amount;
      state.headThrust = bow * 0.08 * amount;
      state.gaitAmplitude = hop * 0.09 * amount;
      state.tailSway = 0.12 * amount;
      break;
    }
    case 'howl':
      state.rootLift = (0.018 + Math.sin(phase) * 0.01) * amount;
      state.rootPitch = -0.055 * amount;
      state.headLift = (0.075 + Math.sin(phase * 2) * 0.018) * amount;
      state.headThrust = -0.035 * amount;
      state.squash = (0.02 + Math.sin(phase) * 0.012) * amount;
      state.tailSway = 0.045 * amount;
      break;
    case 'death': {
      const collapse = smooth01(progress / 0.72);
      state.rootRoll = collapse * 0.92 * amount;
      state.rootPitch = collapse * 0.1 * amount;
      state.rootX = collapse * 0.16 * amount;
      state.rootLift = Math.sin(collapse * Math.PI) * 0.12 * amount;
      state.crouch = collapse * 0.12 * amount;
      state.squash = collapse * 0.1 * amount;
      state.headLift = -collapse * 0.055 * amount;
      state.tailSway = (1 - collapse) * 0.04 * amount;
      break;
    }
    default:
      break;
  }

  state.compatibility = compatibility;
  state.amount = amount;
  state.sourcePose = sampleMesh2MotionSource(action.id, progress);
  state.sourceExact = true;
  return state;
}

export function sampleGaitFoot(
  phase,
  gaitAmplitude,
  stride,
  phaseOffset = 0,
  travelDirection = 1
) {
  const footPhase = phase + phaseOffset;
  return {
    lift: Math.max(0, Math.sin(footPhase)) * gaitAmplitude,
    // 抬脚半周从后摆到前，落地半周从前向后推地。旧方向正好相反。
    forward: -Math.cos(footPhase) * stride * (travelDirection < 0 ? -1 : 1),
  };
}

function captureGeometry(mesh) {
  if (!mesh?.geometry) return null;
  const position = mesh.geometry.getAttribute('position');
  if (!position) return null;
  const rigPart = mesh.geometry.getAttribute('rigPart');
  const rigInfluence = mesh.geometry.getAttribute('rigInfluence');
  const rigTailU = mesh.geometry.getAttribute('rigTailU');
  mesh.geometry.computeBoundingSphere();
  if (mesh.geometry.boundingSphere) mesh.geometry.boundingSphere.radius *= 1.9;
  mesh.geometry.computeBoundingBox();
  mesh.geometry.boundingBox?.expandByScalar(0.35);
  const index = mesh.geometry.index?.array ?? null;
  const baseFaceNormals = index ? new Float32Array(index.length) : null;
  const baseEdgeLengths = index ? new Float32Array(index.length) : null;
  if (index) {
    for (let k = 0; k < index.length; k += 3) {
      const ia = index[k] * 3;
      const ib = index[k + 1] * 3;
      const ic = index[k + 2] * 3;
      const abx = position.array[ib] - position.array[ia];
      const aby = position.array[ib + 1] - position.array[ia + 1];
      const abz = position.array[ib + 2] - position.array[ia + 2];
      const acx = position.array[ic] - position.array[ia];
      const acy = position.array[ic + 1] - position.array[ia + 1];
      const acz = position.array[ic + 2] - position.array[ia + 2];
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      const normalLength = Math.hypot(nx, ny, nz);
      if (normalLength >= 1e-6) {
        baseFaceNormals[k] = nx / normalLength;
        baseFaceNormals[k + 1] = ny / normalLength;
        baseFaceNormals[k + 2] = nz / normalLength;
      }
      baseEdgeLengths[k] = Math.max(Math.hypot(abx, aby, abz), 1e-6);
      baseEdgeLengths[k + 1] = Math.max(Math.hypot(acx, acy, acz), 1e-6);
      baseEdgeLengths[k + 2] = Math.max(
        Math.hypot(
          position.array[ic] - position.array[ib],
          position.array[ic + 1] - position.array[ib + 1],
          position.array[ic + 2] - position.array[ib + 2]
        ),
        1e-6
      );
    }
  }
  return {
    mesh,
    position,
    base: Float32Array.from(position.array),
    parts: rigPart ? Float32Array.from(rigPart.array) : null,
    influences: rigInfluence ? Float32Array.from(rigInfluence.array) : null,
    tailU: rigTailU ? Float32Array.from(rigTailU.array) : null,
    index,
    baseFaceNormals,
    baseEdgeLengths,
    displacementScratch: new Float32Array(position.count * 3),
    neighborScratch: new Float32Array(position.count * 3),
    neighborCounts: new Uint16Array(position.count),
  };
}

function setGeometryToBase(capture) {
  if (!capture) return;
  capture.position.array.set(capture.base);
  capture.position.needsUpdate = true;
  capture.mesh.geometry.computeVertexNormals();
}

function measureDeformationQuality(capture) {
  const { position, index, baseFaceNormals, baseEdgeLengths } = capture ?? {};
  if (!position || !index || !baseFaceNormals || !baseEdgeLengths) {
    return { triangles: 0, degenerate: 0, flipped: 0, maxStretch: 1 };
  }
  let degenerate = 0;
  let flipped = 0;
  let maxStretch = 1;
  for (let k = 0; k < index.length; k += 3) {
    const ia = index[k];
    const ib = index[k + 1];
    const ic = index[k + 2];
    const ax = position.getX(ia);
    const ay = position.getY(ia);
    const az = position.getZ(ia);
    const bx = position.getX(ib);
    const by = position.getY(ib);
    const bz = position.getZ(ib);
    const cx = position.getX(ic);
    const cy = position.getY(ic);
    const cz = position.getZ(ic);
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const normalLength = Math.hypot(nx, ny, nz);
    if (normalLength < 1e-7) {
      degenerate += 1;
    } else {
      const baseNormalLength = Math.hypot(
        baseFaceNormals[k],
        baseFaceNormals[k + 1],
        baseFaceNormals[k + 2]
      );
      if (baseNormalLength > 0.5) {
        const alignment = (
          nx * baseFaceNormals[k] +
          ny * baseFaceNormals[k + 1] +
          nz * baseFaceNormals[k + 2]
        ) / normalLength;
        if (alignment < -0.02) flipped += 1;
      }
    }
    if (baseEdgeLengths[k] > 0.004) {
      maxStretch = Math.max(maxStretch, Math.hypot(abx, aby, abz) / baseEdgeLengths[k]);
    }
    if (baseEdgeLengths[k + 1] > 0.004) {
      maxStretch = Math.max(maxStretch, Math.hypot(acx, acy, acz) / baseEdgeLengths[k + 1]);
    }
    if (baseEdgeLengths[k + 2] > 0.004) {
      maxStretch = Math.max(
        maxStretch,
        Math.hypot(cx - bx, cy - by, cz - bz) / baseEdgeLengths[k + 2]
      );
    }
  }
  return {
    triangles: index.length / 3,
    degenerate,
    flipped,
    maxStretch: Number(maxStretch.toFixed(3)),
  };
}

function regularizeDeformation(capture, strength = 0.34) {
  const {
    position,
    base,
    index,
    displacementScratch,
    neighborScratch,
    neighborCounts,
  } = capture ?? {};
  if (!position || !index || !displacementScratch || !neighborScratch || !neighborCounts) return;
  neighborScratch.fill(0);
  neighborCounts.fill(0);
  for (let i = 0; i < position.count; i++) {
    const offset = i * 3;
    displacementScratch[offset] = position.getX(i) - base[offset];
    displacementScratch[offset + 1] = position.getY(i) - base[offset + 1];
    displacementScratch[offset + 2] = position.getZ(i) - base[offset + 2];
  }
  const addNeighbor = (vertex, neighbor) => {
    const vertexOffset = vertex * 3;
    const neighborOffset = neighbor * 3;
    neighborScratch[vertexOffset] += displacementScratch[neighborOffset];
    neighborScratch[vertexOffset + 1] += displacementScratch[neighborOffset + 1];
    neighborScratch[vertexOffset + 2] += displacementScratch[neighborOffset + 2];
    neighborCounts[vertex] += 1;
  };
  for (let k = 0; k < index.length; k += 3) {
    const a = index[k];
    const b = index[k + 1];
    const c = index[k + 2];
    addNeighbor(a, b);
    addNeighbor(a, c);
    addNeighbor(b, a);
    addNeighbor(b, c);
    addNeighbor(c, a);
    addNeighbor(c, b);
  }
  for (let i = 0; i < position.count; i++) {
    const offset = i * 3;
    const count = Math.max(1, neighborCounts[i]);
    const ownX = displacementScratch[offset];
    const ownY = displacementScratch[offset + 1];
    const ownZ = displacementScratch[offset + 2];
    const averageX = neighborScratch[offset] / count;
    const averageY = neighborScratch[offset + 1] / count;
    const averageZ = neighborScratch[offset + 2] / count;
    position.setXYZ(
      i,
      base[offset] + THREE.MathUtils.lerp(ownX, averageX, strength),
      base[offset + 1] + THREE.MathUtils.lerp(ownY, averageY, strength),
      base[offset + 2] + THREE.MathUtils.lerp(ownZ, averageZ, strength)
    );
  }
}

const SOURCE_RETARGET_BONES = [
  'hips',
  'spineLow',
  'spineHigh',
  'head',
  'frontLUpper',
  'frontLLower',
  'frontLFoot',
  'frontRUpper',
  'frontRLower',
  'frontRFoot',
  'backLUpper',
  'backLLower',
  'backLFoot',
  'backRUpper',
  'backRLower',
  'backRFoot',
  'tailBase',
  'tailMid',
  'tailTip',
];
const SOURCE_TO_TARGET_BASIS = new THREE.Quaternion()
  .setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const SOURCE_TO_TARGET_BASIS_INVERSE = SOURCE_TO_TARGET_BASIS.clone().invert();
const IDENTITY_QUATERNION = new THREE.Quaternion();
const _sourcePosition = new THREE.Vector3();
const _sourceRestPosition = new THREE.Vector3();
const _sourceHips = new THREE.Vector3();
const _sourceRestHips = new THREE.Vector3();
const _sourceRelative = new THREE.Vector3();
const _sourceRestRelative = new THREE.Vector3();
const _sourceQuaternion = new THREE.Quaternion();
const _sourceRestQuaternion = new THREE.Quaternion();
const _sourceRootQuaternion = new THREE.Quaternion();
const _sourceRootInverse = new THREE.Quaternion();
const _targetQuaternion = new THREE.Quaternion();
const _retargetPoint = new THREE.Vector3();
const _retargetPointB = new THREE.Vector3();
const _bodyCandidate = new THREE.Vector3();
const _headCandidate = new THREE.Vector3();
const _legCandidate = new THREE.Vector3();
const _tailCandidate = new THREE.Vector3();
const _buttBodyDelta = new THREE.Vector3();
const _buttTailDelta = new THREE.Vector3();
const BUTT_HIDDEN_ACTIONS = new Set(['fall', 'rest-pose', 'death']);

function softLimit(value, limit) {
  if (limit <= 0) return 0;
  return Math.tanh(value / limit) * limit;
}

function limitDelta(delta, metrics, kind = 'body') {
  const multiplier = kind === 'leg'
    ? { x: 0.24, y: 0.32, z: 0.28 }
    : kind === 'tail'
      ? { x: 0.34, y: 0.34, z: 0.38 }
      : kind === 'head'
        ? { x: 0.26, y: 0.28, z: 0.26 }
        : { x: 0.2, y: 0.24, z: 0.22 };
  delta.set(
    softLimit(delta.x, metrics.width * multiplier.x),
    softLimit(delta.y, metrics.height * multiplier.y),
    softLimit(delta.z, metrics.depth * multiplier.z)
  );
  return delta;
}

function limitQuaternion(source, maxAngle = Math.PI * 0.34) {
  const angle = IDENTITY_QUATERNION.angleTo(source);
  if (angle <= maxAngle || angle < 1e-6) return source;
  return IDENTITY_QUATERNION.clone().slerp(source, maxAngle / angle).normalize();
}

function mapSourceQuaternion(sourceQuaternion, target = new THREE.Quaternion()) {
  return target
    .copy(SOURCE_TO_TARGET_BASIS)
    .multiply(sourceQuaternion)
    .multiply(SOURCE_TO_TARGET_BASIS_INVERSE)
    .normalize();
}

export function prepareSourceRetarget(
  state,
  metrics,
  { localCap = 0.12, limitLocalDeltas = true } = {}
) {
  const source = state.sourcePose;
  if (!source) return null;

  getSourceBone(source, 'hips', _sourceHips, _sourceQuaternion);
  getRestBone('hips', _sourceRestHips, _sourceRestQuaternion);
  _sourceRootQuaternion
    .copy(_sourceQuaternion)
    .multiply(_sourceRestQuaternion.clone().invert())
    .normalize();
  _sourceRootInverse.copy(_sourceRootQuaternion).invert();

  const amount = THREE.MathUtils.clamp(state.amount, 0, 2);
  // Preserve the source clip's whole-body motion, but cap local deformation.
  // The Mesh2Motion source has much longer, thinner limbs than this round SDF
  // cat; applying its local offsets at 1:1 inevitably folds the surface.
  const localAmount = localCap == null ? amount : Math.min(amount, localCap);
  const rootQuaternion = mapSourceQuaternion(_sourceRootQuaternion, new THREE.Quaternion());
  rootQuaternion.slerp(IDENTITY_QUATERNION, 1 - Math.min(1, amount));
  const rootEuler = new THREE.Euler().setFromQuaternion(rootQuaternion, 'XYZ');
  state.rootPitch = rootEuler.x;
  state.rootYaw = rootEuler.y;
  state.rootRoll = rootEuler.z;

  const currentGround = sourceGroundHeight(source);
  const referenceGround = restGroundHeight();
  const stanceDelta = (
    (_sourceHips.z - currentGround)
    - (_sourceRestHips.z - referenceGround)
  );
  const xScale = metrics.width / 0.92;
  const yScale = metrics.height / 1.72;
  const zScale = metrics.depth / 1.86;

  state.rootX = (_sourceHips.x - _sourceRestHips.x) * xScale * amount;
  state.rootZ = -(_sourceHips.y - _sourceRestHips.y) * zScale * amount;
  state.rootLift = Math.max(0, currentGround - referenceGround) * yScale * amount;

  const deltas = new Map();
  const quaternions = new Map();
  for (const boneName of SOURCE_RETARGET_BONES) {
    getSourceBone(source, boneName, _sourcePosition, _sourceQuaternion);
    getRestBone(boneName, _sourceRestPosition, _sourceRestQuaternion);

    _sourceRelative
      .copy(_sourcePosition)
      .sub(_sourceHips)
      .applyQuaternion(_sourceRootInverse);
    _sourceRestRelative.copy(_sourceRestPosition).sub(_sourceRestHips);
    _sourceRelative.sub(_sourceRestRelative);
    const delta = new THREE.Vector3(
      _sourceRelative.x * xScale * localAmount,
      (_sourceRelative.z + stanceDelta) * yScale * localAmount,
      -_sourceRelative.y * zScale * localAmount
    );
    const deltaKind = boneName === 'head'
      ? 'head'
      : boneName.startsWith('tail')
        ? 'tail'
        : boneName.includes('front') || boneName.includes('back')
          ? 'leg'
          : 'body';
    deltas.set(
      boneName,
      limitLocalDeltas ? limitDelta(delta, metrics, deltaKind) : delta
    );

    _targetQuaternion
      .copy(_sourceQuaternion)
      .multiply(_sourceRestQuaternion.clone().invert())
      .premultiply(_sourceRootInverse)
      .normalize();
    const mapped = mapSourceQuaternion(_targetQuaternion, new THREE.Quaternion());
    mapped.slerp(IDENTITY_QUATERNION, 1 - localAmount);
    quaternions.set(
      boneName,
      limitLocalDeltas && boneName === 'head' ? limitQuaternion(mapped) : mapped
    );
  }

  return {
    deltas,
    quaternions,
    rootQuaternion,
    headQuaternion: quaternions.get('head') ?? new THREE.Quaternion(),
    headDelta: deltas.get('head') ?? new THREE.Vector3(),
    sourceFrame: source.frame,
  };
}

function lerpDelta(deltas, from, to, mix, target) {
  return target
    .copy(deltas.get(from) ?? _retargetPointB.set(0, 0, 0))
    .lerp(deltas.get(to) ?? _retargetPointB.set(0, 0, 0), mix);
}

function sourceBodyDelta(retarget, z, metrics, target) {
  const t = clamp01((z - metrics.minZ) / Math.max(metrics.depth, 0.001));
  if (t < 0.55) {
    return lerpDelta(retarget.deltas, 'hips', 'spineLow', t / 0.55, target);
  }
  return lerpDelta(retarget.deltas, 'spineLow', 'spineHigh', (t - 0.55) / 0.45, target);
}

function sourceLegDelta(retarget, x, y, z, metrics, target) {
  const side = x >= 0 ? 'L' : 'R';
  const end = z >= metrics.centerZ ? 'front' : 'back';
  const prefix = `${end}${side}`;
  const top = metrics.minY + metrics.height * 0.54;
  const down = clamp01((top - y) / Math.max(top - metrics.minY, 0.001));
  if (down < 0.46) {
    return lerpDelta(
      retarget.deltas,
      `${prefix}Upper`,
      `${prefix}Lower`,
      down / 0.46,
      target
    );
  }
  return lerpDelta(
    retarget.deltas,
    `${prefix}Lower`,
    `${prefix}Foot`,
    (down - 0.46) / 0.54,
    target
  );
}

function sourceTailDelta(retarget, u, target) {
  if (u < 0.55) {
    return lerpDelta(retarget.deltas, 'tailBase', 'tailMid', u / 0.55, target);
  }
  return lerpDelta(retarget.deltas, 'tailMid', 'tailTip', (u - 0.55) / 0.45, target);
}

function deformGeometry(capture, state, metrics, retarget = null) {
  if (!capture) return;
  const { position, base, parts, influences, tailU } = capture;
  const { minY, height, centerZ, depth, headC } = metrics;
  for (let i = 0; i < position.count; i++) {
    const offset = i * 3;
    let x = base[offset];
    let y = base[offset + 1];
    let z = base[offset + 2];
    const part = parts ? Math.round(parts[i]) : 0;
    const vertical = clamp01((y - minY) / Math.max(height, 0.001));

    if (retarget) {
      sourceBodyDelta(retarget, z, metrics, _retargetPoint);
      _bodyCandidate.set(x, y, z).add(_retargetPoint);

      _headCandidate
        .set(x, y, z)
        .sub(headC)
        .applyQuaternion(retarget.headQuaternion)
        .add(headC)
        .add(retarget.headDelta);

      sourceLegDelta(retarget, x, y, z, metrics, _retargetPoint);
      _legCandidate.set(x, y, z).add(_retargetPoint);

      const u = tailU && tailU[i] >= 0
        ? tailU[i]
        : clamp01((centerZ - z) / Math.max(depth, 0.001));
      sourceTailDelta(retarget, u, _retargetPoint);
      _tailCandidate.set(x, y, z).add(_retargetPoint);

      const influenceOffset = i * 4;
      const bodyWeight = influences ? influences[influenceOffset] : (part === 0 ? 1 : 0);
      const headWeight = influences ? influences[influenceOffset + 1] : (part === 1 ? 1 : 0);
      const legWeight = influences ? influences[influenceOffset + 2] : (part === 2 ? 1 : 0);
      const tailWeight = influences ? influences[influenceOffset + 3] : (part === 3 ? 1 : 0);
      const weightTotal = Math.max(bodyWeight + headWeight + legWeight + tailWeight, 1e-6);
      x = (
        _bodyCandidate.x * bodyWeight +
        _headCandidate.x * headWeight +
        _legCandidate.x * legWeight +
        _tailCandidate.x * tailWeight
      ) / weightTotal;
      y = (
        _bodyCandidate.y * bodyWeight +
        _headCandidate.y * headWeight +
        _legCandidate.y * legWeight +
        _tailCandidate.y * tailWeight
      ) / weightTotal;
      z = (
        _bodyCandidate.z * bodyWeight +
        _headCandidate.z * headWeight +
        _legCandidate.z * legWeight +
        _tailCandidate.z * tailWeight
      ) / weightTotal;
      position.setXYZ(i, x, y, z);
      continue;
    }

    y -= state.crouch * smooth01(vertical);
    y -= state.squash * height * 0.18 * smooth01(vertical);
    x *= 1 + state.squash * 0.08;
    z = centerZ + (z - centerZ) * (1 + state.squash * 0.07);

    if (part === 1) {
      const headWeight = smooth01(clamp01((y - (headC.y - metrics.headRadius * 1.1)) / Math.max(metrics.headRadius, 0.001)));
      x += state.headX * headWeight;
      x += state.headYaw * (z - headC.z) * headWeight;
      y += state.headLift * headWeight;
      z += state.headThrust * headWeight;
    } else if (part === 2) {
      const footWeight = 1 - smooth01(clamp01((y - minY) / Math.max(height * 0.48, 0.001)));
      const sidePhase = x >= 0 ? Math.PI : 0;
      const frontPhase = z >= centerZ ? 0 : Math.PI;
      const gait = sampleGaitFoot(
        state.phase,
        state.gaitAmplitude,
        state.stride,
        sidePhase + frontPhase,
        state.travelDirection
      );
      y += gait.lift * footWeight;
      z += gait.forward * footWeight;
    } else if (part === 3) {
      const u = tailU ? Math.max(0, tailU[i]) : clamp01((centerZ - z) / Math.max(depth, 0.001));
      const sway = Math.sin(state.phase + u * Math.PI * 1.8) * state.tailSway * u;
      x += sway;
      y += Math.abs(sway) * 0.22;
    } else {
      y += Math.sin((z - centerZ) * 4.2 + state.phase) * state.bodyWave * smooth01(vertical);
    }

    position.setXYZ(i, x, y, z);
  }
  regularizeDeformation(capture);
  position.needsUpdate = true;
  capture.mesh.geometry.computeVertexNormals();
}

export function createMesh2MotionSurfaceRig(cat, pose = 'standing') {
  const fur = cat?.getObjectByName('fur');
  const outline = cat?.getObjectByName('outline');
  if (!fur?.geometry) return null;
  fur.geometry.computeBoundingBox();
  const bbox = fur.geometry.boundingBox.clone();
  const headC = cat.userData.headC.clone();
  const metrics = {
    minY: bbox.min.y,
    minZ: bbox.min.z,
    height: Math.max(0.001, bbox.max.y - bbox.min.y),
    width: Math.max(0.001, bbox.max.x - bbox.min.x),
    depth: Math.max(0.001, bbox.max.z - bbox.min.z),
    centerZ: (bbox.min.z + bbox.max.z) * 0.5,
    headC,
    headRadius: cat.userData.hr,
  };
  const captures = [captureGeometry(fur), captureGeometry(outline)].filter(Boolean);
  const face = cat.getObjectByName('face');
  const surfaceDetails = cat.getObjectByName('surfaceDetails');
  const faceBase = face?.position.clone() ?? new THREE.Vector3();
  const faceQuaternionBase = face?.quaternion.clone() ?? new THREE.Quaternion();
  const detailBases = [];
  surfaceDetails?.children.forEach((child) => {
    if (child.name.startsWith('innerEar')) {
      detailBases.push({
        child,
        kind: 'head',
        position: child.position.clone(),
        quaternion: child.quaternion.clone(),
      });
    } else if (child.name === 'buttDecal') {
      detailBases.push({
        child,
        kind: 'butt',
        anchor: child.userData.surfaceAnchor?.clone() ?? cat.userData.buttC?.clone(),
        position: child.position.clone(),
        quaternion: child.quaternion.clone(),
      });
    }
  });
  let lastState = sampleMesh2MotionAction('idle', 0, { intensity: 0, pose });
  let lastGeometryQuality = measureDeformationQuality(captures[0]);
  let geometryQualityFrame = 0;

  const reset = () => {
    captures.forEach(setGeometryToBase);
    if (face) {
      face.position.copy(faceBase);
      face.quaternion.copy(faceQuaternionBase);
    }
    detailBases.forEach(({ child, position, quaternion }) => {
      child.position.copy(position);
      child.quaternion.copy(quaternion);
      child.visible = true;
    });
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
    lastState = state;
    const retarget = prepareSourceRetarget(state, metrics);
    state.retarget = retarget;
    state.buttVisible = false;
    captures.forEach((capture) => deformGeometry(capture, state, metrics, retarget));
    geometryQualityFrame += 1;
    if (geometryQualityFrame % 8 === 0) {
      lastGeometryQuality = measureDeformationQuality(captures[0]);
    }
    state.geometryQuality = lastGeometryQuality;

    if (retarget) {
      if (face) {
        face.position
          .copy(faceBase)
          .sub(metrics.headC)
          .applyQuaternion(retarget.headQuaternion)
          .add(metrics.headC)
          .add(retarget.headDelta);
        face.quaternion.copy(faceQuaternionBase).premultiply(retarget.headQuaternion);
      }
      detailBases.forEach(({ child, kind, anchor, position, quaternion }) => {
        if (kind === 'butt') {
          const surfaceAnchor = anchor ?? cat.userData.buttC;
          sourceBodyDelta(
            retarget,
            surfaceAnchor?.z ?? metrics.minZ,
            metrics,
            _buttBodyDelta
          );
          sourceTailDelta(retarget, 0, _buttTailDelta);
          const tailBodyMismatch = _buttTailDelta.distanceTo(_buttBodyDelta);
          child.position
            .copy(position)
            .add(_buttBodyDelta.lerp(_buttTailDelta, 0.42));
          child.quaternion.copy(quaternion);
          child.visible = (
            !BUTT_HIDDEN_ACTIONS.has(state.actionId) &&
            tailBodyMismatch < metrics.headRadius * 0.72
          );
          state.buttVisible = child.visible;
          return;
        }
        child.position
          .copy(position)
          .sub(metrics.headC)
          .applyQuaternion(retarget.headQuaternion)
          .add(metrics.headC)
          .add(retarget.headDelta);
        child.quaternion.copy(quaternion).premultiply(retarget.headQuaternion);
      });
    } else {
      const headOffset = new THREE.Vector3(state.headX, state.headLift, state.headThrust);
      if (face) face.position.copy(faceBase).add(headOffset);
      detailBases.forEach(({ child, kind, position, quaternion }) => {
        child.position.copy(position);
        child.quaternion.copy(quaternion);
        child.visible = kind !== 'butt' || !BUTT_HIDDEN_ACTIONS.has(state.actionId);
        if (kind === 'butt') state.buttVisible = child.visible;
        if (kind === 'head') child.position.add(headOffset);
      });
    }

    cat.rotation.set(state.rootPitch, state.rootYaw, state.rootRoll);
    cat.scale.set(
      1 + state.squash * 0.2,
      Math.max(0.72, 1 - state.squash * 0.24),
      1 + state.squash * 0.12
    );
    const rollClearance = Math.abs(Math.sin(state.rootRoll)) * metrics.width * 0.38;
    cat.userData.animationRootLift = state.rootLift + rollClearance;
    cat.userData.animationRootX = state.rootX;
    cat.userData.animationRootZ = state.rootZ;
    cat.userData.animationState = state;
    return state;
  };

  return {
    pose,
    metrics,
    update,
    reset,
    getState: () => lastState,
    getDiagnostics: () => lastGeometryQuality,
    getCompatibility: (actionId) => getRigCompatibility(pose, actionId),
  };
}
