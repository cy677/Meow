/** Opt-in, local-only orientation input. No storage, network calls or account changes. */
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const angleDelta = (a, b) => ((a - b + 540) % 360 + 360) % 360 - 180;
export function validSample(event) {
  return typeof event.beta === 'number' && typeof event.gamma === 'number'
    && Number.isFinite(event.beta) && Number.isFinite(event.gamma)
    && Math.abs(event.beta) <= 180 && Math.abs(event.gamma) <= 90;
}
/** Small relative tilt, corrected for the screen's current landscape/portrait orientation. */
export function relativeTilt(sample, neutral, screenAngle = 0) {
  if (!validSample(sample) || !validSample(neutral)) return { x: 0, y: 0 };
  const r = (Number.isFinite(screenAngle) ? screenAngle : 0) * Math.PI / 180;
  const dx = angleDelta(sample.gamma, neutral.gamma), dy = angleDelta(sample.beta, neutral.beta);
  const normalize = n => Math.abs(n) <= 1 ? 0 : clamp((n - Math.sign(n)) / 29, -1, 1);
  return { x: normalize(dx * Math.cos(r) + dy * Math.sin(r)), y: normalize(dy * Math.cos(r) - dx * Math.sin(r)) };
}
export function orientationSupport(win, doc) {
  if (!win.isSecureContext) return { code: 'insecure', message: '当前是普通 HTTP。触摸照常可用；倾斜互动需要受信任的 HTTPS。' };
  if (!win.DeviceOrientationEvent) return { code: 'unsupported', message: '当前浏览器没有提供方向传感器，请使用触摸操作。' };
  const policy = doc.permissionsPolicy || doc.featurePolicy;
  if (policy?.allowsFeature && (!policy.allowsFeature('accelerometer') || !policy.allowsFeature('gyroscope'))) {
    return { code: 'blocked', message: '浏览器策略禁止方向传感器，请使用触摸操作。' };
  }
  return { code: 'available', message: '点“开启倾斜”授权后，轻轻倾斜 Pad 改变观看角度。' };
}

export function createOrientationController({ win = window, doc = document, onTilt = () => {}, onState = () => {}, timeoutMs = 7000 } = {}) {
  let enabled = false, disposed = false, listening = false, touching = false;
  let neutral = null, latest = null, watchdog = 0, generation = 0;
  let status = { code: 'off', enabled: false, message: '' };
  const zero = () => onTilt({ x: 0, y: 0 });
  const report = (code, message) => { status = { code, enabled, message }; onState(status); };
  const screenAngle = () => Number.isFinite(win.screen?.orientation?.angle) ? win.screen.orientation.angle : (win.orientation || 0);
  const clearTimer = () => { win.clearTimeout(watchdog); watchdog = 0; };
  function detach() {
    clearTimer();
    if (listening) win.removeEventListener('deviceorientation', sample);
    listening = false; neutral = null; latest = null; zero();
  }
  function armTimer() {
    clearTimer();
    watchdog = win.setTimeout(() => {
      if (!enabled || doc.hidden) return;
      enabled = false; generation++; detach();
      report('no-signal', '未收到有效传感器数据。可检查浏览器权限后重试，触摸仍可使用。');
    }, timeoutMs);
  }
  function sample(event) {
    if (!enabled || disposed || doc.hidden || !validSample(event)) return;
    latest = { beta: event.beta, gamma: event.gamma }; armTimer();
    if (!neutral) neutral = { ...latest };
    if (touching) return;
    onTilt(relativeTilt(latest, neutral, screenAngle()));
    if (status.code !== 'active') report('active', '倾斜已开启。单指和双指操作优先；握姿改变后可点“校准”。');
  }
  function attach() {
    if (listening || !enabled || disposed || doc.hidden) return;
    neutral = null; latest = null; listening = true;
    win.addEventListener('deviceorientation', sample, { passive: true });
    report('waiting', '请轻轻倾斜设备，正在等待方向传感器…'); armTimer();
  }
  function visibility() {
    if (!enabled) return;
    if (doc.hidden) { detach(); report('paused', '页面暂不可见，倾斜输入已暂停。'); }
    else attach();
  }
  function calibrate() {
    neutral = latest ? { ...latest } : null; zero();
    if (enabled) report(latest ? 'active' : 'waiting', latest ? '已以当前握姿重新校准。' : '等待传感器后自动校准。');
  }
  function screenChanged() { neutral = null; latest = null; zero(); }
  function disable() { generation++; enabled = false; touching = false; detach(); report('off', '倾斜已关闭，可以继续触摸操作。'); }
  doc.addEventListener('visibilitychange', visibility);
  win.addEventListener('orientationchange', screenChanged);
  win.screen?.orientation?.addEventListener('change', screenChanged);
  win.addEventListener('pagehide', disable);
  return {
    get state() { return { ...status }; },
    support: () => orientationSupport(win, doc),
    // Must be called directly by the user's click, BEFORE awaiting any other work.
    async enable() {
      if (disposed || enabled) return status;
      const support = orientationSupport(win, doc);
      if (support.code !== 'available') { report(support.code, support.message); return status; }
      const ticket = ++generation;
      report('requesting', '请在浏览器提示中允许方向传感器。');
      try {
        const request = win.DeviceOrientationEvent.requestPermission;
        const permission = typeof request === 'function'
          ? await request.call(win.DeviceOrientationEvent) : 'granted';
        if (ticket !== generation || disposed) return status;
        if (permission !== 'granted') { report('denied', '未获得方向传感器权限。仍可触摸旋转、缩放和操作奖励。'); return status; }
        enabled = true;
        if (doc.hidden) report('paused', '页面暂不可见，倾斜输入已暂停。'); else attach();
      } catch {
        if (ticket === generation && !disposed) report('denied', '浏览器没有允许倾斜输入。请检查权限后重试，或继续触摸操作。');
      }
      return status;
    },
    disable, calibrate,
    setTouching(value) {
      if (touching === value) return;
      touching = value;
      if (value) { zero(); if (enabled) report('touching', '正在触摸操作，倾斜暂时让位。'); }
      else if (enabled) calibrate();
    },
    dispose() {
      if (disposed) return;
      disable(); disposed = true;
      doc.removeEventListener('visibilitychange', visibility);
      win.removeEventListener('orientationchange', screenChanged);
      win.screen?.orientation?.removeEventListener('change', screenChanged);
      win.removeEventListener('pagehide', disable);
    },
  };
}
