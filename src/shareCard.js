import * as THREE from 'three';
import {createCameraOverlay} from './camera/cameraOverlay.js';
import {createDevicePhotoMode} from './camera/photoMode.js';
import {CARD_LAYOUT, localeCopy, roundedRect, drawCardDecor, getShareCardDescriptor, getShareCardFilename} from './camera/cardArtwork.js';
export {getShareCardDescriptor, getShareCardFilename, SHARE_CARD_REPOSITORY} from './camera/cardArtwork.js';

const bounds = new THREE.Box3(), center = new THREE.Vector3(), subjectView = new THREE.Vector3();
const forward = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), projected = new THREE.Vector3();

/** Pan camera and target together, preserving the user's rotation and zoom. */
export function getShareCardSubjectPanOffset({camera, subject, frameRect, canvasRect}) {
  const offset = new THREE.Vector3();
  if (!camera || !subject || !frameRect || !canvasRect || canvasRect.width <= 0 || canvasRect.height <= 0) return offset;
  subject.updateWorldMatrix?.(true, true); camera.updateMatrixWorld(true); bounds.setFromObject(subject);
  if (bounds.isEmpty()) return offset;
  bounds.getCenter(center);
  const x = ((frameRect.left + frameRect.width / 2 - canvasRect.left) / canvasRect.width) * 2 - 1;
  const y = -((frameRect.top + frameRect.height / 2 - canvasRect.top) / canvasRect.height) * 2 + 1;
  projected.copy(center).project(camera); camera.getWorldDirection(forward);
  const depth = subjectView.copy(center).sub(camera.position).dot(forward);
  if (!Number.isFinite(depth) || depth <= camera.near) return offset;
  const height = 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  right.setFromMatrixColumn(camera.matrixWorld, 0).normalize(); up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  return offset.addScaledVector(right, (projected.x - x) * height * camera.aspect / 2).addScaledVector(up, (projected.y - y) * height / 2);
}

function captureCanvasRegion(canvas, source, ctx, target) {
  const scaleX = canvas.width / source.canvasWidth, scaleY = canvas.height / source.canvasHeight;
  const sx = Math.max(0, source.x * scaleX), sy = Math.max(0, source.y * scaleY);
  const sw = Math.min(canvas.width - sx, source.width * scaleX), sh = Math.min(canvas.height - sy, source.height * scaleY);
  if (!(sw > 0 && sh > 0)) throw new Error('取景区域不在画布内');
  ctx.drawImage(canvas, sx, sy, sw, sh, target.x, target.y, target.width, target.height);
}

export function createShareCardCapture({viewport, renderer, scene, camera, controls, sceneCanvas, getSubject, getSeed, getPalette, getLocale, downloadBlob, poseControl}) {
  const overlay = document.createElement('div'); overlay.className = 'share-card-overlay'; overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true'); overlay.setAttribute('data-i18n-ignore', '');
  overlay.innerHTML = `<div class="share-card-shell" role="dialog" aria-modal="false">
    <div class="share-card-live-frame">
      <span class="share-card-paper share-card-paper--top"></span><span class="share-card-paper share-card-paper--right"></span>
      <span class="share-card-paper share-card-paper--bottom"></span><span class="share-card-paper share-card-paper--left"></span>
      <span class="share-card-window"></span><span class="share-card-edition">MEOW CARD</span><span class="share-card-gem">✦</span>
      <span class="share-card-star share-card-star--one">✦</span><span class="share-card-star share-card-star--two">★</span>
      <span class="share-card-live-title">MEOW GENERATOR</span><span class="share-card-live-subtitle"></span>
      <span class="share-card-serial"></span><span class="share-card-rarity"></span>
    </div>
    <p class="share-card-hint"></p><div class="share-card-actions">
      <button type="button" class="share-card-skin-button"></button><button type="button" class="share-card-capture-button"></button>
      <button type="button" class="share-card-pose-button">切换姿势</button>
      <button type="button" class="share-card-close-button"></button>
    </div><output class="share-card-status" aria-live="polite"></output>
  </div>`;
  viewport.appendChild(overlay);
  const shell = overlay.querySelector('.share-card-shell'), frame = overlay.querySelector('.share-card-live-frame');
  const windowEl = overlay.querySelector('.share-card-window'), serialEl = overlay.querySelector('.share-card-serial');
  const rarityEl = overlay.querySelector('.share-card-rarity'), subtitleEl = overlay.querySelector('.share-card-live-subtitle');
  const hintEl = overlay.querySelector('.share-card-hint'), skinButton = overlay.querySelector('.share-card-skin-button');
  const captureButton = overlay.querySelector('.share-card-capture-button'), closeButton = overlay.querySelector('.share-card-close-button');
  const statusEl = overlay.querySelector('.share-card-status');
  const poseButton = overlay.querySelector('.share-card-pose-button');
  let skinVariant = 0, descriptor = getShareCardDescriptor(getSeed(), getPalette?.());
  let active = false, disposed = false, capturing = false, generation = 0, cameraPanFrame = 0, openedView = null;
  let device;
  function syncControls() {
    captureButton.disabled = !active || capturing || (device?.enabled && !device.ready);
    skinButton.disabled = !active || capturing;
    skinButton.hidden = Boolean(device?.enabled);
    poseButton.disabled = !active || capturing || (poseControl?.options()?.length ?? 0) < 2;
    hintEl.textContent = device?.enabled ? '单指移动小猫，双指调整大小；仅真人画面镜像' : localeCopy(getLocale()).hint;
  }
  device = createDevicePhotoMode({overlay, viewport, scene, camera, controls, sceneCanvas, frame: windowEl, getSubject, statusEl,
    isOpen: () => active && !disposed, beforeStart: () => cancelAnimationFrame(cameraPanFrame), onChange: syncControls});
  const overlayController = createCameraOverlay({viewport, overlay, shell});

  function alignSubjectToCard() {
    const subject = getSubject?.();
    if (!active || device.enabled || !subject || !controls) return;
    const offset = getShareCardSubjectPanOffset({camera, subject, frameRect: windowEl.getBoundingClientRect(), canvasRect: sceneCanvas.getBoundingClientRect()});
    if (offset.lengthSq() < 1e-8) return;
    cancelAnimationFrame(cameraPanFrame);
    const startedAt = performance.now(), position = camera.position.clone(), target = controls.target.clone();
    const tick = now => {
      if (!active || device.enabled) return;
      const linear = THREE.MathUtils.clamp((now - startedAt) / 280, 0, 1), eased = 1 - Math.pow(1 - linear, 3);
      camera.position.copy(position).addScaledVector(offset, eased); controls.target.copy(target).addScaledVector(offset, eased); controls.update();
      viewport.dataset.shareCardAutoPan = eased.toFixed(3);
      if (linear < 1) cameraPanFrame = requestAnimationFrame(tick);
    };
    cameraPanFrame = requestAnimationFrame(tick);
  }
  function syncCopy() {
    const copy = localeCopy(getLocale());
    skinButton.textContent = `🎨 ${copy.skin}`; captureButton.textContent = `📸 ${copy.camera}`; closeButton.textContent = `× ${copy.close}`;
    poseButton.textContent = getLocale()==='zh-CN'?'切换姿势':getLocale()==='ja-JP'?'ポーズを変更':'Change pose';
    subtitleEl.textContent = copy.title; serialEl.textContent = copy.cardNumber(descriptor.serial); shell.setAttribute('aria-label', copy.title); syncControls();
  }
  function applyDescriptor() {
    descriptor = getShareCardDescriptor(getSeed(), getPalette?.(), skinVariant);
    const {theme, rarity} = descriptor;
    frame.dataset.theme = theme.name; frame.dataset.pattern = theme.pattern; frame.dataset.rarity = rarity;
    for (const name of ['paper', 'primary', 'secondary', 'accent', 'ink']) frame.style.setProperty(`--share-${name}`, theme[name]);
    serialEl.textContent = localeCopy(getLocale()).cardNumber(descriptor.serial); rarityEl.textContent = `${rarity} ✦`;
    viewport.dataset.shareCardSkin = theme.name; viewport.dataset.shareCardRarity = rarity;
  }
  function randomizeSkin() {
    const previous = skinVariant, random = new Uint32Array(1); globalThis.crypto?.getRandomValues?.(random);
    skinVariant = random[0] || ((Date.now() ^ Math.abs(Math.trunc(Number(getSeed()) || 0))) >>> 0);
    if (skinVariant === 0 || skinVariant === previous) skinVariant = previous + 1;
    applyDescriptor(); statusEl.textContent = '';
  }
  function open() {
    if (disposed) throw new Error('拍照界面已销毁');
    if (active) return;
    ++generation; active = true; capturing = false; skinVariant = 0;
    openedView = {position: camera.position.clone(), target: controls.target.clone(), fov: camera.fov};
    device.reset(); applyDescriptor(); syncCopy(); statusEl.textContent = ''; overlayController.open();
    cancelAnimationFrame(cameraPanFrame); cameraPanFrame = requestAnimationFrame(alignSubjectToCard);
  }
  function close() {
    ++generation; active = false; capturing = false; cancelAnimationFrame(cameraPanFrame); device.reset();
    if (openedView) {
      const damping = controls.enableDamping; controls.enableDamping = false; controls.update();
      camera.position.copy(openedView.position); controls.target.copy(openedView.target); camera.fov = openedView.fov;
      camera.updateProjectionMatrix(); controls.update(); controls.enableDamping = damping; openedView = null;
    }
    overlayController.close();
  }
  async function capture({download = true} = {}) {
    if (!active || disposed || capturing || (device.enabled && !device.ready)) return null;
    const request = generation, modeVersion = device.version, together = device.enabled;
    capturing = true; syncControls(); statusEl.textContent = '';
    try {
      const canvasRect = sceneCanvas.getBoundingClientRect(), viewRect = together ? canvasRect : windowEl.getBoundingClientRect();
      if (!(viewRect.width > 0 && viewRect.height > 0 && canvasRect.width > 0 && canvasRect.height > 0)) throw new Error('取景框尚未就绪');
      if (together) device.prepare();
      renderer.render(scene, camera);
      const output = document.createElement('canvas');
      output.width = together ? sceneCanvas.width : 1200; output.height = together ? sceneCanvas.height : 1600;
      const ctx = output.getContext('2d'); if (!ctx) throw new Error('无法创建照片画布');
      const cardX = 30, cardY = 30, cardWidth = 1140, cardHeight = 1540;
      const target = {x: cardX + cardWidth * CARD_LAYOUT.windowX, y: cardY + cardHeight * CARD_LAYOUT.windowY,
        width: cardWidth * CARD_LAYOUT.windowWidth, height: cardHeight * CARD_LAYOUT.windowHeight};
      const source = {x: viewRect.left - canvasRect.left, y: viewRect.top - canvasRect.top, width: viewRect.width, height: viewRect.height,
        canvasWidth: canvasRect.width, canvasHeight: canvasRect.height};
      if (together) {
        ctx.drawImage(sceneCanvas, 0, 0, output.width, output.height);
      } else {
        ctx.save(); roundedRect(ctx, target.x, target.y, target.width, target.height, 40); ctx.clip();
        captureCanvasRegion(sceneCanvas, source, ctx, target); ctx.restore();
        drawCardDecor(ctx, {cardX, cardY, cardWidth, cardHeight, windowX: target.x, windowY: target.y,
          windowWidth: target.width, windowHeight: target.height, descriptor, copy: localeCopy(getLocale())});
      }
      const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG 编码失败');
      if (!active || disposed || request !== generation || modeVersion !== device.version) return null;
      const value = {blob, devicePhoto: together, filename: together ? `meow_together_${Date.now()}.png` : getShareCardFilename(getSeed())};
      if (download) await downloadBlob(blob, value.filename);
      if (request !== generation || disposed) return null;
      statusEl.textContent = download ? '照片已生成，已开始保存。' : localeCopy(getLocale()).saved;
      viewport.dataset.shareCardCaptured = 'true'; return value;
    } catch (error) {
      if (request === generation && !disposed) {
        console.warn('Share card capture failed', error); statusEl.textContent = error.message || localeCopy(getLocale()).saveFailed;
        viewport.dataset.shareCardCaptured = 'false';
      }
      return null;
    } finally { if (request === generation && !disposed) { capturing = false; syncControls(); } }
  }
  for (const button of [skinButton, captureButton, closeButton]) button.addEventListener('pointerdown', event => event.stopPropagation());
  poseButton.addEventListener('click', () => {
    if(poseButton.disabled || !poseControl)return;
    const options=poseControl.options(), index=options.findIndex(p=>p.params.pose===poseControl.current());
    const next=options[(index+1)%options.length];
    const position=camera.position.clone(),target=controls.target.clone(),fov=camera.fov;
    cancelAnimationFrame(cameraPanFrame);
    poseControl.select(next);
    camera.position.copy(position);controls.target.copy(target);camera.fov=fov;camera.updateProjectionMatrix();
    camera.lookAt(target);camera.updateMatrixWorld();
    statusEl.textContent=next.title;viewport.dataset.photoPose=next.params.pose;
  });
  skinButton.addEventListener('click', randomizeSkin); captureButton.addEventListener('click', () => void capture()); closeButton.addEventListener('click', close);
  const onKey = event => { if (event.key === 'Escape' && active) close(); };
  window.addEventListener('keydown', onKey); window.addEventListener('meow:localechange', syncCopy);
  return {open, setPoseControl(value) { poseControl=value;syncControls(); }, openTogether() { open(); return device.start(); }, close, capture, get active() { return active; }, dispose() {
    if (disposed) return; close(); disposed = true; device.dispose();
    window.removeEventListener('keydown', onKey); window.removeEventListener('meow:localechange', syncCopy); overlayController.dispose();
  }};
}
