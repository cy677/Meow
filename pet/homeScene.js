/** The home stage runs the complete original renderer without a second entrance. */
export function createHomeScene(host) {
  const frame = document.createElement('iframe');
  frame.className = 'home-scene';
  frame.title = '小猫互动场景';
  frame.allow = "camera 'self'; web-share 'self'";
  let disposed = false;
  let settled = false;
  let pollTimer;
  let timeoutTimer;
  let photoObserver;
  let resolveReady;
  let rejectReady;

  // A postMessage is a notification, not the source of truth. Check the actual
  // same-origin frame as well, since a one-shot notification can be lost.
  const runtime = () => {
    try {
      const child = frame.contentWindow;
      if (!child || child.location.origin !== location.origin) return null;
      const bridge = child.meowHome;
      if (child.document.body?.dataset.studioReady !== 'true') return null;
      return ['applyState', 'play', 'feature', 'overlay', 'dispose']
        .every(name => typeof bridge?.[name] === 'function') ? bridge : null;
    } catch {
      // A redirected / foreign frame must never be treated as the pet runtime.
      return null;
    }
  };
  function stopWatching() {
    clearInterval(pollTimer);
    clearTimeout(timeoutTimer);
    frame.removeEventListener('load', checkReady);
  }
  function frameStatus() {
    try {
      const child = frame.contentWindow;
      if (!child || child.location.origin !== location.origin) return {};
      const body = child.document.body;
      return { stage: body?.dataset.studioStage || child.document.readyState,
        error: body?.dataset.studioError };
    } catch { return {}; }
  }
  function checkReady() {
    if (disposed || settled) return;
    const status = frameStatus();
    if (status.error) { controller.dispose(new Error(status.error)); return; }
    if (!runtime()) return;
    settled = true;
    host.dataset.ready = 'true';
    const viewport=frame.contentDocument.getElementById('viewport');
    const syncPhoto=()=>{
      document.body.classList.toggle('child-photo-open',viewport?.dataset.shareCardOpen==='true');
      document.body.classList.toggle('child-together-open',viewport?.classList.contains('device-photo-fullscreen'));
    };
    photoObserver=new MutationObserver(syncPhoto);
    if(viewport)photoObserver.observe(viewport,{attributes:true,attributeFilter:['data-share-card-open','class']});
    syncPhoto();
    stopWatching();
    resolveReady(controller);
  }
  function message(event) {
    if (disposed || event.origin !== location.origin || event.source !== frame.contentWindow) return;
    if (event.data?.type === 'meow:ready') checkReady();
    if (event.data?.type === 'meow:error') {
      controller.dispose(new Error(typeof event.data.message === 'string' ? event.data.message : '小猫场景未能载入'));
    }
  }
  const overlay = event => runtime()?.overlay(event.detail);
  const controller = {
    applyState(state) { if (!disposed) runtime()?.applyState(state); },
    play(action, motion) { if (!disposed) runtime()?.play(action, motion); },
    feature(name) { if (!disposed) runtime()?.feature(name); },
    dispose(reason = new Error('小猫场景已关闭')) {
      if (disposed) return;
      disposed = true;
      stopWatching();
      photoObserver?.disconnect();
      document.body.classList.remove('child-photo-open','child-together-open');
      window.removeEventListener('message', message);
      host.removeEventListener('meow:overlay-change', overlay);
      try { runtime()?.dispose(); } catch { /* Removing the frame must still succeed. */ }
      frame.remove();
      delete host.dataset.ready;
      if (!settled) { settled = true; rejectReady(reason); }
    },
  };
  controller.ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  window.addEventListener('message', message);
  host.addEventListener('meow:overlay-change', overlay);
  frame.addEventListener('load', checkReady);
  pollTimer = setInterval(checkReady, 250);
  timeoutTimer = setTimeout(() => {
    controller.dispose(new Error(`小猫场景载入超时（阶段：${frameStatus().stage || 'unknown'}），请刷新页面重试；积分与收藏仍然保留。`));
  }, 60000);
  frame.src = './studio.html?embedded=1';
  host.append(frame);
  checkReady();
  return controller;
}
