import { createOrientationController } from './orientation.mjs';

/** Accessible buttons also work without sensors and never call a reward/account API. */
export function createSceneControls(host, { resetView, zoom, setTilt, petAt }) {
  const child = host.id === 'pet-scene';
  const toolbar = document.createElement('section'); toolbar.className = 'tablet-controls';
  toolbar.setAttribute('aria-label', '小猫观看操作');
  toolbar.innerHTML = `<div class="tablet-buttons">
    <button type="button" class="button small" data-tablet="reset">视角复位</button>
    <button type="button" class="button small" data-tablet="zoom-in" aria-label="放大小猫视图">放大 ＋</button>
    <button type="button" class="button small" data-tablet="zoom-out" aria-label="缩小小猫视图">缩小 −</button>
    ${child ? '<button type="button" class="button small" data-tablet="tilt" aria-pressed="false">开启倾斜</button><button type="button" class="button small" data-tablet="calibrate" disabled>校准</button>' : ''}
    </div><p class="tablet-hint">单指转动 · 双指缩放${child ? ' · 轻触小猫' : ''}。在画面外滑动可滚动页面。</p>
    <p class="tablet-status" role="status" aria-live="polite"></p>`;
  host.after(toolbar);
  const status = toolbar.querySelector('.tablet-status'), toggle = toolbar.querySelector('[data-tablet=tilt]');
  const calibration = toolbar.querySelector('[data-tablet=calibrate]');
  let disposed = false;
  function onState(state) {
    status.textContent = state.message; toolbar.dataset.tiltState = state.code;
    toggle?.setAttribute('aria-pressed', String(state.enabled));
    if (toggle) {
      toggle.disabled = state.code === 'requesting';
      toggle.textContent = state.enabled ? '关闭倾斜' : '开启倾斜';
    }
    if (calibration) calibration.disabled = !state.enabled;
  }
  const tilt = child ? createOrientationController({ onTilt: setTilt, onState }) : null;
  if (tilt) {
    const support = tilt.support();
    onState({ ...support, enabled: false });
    if (support.code !== 'available') { toggle.disabled = true; toggle.textContent = support.code === 'insecure' ? '倾斜需 HTTPS' : '倾斜不可用'; }
  } else status.hidden = true;
  const clicks = event => {
    const button = event.target.closest('[data-tablet]'); if (!button || disposed) return;
    switch (button.dataset.tablet) {
      case 'reset': resetView(); tilt?.calibrate(); break;
      case 'zoom-in': zoom(0.85); break;
      case 'zoom-out': zoom(1 / 0.85); break;
      case 'calibrate': tilt?.calibrate(); break;
      case 'tilt': if (tilt.state.enabled) tilt.disable(); else void tilt.enable(); break;
    }
  };
  toolbar.addEventListener('click', clicks);
  const canvas = host.querySelector('canvas'), pointers = new Set();
  let tap = null;
  function down(event) {
    if (event.button !== 0) return;
    pointers.add(event.pointerId); tilt?.setTouching(true);
    if (pointers.size === 1) tap = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now() };
    else tap = null;
  }
  function move(event) { if (tap && (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 8)) tap = null; }
  function end(event) {
    if (child && tap?.id === event.pointerId && event.type === 'pointerup'
      && pointers.size === 1 && performance.now() - tap.at < 350
      && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= 8) {
      if (petAt(event.clientX, event.clientY)) status.textContent = '轻轻摸到小猫啦。';
    }
    tap = null; pointers.delete(event.pointerId);
    if (!pointers.size) tilt?.setTouching(false);
  }
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, end);
  const contextMenu = event => event.preventDefault(); canvas.addEventListener('contextmenu', contextMenu);
  const clearGesture = () => { pointers.clear(); tap = null; tilt?.setTouching(false); };
  const hidden = () => { if (document.hidden) clearGesture(); };
  document.addEventListener('visibilitychange', hidden);
  // The application hides its workspace on logout; stop sensors even if the scene is retained.
  const workspace = child ? document.getElementById('workspace') : null;
  const observer = workspace ? new MutationObserver(() => { if (workspace.hidden) { clearGesture(); tilt?.disable(); } }) : null;
  observer?.observe(workspace, { attributes: true, attributeFilter: ['hidden'] });
  return {
    dispose() {
      if (disposed) return; disposed = true; observer?.disconnect(); tilt?.dispose();
      document.removeEventListener('visibilitychange', hidden);
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.removeEventListener(type, end);
      canvas.removeEventListener('contextmenu', contextMenu); toolbar.removeEventListener('click', clicks); toolbar.remove();
    },
  };
}
