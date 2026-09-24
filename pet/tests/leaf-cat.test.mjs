import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildCat } from '../../src/catBuilder.js';
import { buildLeafCat } from '../../src/models/leafCat/buildLeafCat.js';
import { leafCatOptions } from '../../src/models/leafCat/config.js';
import { pillowGeometry, leafShape, tailGeometry } from '../../src/models/leafCat/geometry.js';
import { bakeLeafClips, disposeLeafCat } from '../../src/models/leafCat/exportLeafCat.js';
import { createMesh2MotionSkinRig } from '../../src/mesh2motionSkinRig.js';
import { CLIPS } from '../../src/catMotion/clipCatalog.js';
import { BONE_NAMES } from '../../src/catMotion/skeleton.js';
import { DEFAULT_PARAMS, composeParams, validateCatalog } from '../catalog.mjs';
import { validateStudio } from '../studioSchema.mjs';
import { injectPoke } from '../../src/softPoke.js';

const base = JSON.parse(readFileSync(new URL('../rewards.json', import.meta.url)));
const keep = (t, params = {}, quality = 'draft') => { const cat = buildLeafCat(params, quality); t.after(() => disposeLeafCat(cat)); return cat; };
function closed(geometry) {
  const edges = new Map(), indices = geometry.index.array;
  for (let i = 0; i < indices.length; i += 3) for (let j = 0; j < 3; j++) {
    const a = indices[i + j], b = indices[i + (j + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  assert.ok([...edges.values()].every(count => count === 2), 'closed manifold component');
}

test('leaf model uses buildCat dispatch, preserving all existing defaults and saved parameters', t => {
  assert.equal(DEFAULT_PARAMS.characterModel, 'meow');
  const params = Object.freeze({ ...DEFAULT_PARAMS, characterModel: 'leaf-cat' });
  const before = JSON.stringify(params), cat = buildCat(params, 'draft'); t.after(() => disposeLeafCat(cat));
  assert.equal(cat.name, 'LeafCat'); assert.equal(JSON.stringify(params), before);
  for (const name of ['fur', 'face', 'surfaceDetails', 'layered-leaf-collar', 'leaf-ear-1', 'leaf-ear--1', 'pink-nose', 'smile', 'tongue']) assert.ok(cat.getObjectByName(name), name);
  assert.equal(cat.userData.characterModel, 'leaf-cat'); assert.ok(cat.userData.headC.isVector3);
  assert.equal(typeof cat.userData.updateEyeAnimation, 'function'); assert.equal(typeof cat.userData.updateStaticIdle, 'function');
});
test('new leaf and swept-tail components have closed topology and finite normals', () => {
  const leaf = pillowGeometry(leafShape()); closed(leaf);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(.1, .3, -.1), new THREE.Vector3(0, .7, -.2)]);
  const tail = tailGeometry(curve); closed(tail);
  for (const g of [leaf, tail]) { assert.ok([...g.attributes.normal.array].every(Number.isFinite)); g.dispose(); }
});
test('all geometries are finite and bounded; draft uses fewer body vertices', t => {
  const draft = keep(t), full = keep(t, {}, 'full');
  assert.ok(draft.getObjectByName('fur').geometry.attributes.position.count < full.getObjectByName('fur').geometry.attributes.position.count);
  full.traverse(node => {
    if (!node.geometry) return;
    for (const attr of Object.values(node.geometry.attributes)) assert.ok([...attr.array].every(Number.isFinite), `${node.name} finite attributes`);
    const count = node.geometry.attributes.position.count;
    assert.ok([...node.geometry.index.array].every(i => i < count));
  });
  const size = new THREE.Box3().setFromObject(full).getSize(new THREE.Vector3());
  assert.ok(size.y > 2.2 && size.y < 2.9); assert.ok(size.x > 1.2 && size.x < 2.0);
});
test('19-bone rig binds ears, collar, face and every pad to correct bones', t => {
  const cat = keep(t), rig = createMesh2MotionSkinRig(cat);
  assert.equal(rig.skeleton.bones.length, 19); assert.deepEqual([...rig.bones.keys()], BONE_NAMES);
  assert.equal(rig.weightStats.invalidWeights, 0); assert.ok(rig.weightStats.maxWeightError < 1e-6); assert.equal(rig.weightStats.bonesUsed, 19);
  for (const name of ['face', 'leaf-ear-1', 'leaf-ear--1']) assert.equal(cat.getObjectByName(name).parent, rig.bones.get('head'));
  assert.equal(cat.getObjectByName('layered-leaf-collar').parent, rig.bones.get('spineHigh'));
  for (const [i, leg] of ['frontL', 'frontR', 'backL', 'backR'].entries()) {
    const pads = cat.getObjectByName(`paw-pads-${i}`); assert.equal(pads.parent, rig.bones.get(`${leg}Foot`));
    assert.equal(pads.children.filter(x => x.name === 'toe-pad').length, 3); assert.ok(pads.getObjectByName('main-pad'));
  }
});
test('all existing motion clips preserve bone lengths and finite skin; common actions keep the face attached', t => {
  const cat = keep(t), rig = createMesh2MotionSkinRig(cat), face = cat.getObjectByName('face'), bindPosition = face.position.clone();
  for (const clip of CLIPS) for (const phase of [.2, .65]) {
    const state = rig.update(clip.duration * phase, { actionId: clip.id, intensity: .65 });
    cat.updateMatrixWorld(true); rig.skeleton.update();
    assert.ok(state.boneLengthError < 1e-7, clip.id); assert.ok(face.position.distanceTo(bindPosition) < 1e-8);
    for (const value of rig.skeleton.boneMatrices) assert.ok(Number.isFinite(value));
  }
  for (const actionId of ['idle', 'walk', 'paw', 'jump', 'scratch']) {
    rig.update(.7, { actionId, intensity: .65 }); cat.updateMatrixWorld(true); rig.skeleton.update();
    const quality = rig.runDiagnostics(); assert.equal(quality.degenerate, 0, actionId); assert.ok(quality.maxStretch < 5, `${actionId}: ${quality.maxStretch}`);
  }
});
test('bounded extreme anatomy and invalid numeric inputs cannot produce invalid weights', t => {
  for (const params of [{ headSize: .35, earSize: 4.5, legLength: .05, tailLength: 4.5, chubbiness: .3 }, { headSize: 2.8, earSize: .1, legLength: 5, tailLength: .05, chubbiness: 4.5 }, { headSize: NaN, tailCurl: Infinity }]) {
    const options = leafCatOptions(params), cat = keep(t, params), rig = createMesh2MotionSkinRig(cat);
    assert.ok(Number.isFinite(options.head)); assert.equal(rig.weightStats.invalidWeights, 0);
  }
});
test('new shape rewards and creations validate; original catalog counts and fallback are unchanged', () => {
  const reward = { id: 'shape-leaf-test', title: '叶猫', description: '参考图叶猫', category: 'shape', cost: 0, unlockAt: 0, params: { characterModel: 'leaf-cat' } };
  const catalog = validateCatalog({ ...base, rewards: [...base.rewards, reward] });
  assert.equal(base.rewards.length, 20); assert.equal(composeParams(catalog, { shape: reward.id }).characterModel, 'leaf-cat');
  assert.equal(composeParams(base, {}).characterModel, 'meow');
  assert.equal(validateStudio({ params: { characterModel: 'leaf-cat' } }).params.characterModel, 'leaf-cat');
  assert.throws(() => validateStudio({ params: { characterModel: 'external-url' } }));
});
test('offset-aware poke materials share the existing deformation kernel', () => {
  const offset = new THREE.Vector3(.3, 1.4, .7), mat = injectPoke(new THREE.MeshStandardMaterial(), offset);
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>' };
  mat.onBeforeCompile(shader, null);
  assert.equal(shader.uniforms.uPokeSpaceOffset.value, offset);
  assert.ok(shader.vertexShader.includes('transformed + uPokeSpaceOffset')); mat.dispose();
});
test('four portable GLB clips bake the existing rig without invalid animation values', t => {
  const cat = keep(t), rig = createMesh2MotionSkinRig(cat), clips = bakeLeafClips(cat, rig, undefined, 12);
  assert.deepEqual(clips.map(c => c.name), ['idle', 'walk', 'paw', 'jump']);
  for (const clip of clips) { assert.equal(clip.tracks.length, 40); assert.ok(clip.validate()); for (const track of clip.tracks) assert.ok([...track.values].every(Number.isFinite)); }
});
