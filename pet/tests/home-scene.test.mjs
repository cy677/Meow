import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeScene } from '../homeScene.js';

function harness() {
  class Target {
    listeners = new Map();
    dataset = {};
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    emit(type, detail = {}) { for (const listener of this.listeners.get(type) || []) listener(detail); }
  }
  const origin = 'http://127.0.0.1:8792';
  const calls = [];
  const bridge = Object.fromEntries(['applyState', 'play', 'feature', 'overlay', 'dispose']
    .map(name => [name, (...args) => calls.push([name, ...args])]));
  const frame = new Target();
  const viewport = new Target(), classes = new Set(), viewportClasses = new Set(), observers=[];
  viewport.classList = {contains(name){return viewportClasses.has(name);},toggle(name,on){if(on)viewportClasses.add(name);else viewportClasses.delete(name);}};
  const body = {classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);},remove(name){classes.delete(name);}}};
  const child = { location: { origin }, document: { body: { dataset: {} } } };
  frame.contentDocument={getElementById:id=>id==='viewport'?viewport:null};
  frame.contentWindow = child;
  frame.remove = () => { frame.removed = true; };
  const win = new Target();
  const host = new Target();
  host.append = item => { host.frame = item; };
  const intervals = new Map(), timeouts = new Map();
  let counter = 0;
  const replacements = {
    window: win,
    document: { body, createElement: tag => { assert.equal(tag, 'iframe'); return frame; } },
    MutationObserver: class {constructor(callback){this.callback=callback;observers.push(this);}observe(){this.active=true;}disconnect(){this.active=false;}},
    location: { origin },
    setInterval: fn => { intervals.set(++counter, fn); return counter; },
    clearInterval: id => intervals.delete(id),
    setTimeout: fn => { timeouts.set(++counter, fn); return counter; },
    clearTimeout: id => timeouts.delete(id),
  };
  const saved = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const scene = createHomeScene(host);
  // Tests attach a rejection handler before exercising close/error paths.
  scene.ready.catch(() => {});
  return {
    scene, host, frame, child, bridge, calls, intervals, timeouts, win, origin, viewport, classes, viewportClasses, observers,
    ready() { child.document.body.dataset.studioReady = 'true'; child.meowHome = bridge; },
    notify({ origin: senderOrigin = origin, source = child, data = {type: 'meow:ready'} } = {}) { win.emit('message', {origin: senderOrigin, source, data}); },
    tick() { for (const fn of [...intervals.values()]) fn(); },
    restore() {
      scene.dispose();
      for (const [key, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

test('home scene: missed readiness message is recovered from the actual same-origin runtime', async () => {
  const h = harness();
  try {
    assert.equal(h.host.dataset.ready, undefined);
    h.frame.emit('load');
    assert.equal(h.host.dataset.ready, undefined, 'load alone is not readiness');
    h.ready();
    h.tick();
    assert.equal(await h.scene.ready, h.scene);
    assert.equal(h.host.dataset.ready, 'true');
    assert.equal(h.intervals.size, 0);
    assert.equal(h.timeouts.size, 0);
    h.scene.applyState({balance: 2}); h.scene.play('idle', {}); h.scene.feature('capture');
    h.host.emit('meow:overlay-change', {detail: true});
    assert.deepEqual(h.calls.map(c => c[0]), ['applyState', 'play', 'feature', 'overlay']);
  } finally { h.restore(); }
});

test('home scene: validated message/load requires a fully initialized bridge', async () => {
  const h = harness();
  try {
    h.notify();
    h.child.document.body.dataset.studioReady = 'true';
    h.notify();
    assert.equal(h.host.dataset.ready, undefined);
    h.ready();
    h.notify({origin:'https://untrusted.example'});
    h.notify({source:{}});
    assert.equal(h.host.dataset.ready, undefined);
    h.frame.emit('load');
    await h.scene.ready;
    assert.equal(h.host.dataset.ready, 'true');
  } finally { h.restore(); }
});

test('home scene: a foreign frame cannot become ready or receive pet commands', () => {
  const h = harness();
  try {
    h.ready(); h.child.location.origin = 'https://untrusted.example';
    h.tick(); h.notify(); h.scene.feature('capture');
    assert.equal(h.host.dataset.ready, undefined);
    assert.deepEqual(h.calls, []);
    Object.defineProperty(h.frame, 'contentWindow', {get() { throw new Error('SecurityError'); }});
    assert.doesNotThrow(() => h.tick());
  } finally { h.restore(); }
});

test('home scene: early disposal rejects pending readiness and cleans listeners and timers', async () => {
  const h = harness();
  try {
    h.scene.dispose();
    await assert.rejects(h.scene.ready, /已关闭/);
    h.ready(); h.tick(); h.notify();
    assert.equal(h.host.dataset.ready, undefined);
    assert.equal(h.frame.removed, true);
    assert.equal(h.win.listeners.get('message').size, 0);
    assert.equal(h.intervals.size + h.timeouts.size, 0);
  } finally { h.restore(); }
});

test('home scene: timeout and authenticated runtime error are failures, not fake readiness', async () => {
  const timed = harness();
  try {
    for (const fn of [...timed.timeouts.values()]) fn();
    await assert.rejects(timed.scene.ready, /超时/);
    assert.equal(timed.frame.removed, true);
  } finally { timed.restore(); }
  const errored = harness();
  try {
    errored.notify({origin:'https://untrusted.example', data:{type:'meow:error',message:'foreign'}});
    assert.equal(errored.frame.removed, undefined);
    errored.notify({data:{type:'meow:error',message:'登录已过期'}});
    await assert.rejects(errored.scene.ready, /登录已过期/);
    assert.equal(errored.frame.removed, true);
  } finally { errored.restore(); }
});

test('home scene: runtime error is detected even when its error notification is lost', async () => {
  const h = harness();
  try {
    h.child.document.body.dataset.studioStage = 'failed';
    h.child.document.body.dataset.studioError = '场景参数无法载入';
    h.tick();
    await assert.rejects(h.scene.ready, /场景参数无法载入/);
    assert.equal(h.frame.removed, true);
    assert.equal(h.host.dataset.ready, undefined);
  } finally { h.restore(); }
});

test('home scene: photo overlay hides family controls and restores them on close or disposal', async()=>{
  const h=harness();try{h.ready();h.tick();await h.scene.ready;
    assert.equal(h.classes.has('child-photo-open'),false);
    h.viewport.dataset.shareCardOpen='true';h.observers[0].callback();assert.equal(h.classes.has('child-photo-open'),true);
     h.viewport.dataset.shareCardOpen='false';h.observers[0].callback();assert.equal(h.classes.has('child-photo-open'),false);
     h.viewport.classList.toggle('device-photo-fullscreen',true);h.observers[0].callback();assert.equal(h.classes.has('child-together-open'),true);
     h.viewport.classList.toggle('device-photo-fullscreen',false);h.observers[0].callback();assert.equal(h.classes.has('child-together-open'),false);
     h.viewport.dataset.shareCardOpen='true';h.observers[0].callback();h.scene.dispose();assert.equal(h.classes.has('child-photo-open'),false);assert.equal(h.observers[0].active,false);
  }finally{h.restore();}
});
