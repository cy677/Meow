/** Run the real lifecycle entrypoints against a small DOM/runtime harness.
 * Rendering stays in the production WebGL regressions; these tests reproduce
 * late pagehide/visibility/fetch ordering without timers or a GPU dependency.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

class Target {
  listeners=new Map();children=[];dataset={};style={setProperty(){}};
  classList={add(){},remove(){},toggle(){}};
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  dispatchEvent(event){for(const fn of [...(this.listeners.get(event.type)||[])])fn(event);}
  append(...children){this.children.push(...children);}
  setAttribute(){}
  querySelectorAll(){return [];}
  getBoundingClientRect(){return {height:30};}
  remove(){this.removed=true;}
  click(){this.dispatchEvent({type:'click'});}
}
function dom(){
  const elements=new Map(),window=new Target(),document=new Target();
  document.body=new Target();document.hidden=false;
  document.createElement=()=>new Target();
  document.getElementById=id=>{if(!elements.has(id))elements.set(id,new Target());return elements.get(id);};
  document.querySelector=()=>null;document.querySelectorAll=()=>[];
  window.parent={postMessage(){}};
  return {document,window,elements};
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
const response=(value,ok=true,status=200)=>({ok,status,json:async()=>value});
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const stripImports=text=>text.replace(/^import .*;\r?\n/gm,'');

function homeHarness(){
  const env=dom(),frames=new Map(),calls=[];let serial=0,locked=false;
  const initial={params:{},camera:{}};
  const runtime={};
  for(const name of ['capture','clearKeys','stop','resetView','resetRoom','restore','applyModels','applyRoom','setAccess','playProgram','disposeModels','motionState','modelDiagnostics']){
    runtime[name]=()=>{if(locked)throw new Error('released runtime: '+name);calls.push(name);return name==='capture'?initial:name==='motionState'?{active:false}:{};};
  }
  const context={...env,performance:{now:()=>0},Math,
    requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id),
    PARAM_FIELDS:{coat:[],shape:[],eyes:[],pose:[]},RUG_CHOICES:[],planMotion:()=>({}),canAutoPlay:()=>true,
    rugSeedForStyle:()=>0,containerSeed:()=>0};
  const code=stripImports(source('homeRuntime.js')).replace('export function mountHomeRuntime','function mountHomeRuntime');
  const mount=runInNewContext(code+'\nmountHomeRuntime;',context);
  const state={params:{},equipped:{},sceneParams:{bed:{kind:'none',placement:'beside'}},rewards:[],access:{actions:[]}};
  const home=mount(runtime,{state},initial);
  return {...env,home,frames,calls,lock:()=>{locked=true;}};
}

test('home disposal is idempotent before and after the shared controller is released',()=>{
  const h=homeHarness();assert.equal(h.frames.size,1);
  h.home.dispose();h.lock();const count=h.calls.length;
  assert.doesNotThrow(()=>{h.home.dispose();h.home.overlay(true);h.home.overlay(false);h.home.play('walk');h.home.feature('reset');h.home.applyState({});});
  assert.equal(h.calls.length,count);assert.equal(h.calls.filter(x=>x==='stop').length,1);
  assert.equal(h.calls.filter(x=>x==='disposeModels').length,1);assert.equal(h.frames.size,0);
  for(const listeners of h.window.listeners.values())assert.equal(listeners.size,0);
});

test('detached photo, camera and animation callbacks cannot touch a disposed home',()=>{
  const h=homeHarness(),frame=[...h.frames.values()][0];
  const photoCallback=[...h.elements.get('btn-export-png').listeners.get('click')][0];
  const controls=h.elements.get('viewport').children[0],camera=controls.children.find(c=>c.id==='child-reset-view');
  const cameraCallback=[...camera.listeners.get('click')][0];
  h.home.dispose();h.lock();const count=h.calls.length;
  assert.doesNotThrow(()=>{photoCallback();cameraCallback();frame(100000);});
  assert.equal(h.calls.length,count);assert.equal(h.frames.size,0);
  assert.equal(camera.listeners.get('click').size,0);assert.equal(controls.removed,true);
});

function studioHarness({fetchOverride,rendererWait}={}){
  const env=dom(),timers=new Map(),calls=[],requests=[],messages=[];let serial=0,locked=false;
  const rendererEntered=deferred();
  const data={revision:'0',preset:{},access:{actions:[]},state:{params:{},version:0}};
  const runtime={};
  for(const name of ['capture','resetRoom','restore','setAccess','clearKeys','stop']){
    runtime[name]=()=>{if(locked)throw new Error('released runtime: '+name);calls.push(name);return {params:{},camera:{}};};
  }
  runtime.lock=()=>{calls.push('lock');locked=true;};
  const home={dispose(){calls.push('home-dispose');runtime.stop();},overlay(){runtime.stop();},applyState(){runtime.setAccess();}};
  env.window.parent.postMessage=message=>messages.push(message);
  const context={...env,URLSearchParams,AbortController,DOMException,console,
    location:{search:'?embedded=1',origin:'http://localhost'},
    ResizeObserver:class {observe(){}disconnect(){calls.push('disconnect');}},
    setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id),
    fetch:async(path,options)=>{
      requests.push({path,options});
      const custom=fetchOverride?.(requests.length,path,options);
      return custom??response(path.endsWith('/session')?{csrf:'test-csrf'}:data);
    },
    loadRenderer:async()=>{calls.push('import-renderer');rendererEntered.resolve();if(rendererWait)await rendererWait;return {petStudio:runtime};},
    loadEditor:async()=>{throw new Error('Child lifecycle test must not load the parent editor');},
    mountHomeRuntime:()=>{calls.push('mount-home');return home;}};
  let code=stripImports(source('studio.js'));
  assert.ok(code.includes("await import('../src/main.js')"));
  code=code.replace("await import('../src/main.js')",'await loadRenderer()')
    .replace("await import('./creationEditor.js')",'await loadEditor()')
    .replace('void startStudio();','await startStudio();');
  const ready=runInNewContext('(async()=>{'+code+'\n})()',context);
  return {...env,calls,requests,messages,timers,data,ready,rendererEntered:rendererEntered.promise,
    pagehide(){env.window.dispatchEvent({type:'pagehide'});},
    poll(){assert.equal(timers.size,1);const [id,fn]=[...timers][0];timers.delete(id);return fn();}};
}

test('pagehide detaches visibility callbacks before locking the animation controller',async()=>{
  const h=studioHarness();await h.ready;assert.equal(h.document.body.dataset.studioReady,'true');
  const visibility=[...h.document.listeners.get('visibilitychange')][0];
  h.pagehide();const count=h.calls.length;
  assert.doesNotThrow(()=>{
    h.pagehide();h.document.hidden=true;h.document.dispatchEvent({type:'visibilitychange'});
    visibility();h.document.hidden=false;visibility();
  });
  assert.equal(h.calls.length,count);assert.equal(h.calls.filter(x=>x==='lock').length,1);
  assert.equal(h.calls.filter(x=>x==='home-dispose').length,1);assert.equal(h.timers.size,0);
  assert.equal(h.document.listeners.get('visibilitychange').size,0);
  assert.equal(h.document.body.dataset.studioReady,undefined);
  assert.ok(h.requests.every(r=>r.options.signal.aborted));
});

for(const status of [200,401])test(`a late ${status} session response cannot restart a closed studio`,async()=>{
  const pending=deferred();
  const h=studioHarness({fetchOverride:n=>n===3?pending.promise:undefined});await h.ready;
  const poll=h.poll();assert.equal(h.requests.length,3);
  h.pagehide();const count=h.calls.length;
  pending.resolve(status===200?response({...h.data,revision:'1'}):response({error:'expired'},false,401));
  await poll;
  assert.equal(h.calls.length,count);assert.equal(h.timers.size,0);
  assert.equal(h.messages.filter(m=>m.type==='meow:error').length,0);
  assert.equal(h.document.body.dataset.studioReady,undefined);
});

test('closing during initial authentication never starts the renderer',async()=>{
  const pending=deferred();
  const h=studioHarness({fetchOverride:n=>n===1?pending.promise:undefined});
  h.pagehide();pending.resolve(response({csrf:'late'}));await h.ready;
  assert.equal(h.calls.includes('import-renderer'),false);assert.equal(h.calls.includes('mount-home'),false);
  assert.equal(h.requests.length,1);assert.equal(h.timers.size,0);assert.equal(h.messages.length,0);
});

test('a renderer import resolved after pagehide is released without mounting a new home',async()=>{
  const pending=deferred(),h=studioHarness({rendererWait:pending.promise});
  await h.rendererEntered;h.pagehide();pending.resolve();await h.ready;
  assert.equal(h.calls.includes('mount-home'),false);assert.equal(h.calls.filter(x=>x==='lock').length,1);
  assert.equal(h.calls.includes('restore'),false);assert.equal(h.timers.size,0);assert.equal(h.messages.length,0);
});

test('live session expiry cleans up once and does not restart polling on later pagehide',async()=>{
  const h=studioHarness({fetchOverride:n=>n===3?response({error:'expired'},false,401):undefined});
  await h.ready;await h.poll();h.pagehide();
  assert.equal(h.document.body.dataset.studioStage,'expired');assert.equal(h.timers.size,0);
  assert.equal(h.calls.filter(x=>x==='lock').length,1);assert.equal(h.calls.filter(x=>x==='home-dispose').length,1);
  assert.equal(h.messages.filter(m=>m.type==='meow:error').length,1);
});

test('repeated visibility callbacks keep only one in-flight session check',async()=>{
  const pending=deferred(),h=studioHarness({fetchOverride:n=>n===3?pending.promise:undefined});await h.ready;
  const poll=h.poll();h.document.dispatchEvent({type:'visibilitychange'});h.document.dispatchEvent({type:'visibilitychange'});
  assert.equal(h.requests.length,3);pending.resolve(response(h.data));await poll;
  assert.equal(h.timers.size,1);h.pagehide();assert.equal(h.timers.size,0);
});
