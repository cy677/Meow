/** Device frames are kept in memory only. No storage, upload or microphone. */
const abortError = () => new DOMException('相机操作已取消', 'AbortError');
const stopTracks = stream => stream?.getTracks().forEach(track => track.stop());

function abortable(promise, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (callback, value) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => finish(reject, abortError());
    if (signal.aborted) { reject(abortError()); return; }
    signal.addEventListener('abort', abort, {once: true});
    timer = setTimeout(() => finish(reject, new Error('相机启动超时，请确认权限后重试')), timeoutMs);
    Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

/** Wait for an actual decoded frame, not merely permission or loadedmetadata. */
function firstFrame(video, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      for (const type of ['loadeddata', 'canplay', 'resize', 'playing']) video.removeEventListener(type, ready);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
    };
    const ready = () => {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) { cleanup(); resolve(); }
    };
    const failed = () => { cleanup(); reject(new Error('摄像画面未能播放，请重试')); };
    const aborted = () => { cleanup(); reject(abortError()); };
    if (signal.aborted) { reject(abortError()); return; }
    for (const type of ['loadeddata', 'canplay', 'resize', 'playing']) video.addEventListener(type, ready);
    video.addEventListener('error', failed);
    signal.addEventListener('abort', aborted, {once: true});
    timer = setTimeout(failed, timeoutMs);
    ready();
  });
}

export function cameraErrorMessage(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return '相机权限未获允许。请检查 Safari 网站相机权限，以及服务器和 iframe 的 camera 策略。';
  if (error?.name === 'NotFoundError') return '没有找到可用摄像头。';
  if (error?.name === 'NotReadableError') return '摄像头暂不可用，请关闭占用相机的应用后重试。';
  if (error?.name === 'OverconstrainedError') return '当前镜头不支持所请求的设置，请重新开启相机。';
  return error?.message || '相机启动失败，请重试。';
}

export function createDeviceCameraProvider({
  host,
  mediaDevices = globalThis.navigator?.mediaDevices,
  secureContext = globalThis.isSecureContext,
  createVideo = () => document.createElement('video'),
  timeoutMs = 15000,
  onInterrupted = () => {},
} = {}) {
  let stream = null, video = null, operation = null, ended = null;
  let disposed = false, state = 'idle', facing = 'user';
  function stop() {
    operation?.abort(); operation = null;
    if (ended) stream?.getVideoTracks().forEach(track => track.removeEventListener('ended', ended));
    ended = null;
    stopTracks(stream); stream = null;
    if (video) { video.pause(); video.srcObject = null; video.remove(); video = null; }
    state = disposed ? 'disposed' : 'idle';
  }
  async function start({facingMode = 'user'} = {}) {
    if (disposed) throw new Error('相机提供者已销毁');
    if (!['user', 'environment'].includes(facingMode)) throw new TypeError('不支持的镜头方向');
    stop();
    if (!secureContext) throw new Error('摄像头需要浏览器信任的 HTTPS 连接；不能只跳过证书警告。');
    if (!mediaDevices?.getUserMedia) throw new Error('当前浏览器没有可用的摄像头接口，请使用 Safari 和可信 HTTPS。');
    const current = new AbortController(); operation = current; state = 'starting';
    try {
      // A browser permission prompt cannot be aborted. Release even a late grant.
      const requested = Promise.resolve(mediaDevices.getUserMedia({audio: false, video: {
        facingMode: {ideal: facingMode}, width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 30, max: 30},
      }}));
      requested.then(value => { if (current.signal.aborted || operation !== current) stopTracks(value); }, () => {});
      const value = await abortable(requested, current.signal, timeoutMs);
      if (current.signal.aborted || operation !== current) { stopTracks(value); throw abortError(); }
      stream = value;
      const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
      facing = settings.facingMode || facingMode;
      video = createVideo();
      video.className = 'device-camera-source'; video.muted = true; video.autoplay = true; video.playsInline = true;
      video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.setAttribute('aria-hidden', 'true');
      video.srcObject = stream; host?.append(video);
      await abortable(video.play(), current.signal, timeoutMs);
      await firstFrame(video, current.signal, timeoutMs);
      if (current.signal.aborted || operation !== current) throw abortError();
      ended = () => { stop(); onInterrupted(new Error('摄像头已中断，请点击“开启相机”重新连接。')); };
      stream.getVideoTracks().forEach(track => track.addEventListener('ended', ended));
      state = 'ready';
      return {video, facingMode: facing, width: video.videoWidth, height: video.videoHeight};
    } catch (error) {
      if (operation === current) stop();
      throw error;
    }
  }
  return {
    id: 'device', capabilities: Object.freeze({deviceCamera: true, sceneCapture: false}),
    get active() { return state === 'ready'; }, get state() { return state; },
    get video() { return video; }, get facingMode() { return facing; },
    start, stop,
    capture() {
      if (state !== 'ready' || !video) throw new Error('相机画面尚未就绪');
      return {video, width: video.videoWidth, height: video.videoHeight, facingMode: facing};
    },
    dispose() { if (disposed) return; disposed = true; stop(); },
  };
}
