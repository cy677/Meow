import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sphere, roundCone, meshFromSDF, evalField } from '../../sdf.js';
import { tailGeometry } from './geometry.js';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const LEG_NAMES = ['frontL', 'frontR', 'backL', 'backR'];

/** The existing Surface Nets/SDF kernel makes one fused head, torso and four paws. */
export function createLeafBody(o) {
  const prims = [], headPrims = [], legs = [], hints = {}, lift = (o.leg - 1) * .36;
  const neckY = .95 + lift, headC = V(0, neckY + .53 * o.head, .19), hr = .64 * o.head;
  const add = p => { prims.push(p); if (p.tag === 'head') headPrims.push(p); return p; };
  const body = (c, r, s, k = .09) => add(sphere({ c, r, s, k, tag: 'body' }));
  body(V(0, .58 + lift, -.12), .34, [.94 * o.width, 1.24, 1.11]);
  body(V(0, .80 + lift, .02), .26, [.92 * o.width, 1.08, 1]);
  body(V(0, .40 + lift, -.23), .29, [1.05 * o.width, 1.03, 1.02]);
  add(roundCone({ a: V(0, .78 + lift, .04), b: headC.clone().add(V(0, -.22 * o.head, -.06)), r1: .20 * o.width, r2: .27 * o.head, k: .11, tag: 'body' }));
  add(sphere({ c: headC, r: hr, s: [1.09, .99, .91], k: .085, tag: 'head' }));
  for (const side of [-1, 1]) add(sphere({ c: headC.clone().add(V(side * .40 * o.head, -.24 * o.head, .13 * o.head)), r: .26 * o.head, s: [1.04, .88, .88], k: .06, tag: 'head' }));
  const muzzle = headC.clone().add(V(0, -.29 * o.head, .43 * o.head));
  add(sphere({ c: muzzle, r: .155 * o.head, s: [1.22, .76, .58], k: .065, tag: 'head' }));
  Object.assign(hints, { hips: V(0, .50 + lift, -.24), spineLow: V(0, .64 + lift, -.10), spineHigh: V(0, .86 + lift, .06), head: headC.clone() });
  for (let id = 0; id < 4; id++) {
    const front = id < 2, side = id % 2 === 0 ? 1 : -1;
    const x = side * (front ? .155 : .285) * o.width, z = front ? .19 : -.22;
    const top = V(x, (front ? .78 : .45) + lift, z - .015), paw = V(x, .078, z + .045);
    const leg = { id, top, paw }; legs.push(leg);
    const tagLeg = p => Object.assign(add(p), { legId: id });
    if (!front) tagLeg(sphere({ c: V(x, .29 + lift * .3, z - .015), r: .17, s: [1.05, 1.27, 1.03], k: .045, tag: 'leg' }));
    tagLeg(roundCone({ a: top, b: V(x, .12, z + .018), r1: front ? .108 : .12, r2: .097, k: .055, tag: 'leg' }));
    tagLeg(sphere({ c: paw, r: .12, s: [1, .68, 1.19], k: .025, tag: 'leg' }));
    for (const dx of [-.066, 0, .066]) tagLeg(sphere({ c: V(x + dx, .055, z + .132), r: .047, s: [.88, .91, 1.04], k: .013, tag: 'leg' }));
    const prefix = LEG_NAMES[id]; hints[`${prefix}Upper`] = top.clone();
    hints[`${prefix}Lower`] = top.clone().lerp(paw, .55); hints[`${prefix}Foot`] = paw.clone();
  }
  const base = V(0, .48 + lift, -.43);
  const curve = new THREE.CatmullRomCurve3([
    base, V(.015, .63 + lift, -.64), V(.055, .95 + lift, -.82),
    V(.035, 1.22 + lift + (o.tail - 1) * .35, -.80),
    V(-.12 - o.curl * .07, 1.43 + lift + (o.tail - 1) * .52, -.69 + o.curl * .10),
  ]);
  hints.tailBase = curve.getPoint(0); hints.tailMid = curve.getPoint(.55); hints.tailTip = curve.getPoint(1);
  const bodyGeometry = meshFromSDF(prims, o.cell);
  // The reusable kernel samples normals on a grid. Re-evaluate the new model's
  // normals at the actual vertices to avoid visible grid bands on smooth mint skin.
  const positions = bodyGeometry.attributes.position, normals = bodyGeometry.attributes.normal;
  const epsilon = .001;
  const field = (x, y, z) => Math.max(evalField(prims, x, y, z), .004 - y);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const n = V(field(x + epsilon, y, z) - field(x - epsilon, y, z),
      field(x, y + epsilon, z) - field(x, y - epsilon, z),
      field(x, y, z + epsilon) - field(x, y, z - epsilon)).normalize();
    normals.setXYZ(i, n.x, n.y, n.z);
  }
  installSemanticAttributes(bodyGeometry, prims, legs, headC, o);
  const tail = tailGeometry(curve, { width: .255 * Math.sqrt(o.tail), depth: .185 * Math.sqrt(o.tail) });
  installTailAttributes(tail);
  const geometry = mergeGeometries([bodyGeometry, tail], false);
  if (!geometry) throw new Error('Leaf-cat body/tail geometry attributes do not match');
  bodyGeometry.dispose(); tail.dispose();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData.meshCellSize = o.cell;
  return { geometry, prims, headPrims, headC, hr, muzzle, hints, legs, neckY, lift, curve };
}

function allocate(geometry) {
  const n = geometry.attributes.position.count, arrays = {
    rigPart: new Float32Array(n), rigInfluence: new Float32Array(n * 4),
    rigTailU: new Float32Array(n).fill(-1), rigLegId: new Float32Array(n).fill(-1),
    rigLegU: new Float32Array(n).fill(-1),
    rigLegBlend: new Float32Array(n * 4), rigLegCoord: new Float32Array(n * 4),
    rigBodyBlend: new Float32Array(n * 3),
  };
  for (const [name, data] of Object.entries(arrays)) geometry.setAttribute(name, new THREE.Float32BufferAttribute(data, name === 'rigBodyBlend' ? 3 : ['rigInfluence', 'rigLegBlend', 'rigLegCoord'].includes(name) ? 4 : 1));
  return Object.fromEntries(Object.keys(arrays).map(name => [name, geometry.attributes[name].array]));
}
function installSemanticAttributes(g, prims, legs, headC, o) {
  const a = allocate(g), p = g.attributes.position, lift = (o.leg - 1) * .36;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const distances = [Infinity, Infinity, Infinity], legDistances = [Infinity, Infinity, Infinity, Infinity];
    for (const primitive of prims) {
      const group = primitive.tag === 'head' ? 1 : primitive.tag === 'leg' ? 2 : 0;
      const d = primitive.dist(x, y, z); distances[group] = Math.min(distances[group], d);
      if (group === 2) legDistances[primitive.legId] = Math.min(legDistances[primitive.legId], d);
    }
    // Continuous partition, including all four legs, prevents seams at the
    // nearest-primitive boundary when neighboring feet move in opposite phases.
    const min = Math.min(...distances), raw = distances.map(d => Math.exp(-(d - min) / .045));
    const sum = raw.reduce((a, b) => a + b), headCore = THREE.MathUtils.smoothstep(y, headC.y - .65 * o.head, headC.y - .52 * o.head);
    const headWeight = THREE.MathUtils.lerp(raw[1] / sum, 1, headCore);
    const legWeight = (1 - headWeight) * raw[2] / (raw[0] + raw[2]);
    const bodyWeight = Math.max(0, 1 - headWeight - legWeight);
    a.rigInfluence.set([bodyWeight, headWeight, legWeight, 0], i * 4);
    a.rigPart[i] = headWeight > .5 ? 1 : legWeight > .5 ? 2 : 0;
    // This character has a vertical torso. Its spine blend follows the actual
    // hip/chest anchors rather than the original long cat's depth thresholds.
    const low = .50 + lift, middle = .64 + lift, high = .86 + lift;
    if (y < middle) { const t = THREE.MathUtils.smoothstep(y, low, middle); a.rigBodyBlend.set([1 - t, t, 0], i * 3); }
    else { const t = THREE.MathUtils.smoothstep(y, middle, high); a.rigBodyBlend.set([0, 1 - t, t], i * 3); }
    const near = Math.min(...legDistances), shares = legDistances.map(d => Math.exp(-(d - near) / .035));
    const total = shares.reduce((a, b) => a + b); let primary = 0;
    for (const leg of legs) {
      const u = THREE.MathUtils.clamp((leg.top.y - y) / Math.max(.01, leg.top.y - leg.paw.y - .045), 0, 1);
      a.rigLegBlend[i * 4 + leg.id] = shares[leg.id] / total;
      a.rigLegCoord[i * 4 + leg.id] = u;
      if (shares[leg.id] > shares[primary]) primary = leg.id;
    }
    a.rigLegId[i] = primary; a.rigLegU[i] = a.rigLegCoord[i * 4 + primary];
  }
}
function installTailAttributes(g) {
  const coordinates = g.userData.tailCoordinates, a = allocate(g);
  for (let i = 0; i < coordinates.length; i++) {
    const u = coordinates[i], tailWeight = THREE.MathUtils.smoothstep(u, 0, .12);
    a.rigPart[i] = 3; a.rigTailU[i] = u; a.rigBodyBlend[i * 3] = 1;
    a.rigInfluence[i * 4] = 1 - tailWeight; a.rigInfluence[i * 4 + 3] = tailWeight;
  }
}
