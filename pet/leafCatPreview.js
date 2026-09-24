import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildLeafCat } from '../src/models/leafCat/buildLeafCat.js';
import { exportLeafCat, disposeLeafCat } from '../src/models/leafCat/exportLeafCat.js';
import { createMesh2MotionSkinRig } from '../src/mesh2motionSkinRig.js';

const $ = id => document.getElementById(id), stage = $('stage');
const DEFAULTS = Object.freeze({ headSize: 1.08, chubbiness: 1.15, legLength: .85, earSize: 1, tailLength: .95, tailCurl: .35, eyeSize: 1.05 });
const fields = [['headSize', '头身比例', .78, 1.48], ['chubbiness', '身体圆润', .65, 2.1], ['legLength', '腿部长度', .5, 1.4], ['earSize', '叶形耳朵', .65, 1.4], ['tailLength', '叶尾长度', .65, 1.4]];
const names = { reference: '参考姿态', idle: '待机', walk: '行走', paw: '轻拍', jump: '跳跃', scratch: '抓挠' };
const params = { ...DEFAULTS }, inputs = new Map();
const scene = new THREE.Scene(); scene.background = new THREE.Color('#f6f7f1');
const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, .01, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12; renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.setAttribute('aria-label', '拖动旋转叶猫，双指缩放'); stage.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
controls.dampingFactor = .09; controls.minZoom = .5; controls.maxZoom = 2.5; controls.enablePan = false;
scene.add(new THREE.HemisphereLight('#faffef', '#9bb896', 1.5), new THREE.AmbientLight('#f2fff0', .35));
const key = new THREE.DirectionalLight('#fffdf6', 2.4); key.position.set(-3, 5, 4); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -3; key.shadow.camera.right = 3;
key.shadow.camera.top = 4; key.shadow.camera.bottom = -3; key.shadow.normalBias = .015; key.shadow.radius = 4; scene.add(key);
const fill = new THREE.DirectionalLight('#e7f5ff', .8); fill.position.set(3, 3, -4); scene.add(fill);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: '#61745b', opacity: .08 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = .002; ground.receiveShadow = true; scene.add(ground);
const floorBase = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: '#f6f7f1' }));
floorBase.rotation.x = -Math.PI / 2; floorBase.position.y = .001; scene.add(floorBase);
const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 128;
const context = shadowCanvas.getContext('2d'), gradient = context.createRadialGradient(64, 64, 2, 64, 64, 62);
gradient.addColorStop(0, 'rgba(78,105,65,.24)'); gradient.addColorStop(.4, 'rgba(78,105,65,.13)'); gradient.addColorStop(1, 'rgba(78,105,65,0)');
context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, .003, -.04); scene.add(shadow);
let cat, rig, action = 'reference', view = 'three', elapsed = 0, playing = false, lastTime = null, raf = 0, destroyed = false;

function resize() {
  const width = Math.max(1, stage.clientWidth), height = Math.max(1, stage.clientHeight);
  renderer.setSize(width, height, false);
  const half = (action === 'reference' ? 1.52 : 1.96) * Math.max(1, .82 / (width / height));
  camera.left = -half * width / height; camera.right = half * width / height; camera.top = half; camera.bottom = -half;
  camera.updateProjectionMatrix();
}
function setView(name) {
  const vectors = { three: [3.7, 1.35, 5.8], front: [0, .06, 6], left: [-6, .06, 0], right: [6, .06, 0], back: [0, .06, -6], top: [0, 6, .001], bottom: [0, -6, .001] };
  if (!vectors[name]) throw new RangeError('未知观察视角');
  view = name; camera.up.set(0, 1, 0); if (name === 'top') camera.up.set(0, 0, -1); if (name === 'bottom') camera.up.set(0, 0, 1);
  controls.target.set(0, action === 'reference' ? 1.28 : 1.60, 0);
  camera.position.copy(controls.target).add(new THREE.Vector3(...vectors[name])); camera.zoom = 1;
  ground.visible = shadow.visible = floorBase.visible = name !== 'bottom'; controls.update(); resize();
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === name));
}
function inspect() {
  cat.getObjectByName('layered-leaf-collar').visible = $('collar-visible').checked;
  cat.traverse(node => { if (node.material) node.material.wireframe = $('wireframe').checked; });
}
function updatePose(t) {
  if (action === 'reference') {
    rig.reset(); cat.position.set(0, 0, 0); cat.userData.updateEyeAnimation(1, 0, 0); cat.userData.updateStaticIdle(0, false);
  } else {
    const state = rig.update(t, { actionId: action, intensity: .65 });
    cat.position.set(state.rootX ?? 0, cat.userData.animationRootLift ?? 0, state.rootZ ?? 0);
    cat.rotation.set(state.rootPitch ?? 0, state.rootYaw ?? 0, state.rootRoll ?? 0);
    cat.userData.updateEyeAnimation(t + 1, 0, 0); cat.userData.updateStaticIdle(t, true);
  }
  shadow.material.opacity = 1 / (1 + Math.max(0, cat.position.y) * 3);
  cat.updateMatrixWorld(true); rig.skeleton.update();
}
function selectAction(id, run = true) {
  if (!(id in names)) throw new RangeError('未知动作');
  action = id; elapsed = 0; playing = run && id !== 'reference'; updatePose(0); setView(view);
  document.querySelectorAll('[data-action]').forEach(button => button.classList.toggle('active', button.dataset.action === id));
  $('status').textContent = names[id];
}
function build() {
  const next = buildLeafCat(params); const nextRig = createMesh2MotionSkinRig(next, 'standing');
  if (nextRig.weightStats.invalidWeights) { disposeLeafCat(next); throw new Error('骨骼权重无效'); }
  if (cat) disposeLeafCat(cat); cat = next; rig = nextRig; scene.add(cat);
  updatePose(elapsed); inspect();
  let vertices = 0, triangles = 0, meshes = 0;
  cat.traverse(node => { if (node.geometry) { meshes++; vertices += node.geometry.attributes.position.count; triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3; } });
  $('model-stats').textContent = `${(triangles / 1000).toFixed(1)}k 三角形 · 19 骨骼`;
  cat.userData.modelStats = { vertices, triangles, meshes, bones: rig.skeleton.bones.length };
}
function setParameters(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS) || !Number.isFinite(value)) throw new TypeError('模型参数必须是已知的有限数值');
  }
  Object.assign(params, patch); build();
  for (const [key, { input, output }] of inputs) { input.value = params[key]; output.value = Number(input.value).toFixed(2); }
}
for (const [key, label, min, max] of fields) {
  const row = document.createElement('label'); row.className = 'shape-row';
  const text = document.createElement('span'); text.textContent = label;
  const input = document.createElement('input'); input.type = 'range'; input.min = min; input.max = max; input.step = '.01'; input.value = params[key];
  const output = document.createElement('output'); output.value = params[key].toFixed(2);
  input.addEventListener('input', () => { output.value = Number(input.value).toFixed(2); });
  input.addEventListener('change', () => { try { setParameters({ [key]: Number(input.value) }); } catch (error) { $('status').textContent = error.message; } });
  row.append(text, input, output); $('shape-controls').appendChild(row); inputs.set(key, { input, output });
}
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => selectAction(button.dataset.action)));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('reset-shape').addEventListener('click', () => setParameters(DEFAULTS));
$('collar-visible').addEventListener('change', inspect); $('wireframe').addEventListener('change', inspect);
$('export-glb').addEventListener('click', async () => {
  const button = $('export-glb'); button.disabled = true; $('status').textContent = '正在导出模型和动画…';
  try {
    const bytes = await exportLeafCat(params), url = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
    const a = document.createElement('a'); a.href = url; a.download = 'leaf-cat-rigged.glb'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000); $('status').textContent = 'GLB 已生成。浏览器将保存到下载目录。';
  } catch (error) { $('status').textContent = `导出失败：${error.message}`; }
  finally { button.disabled = false; }
});
const observer = new ResizeObserver(resize); observer.observe(stage);
function tick(now) {
  if (destroyed) return;
  const dt = lastTime === null ? 0 : Math.min(.05, (now - lastTime) / 1000); lastTime = now;
  if (playing && !document.hidden) { elapsed += dt; updatePose(elapsed); }
  controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(tick);
}
try {
  build(); setView('three'); selectAction('reference'); raf = requestAnimationFrame(tick);
  // Deterministic review port, independent of the pet account/store/API.
  window.__leafCatPreview = {
    setView, setParameters,
    setFrame(id, time) { if (!Number.isFinite(time)) throw new TypeError('无效时间'); selectAction(id, false); elapsed = time; updatePose(time); renderer.render(scene, camera); },
    capture(enabled = true) { document.body.classList.toggle('capture', enabled); resize(); renderer.render(scene, camera); },
    diagnostics() { return { ...cat.userData.modelStats, weights: rig.getWeightStats(), quality: rig.runDiagnostics(), action, params: { ...params },
      attachments: ['face', 'leaf-ear-1', 'layered-leaf-collar', 'paw-pads-0'].map(name => ({ name, parent: cat.getObjectByName(name).parent.name })) }; },
    async exportBase64(animated = true) { const bytes = new Uint8Array(await exportLeafCat(params, { animated })); let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(binary); },
    screenshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
  };
} catch (error) { $('status').textContent = `模型加载失败：${error.message}`; throw error; }
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  destroyed = true; cancelAnimationFrame(raf); observer.disconnect(); controls.dispose(); if (cat) disposeLeafCat(cat);
  shadow.material.map.dispose(); shadow.material.dispose(); shadow.geometry.dispose(); ground.material.dispose(); ground.geometry.dispose(); floorBase.geometry.dispose(); floorBase.material.dispose(); renderer.dispose();
});
