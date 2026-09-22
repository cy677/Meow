import {createDeviceCameraProvider, cameraErrorMessage} from './deviceCamera.js';
import {createPhotoSession} from './photoSession.js';

/** Reversible full-viewport controls; capture uses the regular save path. */
export function createDevicePhotoMode({overlay, viewport, scene, camera, controls, sceneCanvas, getSubject, statusEl, isOpen, beforeStart, onChange}) {
  const styleUrl = new URL('./photo.css?no-inline', import.meta.url).href;
  if (![...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === styleUrl)) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = styleUrl; document.head.append(link);
  }
  const panel = document.createElement('section'); panel.className = 'device-photo-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', '合影调整');
  panel.innerHTML = `<p class="device-photo-state" role="status"></p>
    <div class="device-photo-zoom"><button type="button" class="device-photo-smaller" aria-label="缩小小猫">− 缩小</button><button type="button" class="device-photo-larger" aria-label="放大小猫">＋ 放大</button></div>
    <div class="device-photo-rotate"><button type="button" class="device-photo-rotate-left" aria-label="向左旋转小猫">↶ 左转</button><button type="button" class="device-photo-rotate-right" aria-label="向右旋转小猫">↷ 右转</button></div>
    <button type="button" class="device-photo-switch" hidden>切换前后摄像头</button>
    <button type="button" class="device-photo-mirror" aria-pressed="true">自拍镜像：开</button>
    <button type="button" class="device-photo-reset">还原构图</button>`;
  overlay.append(panel);
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'device-photo-toggle';
  overlay.querySelector('.share-card-capture-button').after(toggle);
  const switchButton = panel.querySelector('.device-photo-switch'), mirrorButton = panel.querySelector('.device-photo-mirror');
  const resetButton = panel.querySelector('.device-photo-reset'), stateText = panel.querySelector('.device-photo-state');
  const smaller = panel.querySelector('.device-photo-smaller'), larger = panel.querySelector('.device-photo-larger');
  const rotateLeft = panel.querySelector('.device-photo-rotate-left'), rotateRight = panel.querySelector('.device-photo-rotate-right');
  const session = createPhotoSession({scene, camera, controls, sceneCanvas, frame: sceneCanvas, getSubject});
  let enabled = false, pending = false, disposed = false, epoch = 0, facing = 'user', mirror = true, canSwitch = false;
  let cameras = [], currentDeviceId;
  const provider = createDeviceCameraProvider({host: viewport, onInterrupted(error) {
    stopCamera(); statusEl.textContent = cameraErrorMessage(error);
  }});
  function sync() {
    viewport.dataset.devicePhotoState = pending ? 'starting' : provider.active ? 'ready' : enabled ? 'stopped' : 'off';
    viewport.classList.toggle('device-photo-fullscreen', enabled);
    overlay.classList.toggle('device-photo-active', enabled);
    panel.hidden = !enabled;
    toggle.textContent = pending ? '取消开启' : provider.active ? '退出合影' : enabled ? '开启相机' : '与我合影';
    stateText.textContent = pending ? '正在开启相机…' : provider.active ? '拖动画面移动小猫' : '相机已关闭';
    for (const button of [switchButton, mirrorButton, resetButton, smaller, larger, rotateLeft, rotateRight]) button.disabled = pending || !provider.active;
    switchButton.hidden = !canSwitch;
    mirrorButton.textContent = `自拍镜像：${mirror ? '开' : '关'}`; mirrorButton.setAttribute('aria-pressed', String(mirror));
    onChange();
  }
  function stopCamera() { ++epoch; pending = false; session.stop(); provider.stop(); sync(); }
  async function start(nextFacing = facing, deviceId) {
    if (disposed || !isOpen()) return;
    enabled = true; pending = true; const current = ++epoch;
    beforeStart(); session.suspend(); sync(); statusEl.textContent = '';
    try {
      const source = await provider.start({facingMode: nextFacing, deviceId});
      if (disposed || !isOpen() || current !== epoch) return;
      facing = source.facingMode === 'environment' ? 'environment' : 'user'; mirror = facing === 'user';
      currentDeviceId = source.deviceId;
      if (session.active) session.setSource(source.video, mirror); else session.start(source.video, mirror);
      statusEl.textContent = '调整好位置后点击拍照，即可保存。';
      // Enumerate only after permission; single-camera devices need no switch control.
      void navigator.mediaDevices?.enumerateDevices?.().then(devices => {
        if (disposed || current !== epoch) return;
        cameras = devices.filter(device => device.kind === 'videoinput');
        canSwitch = cameras.length > 1; sync();
      }).catch(() => {});
    } catch (error) {
      if (current !== epoch || disposed) return;
      session.stop(); statusEl.textContent = cameraErrorMessage(error);
    } finally { if (current === epoch && !disposed) { pending = false; sync(); } }
  }
  function leave() { enabled = false; stopCamera(); statusEl.textContent = ''; }
  toggle.addEventListener('click', () => { if (pending || provider.active) leave(); else void start(); });
  switchButton.addEventListener('click', () => {
    const nextFacing = facing === 'user' ? 'environment' : 'user';
    const alternatives = cameras.filter(device => device.deviceId !== currentDeviceId);
    const label = nextFacing === 'environment' ? /back|rear|environment|后置/i : /front|user|前置/i;
    const next = alternatives.find(device => label.test(device.label)) || alternatives[0];
    void start(nextFacing, next?.deviceId);
  });
  mirrorButton.addEventListener('click', () => { mirror = !mirror; session.setMirror(mirror); sync(); });
  resetButton.addEventListener('click', () => session.resetView());
  smaller.addEventListener('click', () => session.zoom(1 / 1.2));
  larger.addEventListener('click', () => session.zoom(1.2));
  rotateLeft.addEventListener('click', () => session.rotate(-Math.PI / 12));
  rotateRight.addEventListener('click', () => session.rotate(Math.PI / 12));
  const visibility = () => {
    if (document.hidden && (pending || provider.active)) {
      stopCamera(); statusEl.textContent = '离开页面后相机已关闭；回来后请点击“开启相机”。';
    }
  };
  const pagehide = () => leave();
  const contextLost = () => { stopCamera(); statusEl.textContent = '三维画面已中断，相机已关闭。请刷新后重试。'; };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pagehide);
  sceneCanvas.addEventListener('webglcontextlost', contextLost);
  return {
    get version() { return epoch; },
    get enabled() { return enabled; }, get ready() { return !pending && provider.active && session.active; },
    prepare() { if (!provider.active || !session.active) throw new Error('相机尚未就绪，请重新开启相机。'); session.prepare(); },
    start, reset: leave,
    dispose() {
      if (disposed) return;
      leave(); disposed = true; provider.dispose(); session.dispose();
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pagehide);
      sceneCanvas.removeEventListener('webglcontextlost', contextLost); panel.remove(); toggle.remove();
    },
  };
}
