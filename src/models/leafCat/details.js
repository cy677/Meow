import * as THREE from 'three';
import { injectPoke } from '../../softPoke.js';
import { pillowGeometry, leafShape, earShape, surfaceGeometry, frontProjector, ellipseShape } from './geometry.js';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function mesh(g, m, name) { const x = new THREE.Mesh(g, m); x.name = name; x.castShadow = true; return x; }
function material(color, roughness = .72) { return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 }); }

export function createLeafDetails(cat, body, o) {
  const { headC: c, headPrims, neckY, legs } = body, h = o.head, colors = o.palette;
  const mats = Object.fromEntries(Object.entries(colors).map(([key, value]) => [key, material(value)]));
  mats.body.roughness = .82;
  for (const key of ['marking', 'mouth', 'tongue']) injectPoke(mats[key]);
  const face = new THREE.Group(); face.name = 'face'; cat.add(face);
  const details = new THREE.Group(); details.name = 'surfaceDetails'; cat.add(details);
  const project = frontProjector(headPrims, c.z + .95 * h);
  const shape = points => {
    const s = new THREE.Shape();
    for (const [method, values] of points) s[method](...values.flatMap((n, i) => i % 2 === 0 ? [n * h + c.x] : [n * h + c.y]));
    return s;
  };
  const mask = shape([
    ['moveTo', [0, .275]],
    ['bezierCurveTo', [-.12, .36, -.25, .465, -.34, .44]],
    ['bezierCurveTo', [-.41, .42, -.385, .30, -.40, .22]],
    ['bezierCurveTo', [-.49, .205, -.605, .19, -.585, .075]],
    ['bezierCurveTo', [-.56, -.11, -.40, -.27, -.19, -.24]],
    ['bezierCurveTo', [-.11, -.29, -.035, -.29, 0, -.25]],
    ['bezierCurveTo', [.035, -.29, .11, -.29, .19, -.24]],
    ['bezierCurveTo', [.40, -.27, .56, -.11, .585, .075]],
    ['bezierCurveTo', [.605, .19, .49, .205, .40, .22]],
    ['bezierCurveTo', [.385, .30, .41, .42, .34, .44]],
    ['bezierCurveTo', [.25, .465, .12, .36, 0, .275]],
  ]);
  const marking = mesh(surfaceGeometry(mask, project, { offset: .006 * h, segments: 160, rings: 16 }), mats.marking, 'leaf-face-marking');
  marking.castShadow = false; marking.userData.skipPokeSync = true; face.add(marking);
  const eyes = [];
  for (const side of [-1, 1]) {
    const x = c.x + side * .322 * h, y = c.y - .025 * h;
    const eye = new THREE.Group(); eye.name = side < 0 ? 'eye-left' : 'eye-right';
    const origin = V(x, y, project(x, y)); eye.position.copy(origin); eye.userData.skipPokeSync = true;
    const e = o.eye * h;
    const patch = (name, px, py, rx, ry, mat, offset) => {
      const item = mesh(surfaceGeometry(ellipseShape(px, py, rx, ry), project, { offset: offset * h, origin, segments: 48, rings: 8 }), injectPoke(mat.clone(), origin.clone()), name);
      item.castShadow = false; eye.add(item); return item;
    };
    patch('eye-white', x, y, .170 * e, .231 * e, mats.sclera, .010);
    patch('pink-iris', x + side * .009 * e, y, .130 * e, .207 * e, mats.iris, .015);
    const pupil = patch('eye-pupil', x - side * .012 * e, y - .035 * e, .067 * e, .127 * e, mats.pupil, .021);
    patch('eye-highlight', x - .038 * e, y + .103 * e, .039 * e, .052 * e, mats.sclera, .027);
    patch('eye-highlight-small', x + .032 * e, y - .102 * e, .015 * e, .019 * e, mats.sclera, .028);
    eyes.push({ eye, pupil }); face.add(eye);
  }
  const mouthShape = shape([
    ['moveTo', [-.124, -.305]], ['bezierCurveTo', [-.075, -.35, .075, -.35, .124, -.305]],
    ['bezierCurveTo', [.112, -.46, .070, -.492, 0, -.492]],
    ['bezierCurveTo', [-.070, -.492, -.112, -.46, -.124, -.305]],
  ]);
  const mouth = mesh(surfaceGeometry(mouthShape, project, { offset: .010 * h }), mats.mouth, 'smile'); mouth.castShadow = false; mouth.userData.skipPokeSync = true; face.add(mouth);
  const tongue = mesh(surfaceGeometry(ellipseShape(c.x, c.y - .435 * h, .073 * h, .045 * h), project, { offset: .016 * h, segments: 48, rings: 7 }), mats.tongue, 'tongue'); tongue.castShadow = false; tongue.userData.skipPokeSync = true; face.add(tongue);
  const noseShape = new THREE.Shape(); noseShape.moveTo(-.043 * h, .018 * h);
  noseShape.bezierCurveTo(-.052 * h, .037 * h, .052 * h, .037 * h, .043 * h, .018 * h);
  noseShape.quadraticCurveTo(0, -.052 * h, -.043 * h, .018 * h);
  const nose = mesh(pillowGeometry(noseShape, { depth: .016 * h, segments: 36, rings: 6 }), mats.nose, 'pink-nose');
  nose.position.set(c.x, c.y - .247 * h, project(c.x, c.y - .247 * h) + .020 * h); face.add(nose);
  for (const side of [-1, 1]) {
    const tooth = mesh(pillowGeometry(leafShape(.041 * h, .061 * h), { depth: .014 * h, segments: 24, rings: 5 }), mats.sclera, `fang-${side}`);
    tooth.rotation.z = Math.PI; tooth.position.set(c.x + side * .082 * h, c.y - .332 * h, project(c.x + side * .082 * h, c.y - .332 * h) + .026 * h); face.add(tooth);
  }
  const ears = [];
  for (const side of [-1, 1]) {
    const ear = new THREE.Group(); ear.name = `leaf-ear-${side}`; ear.userData.rigBone = 'head';
    ear.position.set(c.x + side * .41 * h, c.y + .40 * h, c.z - .035 * h);
    ear.rotation.z = -side * .19;
    const width = .51 * h * Math.sqrt(o.ear), height = .73 * h * o.ear;
    ear.add(mesh(pillowGeometry(earShape(width, height, side), { depth: .094 * h, segments: o.radialSegments, bend: -.12 }), mats.ear, `outer-ear-${side}`));
    const inner = mesh(pillowGeometry(earShape(width * .60, height * .67, side), { depth: .035 * h, segments: o.radialSegments, bend: -.10 }), mats.innerEar, `inner-ear-${side}`);
    inner.position.set(-side * .010 * h, .065 * h, .079 * h); ear.add(inner); details.add(ear);
    ears.push({ object: ear, z: ear.rotation.z });
    // Three swept leaf-like cheek tufts, rooted inside the head silhouette.
    const tufts = [[.54, -.10, .26, .26], [.56, -.24, .22, -.17], [.49, -.37, .23, -.72]];
    for (let index = 0; index < tufts.length; index++) {
      const [x, y, length, angle] = tufts[index];
      const tuft = mesh(pillowGeometry(leafShape(.17 * h, length * h, .045 * h), { depth: .073 * h, segments: 40, rings: 8, bend: .15 }), mats.body, `cheek-tuft-${side}-${index}`);
      tuft.position.set(c.x + side * x * h, c.y + y * h, c.z + .09 * h);
      tuft.rotation.z = side * (-Math.PI / 2 + angle); face.add(tuft);
    }
  }
  const collar = new THREE.Group(); collar.name = 'layered-leaf-collar'; collar.userData.rigBone = 'spineHigh'; details.add(collar);
  for (let row = 0; row < 2; row++) {
    const count = row === 0 ? 9 : 7;
    for (let i = 0; i < count; i++) {
      const theta = i / count * Math.PI * 2, front = Math.cos(theta), pale = row === 1;
      const length = pale ? .215 : .29 + Math.max(0, front) * .050;
      const leaf = mesh(pillowGeometry(leafShape(pale ? .175 : .25, length), { depth: pale ? .043 : .056, segments: 40, rings: 8 }), pale ? mats.ruff : (i % 2 ? mats.leaf : mats.leafLight), `collar-${row}-${i}`);
      const radial = pale ? .255 : .195;
      leaf.position.set(Math.sin(theta) * radial, neckY + (pale ? -.045 : -.105), .075 + Math.cos(theta) * radial);
      const outward = pale ? .43 : .66;
      const yAxis = V(Math.sin(theta) * outward, -Math.sqrt(1 - outward ** 2), Math.cos(theta) * outward);
      const xAxis = V(-Math.cos(theta), 0, Math.sin(theta)), zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
      leaf.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis)); collar.add(leaf);
    }
  }
  // Four named paw pads; three toe pads and one larger main pad on each underside.
  for (const leg of legs) {
    const pads = new THREE.Group(); pads.name = `paw-pads-${leg.id}`; pads.userData.rigBone = `${['frontL', 'frontR', 'backL', 'backR'][leg.id]}Foot`;
    pads.position.copy(leg.paw); details.add(pads);
    const addPad = (x, z, sx, sz, name) => {
      const item = mesh(new THREE.SphereGeometry(1, 20, 12), mats.pad, name);
      item.scale.set(sx, .011, sz); item.position.set(x, -.074, z); item.castShadow = false; pads.add(item);
    };
    const padShape = new THREE.Shape();
    padShape.moveTo(-.056, -.027);
    padShape.bezierCurveTo(-.078, .006, -.049, .045, -.022, .035);
    padShape.bezierCurveTo(-.020, .065, .020, .065, .022, .035);
    padShape.bezierCurveTo(.049, .045, .078, .006, .056, -.027);
    padShape.bezierCurveTo(.032, -.054, .018, -.028, 0, -.038);
    padShape.bezierCurveTo(-.018, -.028, -.032, -.054, -.056, -.027);
    const mainPad = mesh(pillowGeometry(padShape, { depth: .012, segments: 48, rings: 6 }), mats.pad, 'main-pad');
    mainPad.rotation.x = Math.PI / 2; mainPad.position.set(0, -.075, -.015); mainPad.castShadow = false; pads.add(mainPad);
    for (const dx of [-.058, 0, .058]) addPad(dx, .077 - Math.abs(dx) * .24, .021, .029, 'toe-pad');
  }
  for (const child of face.children) {
    if (child.userData.skipPokeSync) continue;
    child.userData.basePos = child.position.clone();
    child.userData.refPos = child.position.lengthSq() ? child.position.clone() : c.clone().add(V(0, -.32 * h, .5 * h));
  }
  // No additional render loop; the original renderer owns both updates.
  const updateEyes = (time, gazeX = 0, gazeY = 0) => {
    const phase = ((time % 4.8) + 4.8) % 4.8;
    const blink = phase < .16 ? Math.max(.055, Math.abs(phase - .08) / .08) : 1;
    for (const { eye, pupil } of eyes) { eye.scale.y = blink; pupil.position.set(THREE.MathUtils.clamp(gazeX, -1, 1) * .012, THREE.MathUtils.clamp(gazeY, -1, 1) * .008, 0); }
  };
  const updateIdle = (time, enabled = true) => {
    for (let i = 0; i < ears.length; i++) ears[i].object.rotation.z = ears[i].z + (enabled ? Math.sin(time * 1.8 + i) * .012 : 0);
  };
  const used = new Set(); cat.traverse(node => { if (node.material) used.add(node.material); });
  for (const mat of Object.values(mats)) if (!used.has(mat)) mat.dispose();
  return { updateEyes, updateIdle };
}
