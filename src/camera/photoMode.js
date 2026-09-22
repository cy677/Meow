import {createDeviceCameraProvider, cameraErrorMessage} from './deviceCamera.js';
import {createPhotoSession} from './photoSession.js';

/** UI for a single in-memory photo; deliberately no album, upload or download. */
export function createDevicePhotoMode({overlay, viewport, scene, camera, controls, sceneCanvas, frame, getSubject, statusEl, isOpen, beforeStart, onChange}) {
  const styleUrl = new URL('./photo.css?no-inline', import.meta.url).href;
  if (![...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === styleUrl)) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = styleUrl; document.head.append(link);
  }
  const panel = document.createElement('section'); panel.className = 'device-photo-panel';
  panel.setAttribute('aria-label', '与小猫合影');
  panel.innerHTML = `<button type="button" class="device-photo-toggle">与我合影</button>
    <div class="device-photo-options" hidden>
      <p class="device-photo-state" role="status"></p>
      <button type="button" class="device-photo-switch">切换前后镜头</button>
      <button type="button" class="device-photo-mirror" aria-pressed="true">自拍镜像：开</button>
      <button type="button" class="device-photo-reset">还原构图</button>
      <p>单指移动小猫，双指调整大小。照片仅在本机生成，不上传服务器。</p>
    </div>`;
  const preview = document.createElement('section'); preview.className = 'device-photo-preview'; preview.hidden = true;
  preview.setAttribute('role', 'dialog'); preview.setAttribute('aria-modal', 'true'); preview.setAttribute('aria-label', '照片预览');
  preview.innerHTML = `<img class="device-photo-image" alt="本次小猫纪念照片，可长按存储到照片">
    <div class="device-photo-preview-actions"><button type="button" class="device-photo-save">存储到 iPad 照片</button>
    <button type="button" class="device-photo-retake">重拍</button><button type="button" class="device-photo-done">返回取景</button></div>
    <p class="device-photo-save-status" role="status">点击存储后，在系统菜单选择“存储图像”；也可长按图片存储。网页不保存副本。</p>`;
  overlay.append(panel, preview);
  const toggle = panel.querySelector('.device-photo-toggle'), options = panel.querySelector('.device-photo-options');
  const switchButton = panel.querySelector('.device-photo-switch'), mirrorButton = panel.querySelector('.device-photo-mirror');
  const resetButton = panel.querySelector('.device-photo-reset'), stateText = panel.querySelector('.device-photo-state');
  const image = preview.querySelector('img'), saveButton = preview.querySelector('.device-photo-save');
  const saveStatus = preview.querySelector('.device-photo-save-status');
  const session = createPhotoSession({scene, camera, controls, sceneCanvas, frame, getSubject});
  let enabled = false, pending = false, disposed = false, epoch = 0, facing = 'user', mirror = true;
  let result = null, objectUrl = null, sharing = false;
  const provider = createDeviceCameraProvider({host: viewport, onInterrupted(error) {
    stopCamera(); statusEl.textContent = cameraErrorMessage(error);
  }});
  function sync() {
    viewport.dataset.devicePhotoState = pending ? 'starting' : provider.active ? 'ready' : result ? 'preview' : enabled ? 'stopped' : 'off';
    options.hidden = !enabled;
    toggle.textContent = pending ? '取消开启' : provider.active ? '关闭相机' : enabled ? '开启相机' : '与我合影';
    stateText.textContent = pending ? '正在开启相机，请确认 Safari 权限…' : provider.active ? '相机已开启' : '相机已关闭';
    for (const button of [switchButton, mirrorButton, resetButton]) button.disabled = pending || !provider.active;
    mirrorButton.textContent = `自拍镜像：${mirror ? '开' : '关'}`; mirrorButton.setAttribute('aria-pressed', String(mirror));
    onChange();
  }
  function clearResult() {
    preview.hidden = true; image.removeAttribute('src');
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null; result = null; sharing = false; saveButton.disabled = false;
  }
  function stopCamera() { ++epoch; pending = false; session.stop(); provider.stop(); sync(); }
  async function start(nextFacing = facing) {
    if (disposed || !isOpen()) return;
    clearResult(); enabled = true; pending = true; const current = ++epoch;
    beforeStart(); session.suspend(); sync(); statusEl.textContent = '';
    try {
      const source = await provider.start({facingMode: nextFacing});
      if (disposed || !isOpen() || current !== epoch) return;
      facing = source.facingMode === 'environment' ? 'environment' : 'user'; mirror = facing === 'user';
      if (session.active) session.setSource(source.video, mirror); else session.start(source.video, mirror);
      statusEl.textContent = '相机已开启。调整好位置后点击拍照。';
    } catch (error) {
      if (current !== epoch || disposed) return;
      session.stop(); statusEl.textContent = cameraErrorMessage(error);
    } finally { if (current === epoch && !disposed) { pending = false; sync(); } }
  }
  function leave() { enabled = false; clearResult(); stopCamera(); statusEl.textContent = ''; }
  toggle.addEventListener('click', () => { if (pending || provider.active) leave(); else void start(); });
  switchButton.addEventListener('click', () => void start(facing === 'user' ? 'environment' : 'user'));
  mirrorButton.addEventListener('click', () => { mirror = !mirror; session.setMirror(mirror); sync(); });
  resetButton.addEventListener('click', () => session.resetView());
  preview.querySelector('.device-photo-retake').addEventListener('click', () => { if (result?.devicePhoto) void start(); else leave(); });
  preview.querySelector('.device-photo-done').addEventListener('click', leave);
  saveButton.addEventListener('click', async () => {
    if (!result || sharing) return;
    const currentResult = result;
    try {
      const file = new File([result.blob], result.filename, {type: result.blob.type || 'image/png'});
      if (!navigator.share || !navigator.canShare?.({files: [file]})) {
        saveStatus.textContent = '此浏览器没有文件分享功能。请长按上方照片，选择“存储到照片”或“存储图像”。'; return;
      }
      sharing = true; saveButton.disabled = true;
      // Called directly by this click; no encoding or network await before share.
      await navigator.share({files: [file], title: '与小猫合影'});
      if (result === currentResult) saveStatus.textContent = '已返回页面。请确认你在系统菜单中选择了“存储图像”；网页无法读取系统相册确认结果。';
    } catch (error) {
      if (result === currentResult) saveStatus.textContent = error?.name === 'AbortError'
        ? '已取消系统操作，照片仍在本页，可再次点击存储或长按图片。'
        : '系统菜单未能打开。请长按照片，选择“存储到照片”或“存储图像”。';
    } finally { if (result === currentResult) { sharing = false; saveButton.disabled = false; } }
  });
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
    get hasPreview() { return Boolean(result); },
    prepare() { if (!provider.active || !session.active) throw new Error('相机尚未就绪，请重新开启相机。'); session.prepare(); },
    showPreview(value) {
      clearResult(); result = value; objectUrl = URL.createObjectURL(value.blob); image.src = objectUrl;
      preview.hidden = false; saveStatus.textContent = '点击存储后，在系统菜单选择“存储图像”；也可长按图片存储。网页不保存副本。';
      stopCamera(); saveButton.focus({preventScroll: true});
    },
    reset: leave,
    dispose() {
      if (disposed) return;
      leave(); disposed = true; provider.dispose(); session.dispose();
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pagehide);
      sceneCanvas.removeEventListener('webglcontextlost', contextLost); panel.remove(); preview.remove();
    },
  };
}
