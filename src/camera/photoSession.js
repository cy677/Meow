import * as THREE from 'three';
import {videoUvTransform} from './framing.js';

/** Temporary render/view state only; never writes model presets or account data. */
export function createPhotoSession({scene, camera, controls, sceneCanvas, frame, getSubject}) {
  let saved = null, video = null, texture = null, dimensions = '', mirror = true;
  const hidden = new Map(), points = new Map();
  let renderState = null;
  let rotation = 0, renderedSubject = null;
  const subjectQuaternion = new THREE.Quaternion();
  const right = new THREE.Vector3(), up = new THREE.Vector3(), delta = new THREE.Vector3();
  let last = null;
  function hideRoom() {
    const subject = getSubject?.();
    const keep = new Set([scene]);
    for (let node = subject; node; node = node.parent) keep.add(node);
    scene.traverse(node => { if (node.isLight) for (let p = node; p; p = p.parent) keep.add(p); });
    function visit(node) {
      if (node === subject) return;
      for (const child of node.children) {
        if (keep.has(child)) visit(child);
        else { if (!hidden.has(child)) hidden.set(child, child.visible); child.visible = false; }
      }
    }
    visit(scene);
  }
  function prepare() {
    if (!saved || !video) return;
    const key = `${video.videoWidth}x${video.videoHeight}`;
    if (dimensions !== key) {
      texture?.dispose(); texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace; texture.matrixAutoUpdate = false;
      dimensions = key;
    }
    const transform = videoUvTransform(video.videoWidth, video.videoHeight, sceneCanvas.getBoundingClientRect(), frame.getBoundingClientRect(), mirror);
    if (transform) texture.matrix.set(transform.sx, 0, transform.tx, 0, transform.sy, transform.ty, 0, 0, 1);
  }
  // Isolate only the render pass. The original weather simulation needs its
  // Color background and Fog objects between frames; leaving a VideoTexture
  // or null fog there would break updateWeather on the very next frame.
  function restoreRenderState() {
    if (renderedSubject) {
      renderedSubject.quaternion.copy(subjectQuaternion);
      renderedSubject.updateMatrixWorld(true); renderedSubject = null;
    }
    if (!renderState) return;
    Object.assign(scene, renderState); renderState = null;
    for (const [node, visible] of hidden) node.visible = visible;
    hidden.clear();
  }
  function beforeRender(...args) {
    saved?.beforeRender?.apply(scene, args);
    if (!saved || !video) return;
    prepare();
    renderState = {background: scene.background, fog: scene.fog,
      backgroundIntensity: scene.backgroundIntensity, backgroundBlurriness: scene.backgroundBlurriness};
    scene.background = texture; scene.backgroundIntensity = 1; scene.backgroundBlurriness = 0; scene.fog = null;
    hideRoom();
    const subject = getSubject?.();
    if (subject && rotation) {
      renderedSubject = subject; subjectQuaternion.copy(subject.quaternion);
      subject.rotateY(rotation); subject.updateMatrixWorld(true);
    }
  }
  function afterRender(...args) {
    restoreRenderState();
    saved?.afterRender?.apply(scene, args);
  }
  function view() {
    const list = [...points.values()];
    if (!list.length) return null;
    if (list.length === 1) return {...list[0], distance: 0, count: 1};
    return {x: (list[0].x + list[1].x) / 2, y: (list[0].y + list[1].y) / 2,
      distance: Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y), count: 2};
  }
  function pointer(event) {
    if (!saved) return;
    if (event.type === 'pointerdown' && event.button !== 0) return;
    if (event.type === 'pointerup' || event.type === 'pointercancel' || event.type === 'lostpointercapture') {
      // Let the home runtime receive pointerup/cancel and clear pointerHeld.
      points.delete(event.pointerId); last = view(); return;
    }
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.type === 'pointerdown') {
      points.set(event.pointerId, {x: event.clientX, y: event.clientY});
      sceneCanvas.setPointerCapture?.(event.pointerId); last = view(); return;
    }
    if (!points.has(event.pointerId)) return;
    points.set(event.pointerId, {x: event.clientX, y: event.clientY});
    const now = view();
    if (last && now.count === last.count) {
      const distance = camera.position.distanceTo(controls.target);
      const unit = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, sceneCanvas.clientHeight);
      camera.updateMatrixWorld();
      right.setFromMatrixColumn(camera.matrixWorld, 0); up.setFromMatrixColumn(camera.matrixWorld, 1);
      delta.copy(right).multiplyScalar(-(now.x - last.x) * unit).addScaledVector(up, (now.y - last.y) * unit);
      camera.position.add(delta); controls.target.add(delta);
      if (now.count === 2 && now.distance > 1 && last.distance > 1) {
        const scaled = THREE.MathUtils.clamp(distance * last.distance / now.distance, controls.minDistance || .5, controls.maxDistance || 28);
        delta.copy(camera.position).sub(controls.target).setLength(scaled); camera.position.copy(controls.target).add(delta);
      }
      camera.lookAt(controls.target); camera.updateMatrixWorld();
    }
    last = now;
  }
  const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'];
  function stop() {
    if (!saved) return;
    for (const type of types) sceneCanvas.removeEventListener(type, pointer, true);
    for (const id of points.keys()) { try { sceneCanvas.releasePointerCapture?.(id); } catch {} }
    points.clear(); last = null;
    restoreRenderState();
    scene.onBeforeRender = saved.beforeRender; scene.onAfterRender = saved.afterRender;
    rotation = 0;
    camera.position.copy(saved.position); camera.quaternion.copy(saved.quaternion);
    camera.fov = saved.fov; camera.updateProjectionMatrix();
    controls.target.copy(saved.target);
    controls.enableDamping = false; controls.update();
    controls.enabled = saved.enabled; controls.enableDamping = saved.damping;
    texture?.dispose(); texture = null; video = null; dimensions = ''; saved = null;
  }
  return {
    start(source, mirrored = true) {
      stop();
      // Flush residual orbit damping before taking a reversible view snapshot.
      const damping = controls.enableDamping; controls.enableDamping = false; controls.update();
      saved = {beforeRender: scene.onBeforeRender, afterRender: scene.onAfterRender,
        position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov,
        target: controls.target.clone(), enabled: controls.enabled, damping};
      controls.enabled = false; video = source; mirror = mirrored;
      for (const type of types) sceneCanvas.addEventListener(type, pointer, {capture: true, passive: false});
      scene.onBeforeRender = beforeRender; scene.onAfterRender = afterRender; prepare();
    },
    setSource(source, mirrored) { video = source; mirror = mirrored; dimensions = ''; prepare(); },
    suspend() { video = null; texture?.dispose(); texture = null; dimensions = ''; restoreRenderState(); },
    setMirror(value) { mirror = Boolean(value); prepare(); },
    rotate(angle) {
      if (!saved || !video || !Number.isFinite(angle)) return;
      rotation = (rotation + angle) % (Math.PI * 2);
    },
    zoom(factor) {
      if (!saved || !video || !(factor > 0)) return;
      const distance = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) / factor, controls.minDistance || .5, controls.maxDistance || 28);
      delta.copy(camera.position).sub(controls.target).setLength(distance);
      camera.position.copy(controls.target).add(delta);
      camera.lookAt(controls.target); camera.updateMatrixWorld();
    },
    resetView() {
      if (!saved) return;
      rotation = 0;
      camera.position.copy(saved.position); controls.target.copy(saved.target);
      camera.lookAt(controls.target); camera.updateMatrixWorld();
    },
    prepare, stop, dispose: stop,
    get active() { return Boolean(saved); },
  };
}
