import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createDeviceCameraProvider, cameraErrorMessage} from '../../src/camera/deviceCamera.js';
import {createPhotoSession} from '../../src/camera/photoSession.js';
import {videoUvTransform} from '../../src/camera/framing.js';
import {drawCardDecor, getShareCardDescriptor, getShareCardFilename, CARD_COPY} from '../../src/camera/cardArtwork.js';
import {cameraPermissionsPolicy} from '../api/cameraPolicy.mjs';

class Track extends EventTarget {
  constructor(facingMode='user') { super(); this.facingMode=facingMode; this.stopped=0; }
  stop() { ++this.stopped; }
  getSettings() { return {facingMode:this.facingMode}; }
}
function stream(facingMode='user') {
  const track=new Track(facingMode);
  return {track,getTracks:()=>[track],getVideoTracks:()=>[track]};
}
class Video extends EventTarget {
  constructor(ready=true) { super(); this.readyState=ready?2:0; this.videoWidth=ready?1280:0; this.videoHeight=ready?720:0; this.attrs={}; this.removed=false; }
  setAttribute(key,value) { this.attrs[key]=value; }
  play() { return Promise.resolve(); }
  pause() { this.paused=true; }
  remove() { this.removed=true; }
  ready() { this.readyState=2; this.videoWidth=1280; this.videoHeight=720; this.dispatchEvent(new Event('loadeddata')); }
}
const turn=()=>new Promise(r=>setTimeout(r,0));
function fixture(overrides={}) {
  const requests=[],streams=[],videos=[];
  const mediaDevices={getUserMedia(options){requests.push(options);const value=stream(options.video.facingMode.ideal);streams.push(value);return Promise.resolve(value);}};
  const provider=createDeviceCameraProvider({secureContext:true,mediaDevices,createVideo(){const v=new Video();videos.push(v);return v;},...overrides});
  return {provider,requests,streams,videos};
}

function sessionFixture() {
  const scene=new THREE.Scene();scene.background=new THREE.Color('#efe9dd');scene.fog=new THREE.Fog('#efe9dd',14,32);
  const subject=new THREE.Object3D();const room=new THREE.Object3D();scene.add(subject,room);
  const camera=new THREE.PerspectiveCamera(35,4/3,.1,100);camera.position.set(2.9,2.65,4.2);
  const controls={target:new THREE.Vector3(0,.5,0),enableDamping:true,enabled:true,minDistance:.5,maxDistance:28,update(){camera.updateMatrixWorld();}};
  const rect={left:0,top:0,width:800,height:600};
  const canvas={clientHeight:600,getBoundingClientRect:()=>({...rect}),addEventListener(){},removeEventListener(){},setPointerCapture(){},releasePointerCapture(){}};
  const video={videoWidth:1280,videoHeight:720,readyState:2};
  const session=createPhotoSession({scene,camera,controls,sceneCanvas:canvas,frame:canvas,getSubject:()=>subject});
  return {scene,subject,room,camera,controls,canvas,video,session};
}

test('photo: construction never requests permission; explicit start requests video only',async()=>{
  const f=fixture();assert.equal(f.requests.length,0);assert.equal(f.provider.state,'idle');
  assert.throws(()=>f.provider.capture(),/尚未就绪/);
  const result=await f.provider.start();assert.equal(f.requests[0].audio,false);
  assert.equal(f.requests[0].video.facingMode.ideal,'user');assert.equal(result.width,1280);
  assert.equal(result.video.playsInline,true);assert.equal(result.video.muted,true);
  assert.equal(f.provider.capture().video,result.video);
  f.provider.stop();f.provider.stop();assert.equal(f.streams[0].track.stopped,1);
  assert.equal(result.video.srcObject,null);assert.equal(result.video.removed,true);
  f.provider.dispose();f.provider.dispose();assert.equal(f.provider.state,'disposed');
  await assert.rejects(f.provider.start(),/已销毁/);
});

test('photo: insecure, unsupported and invalid-facing failures do not open any track',async()=>{
  let calls=0;const mediaDevices={getUserMedia(){++calls;}};
  const insecure=fixture({secureContext:false,mediaDevices});await assert.rejects(insecure.provider.start(),/HTTPS/);
  const unsupported=fixture({mediaDevices:{}});await assert.rejects(unsupported.provider.start(),/没有可用/);
  const invalid=fixture({mediaDevices});await assert.rejects(invalid.provider.start({facingMode:'sideways'}),/镜头方向/);
  assert.equal(calls,0);
});

test('photo: close before delayed permission grant immediately releases the late stream',async()=>{
  let grant;const value=stream();const f=fixture({mediaDevices:{getUserMedia:()=>new Promise(r=>grant=r)}});
  const pending=assert.rejects(f.provider.start(),{name:'AbortError'});f.provider.stop();await pending;
  grant(value);await turn();assert.ok(value.track.stopped>0);assert.equal(f.videos.length,0);assert.equal(f.provider.state,'idle');
});

test('photo: a superseded permission response cannot replace the newer lens',async()=>{
  const grants=[];const f=fixture({mediaDevices:{getUserMedia:()=>new Promise(r=>grants.push(r))}});
  const old=assert.rejects(f.provider.start(),{name:'AbortError'});
  const current=f.provider.start({facingMode:'environment'});const back=stream('environment');grants[1](back);await current;
  const front=stream();grants[0](front);await old;await turn();
  assert.ok(front.track.stopped>0);assert.equal(back.track.stopped,0);assert.equal(f.provider.facingMode,'environment');f.provider.dispose();
});

test('photo: decoded frame is required; closing while video loads cleans all resources',async()=>{
  const v=new Video(false);const f=fixture({createVideo:()=>v});const starting=f.provider.start();await turn();
  assert.equal(f.provider.state,'starting');assert.throws(()=>f.provider.capture());
  v.ready();await starting;assert.equal(f.provider.state,'ready');f.provider.stop();
  const v2=new Video(false);const g=fixture({createVideo:()=>v2});const pending=assert.rejects(g.provider.start(),{name:'AbortError'});await turn();g.provider.dispose();await pending;
  assert.equal(g.streams[0].track.stopped,1);assert.equal(v2.srcObject,null);
});

test('photo: switching lenses stops the previous stream and keeps no microphone track',async()=>{
  const f=fixture();await f.provider.start();await f.provider.start({facingMode:'environment'});
  assert.equal(f.streams[0].track.stopped,1);assert.equal(f.provider.facingMode,'environment');assert.ok(f.requests.every(r=>r.audio===false));f.provider.dispose();assert.equal(f.streams[1].track.stopped,1);
});

test('photo: selected alternate camera is requested with an exact device id',async()=>{
  const f=fixture();await f.provider.start({facingMode:'environment',deviceId:'rear-camera'});
  assert.equal(f.requests[0].audio,false);
  assert.equal(f.requests[0].video.facingMode.ideal,'environment');
  assert.deepEqual(f.requests[0].video.deviceId,{exact:'rear-camera'});
  f.provider.dispose();
});

test('photo session: rotation is applied only during render and afterRender restores the subject',()=>{
  const f=sessionFixture(),original=f.subject.quaternion.clone(),angle=Math.PI/12;
  f.session.start(f.video,true);f.session.rotate(angle);
  f.scene.onBeforeRender?.();
  const expected=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),angle);
  assert.ok(f.subject.quaternion.angleTo(expected)<1e-10,'render receives the requested 15 degree turn');
  assert.equal(f.room.visible,false,'photo render hides the room');
  f.scene.onAfterRender?.();
  assert.ok(f.subject.quaternion.angleTo(original)<1e-10,'afterRender restores the action quaternion');
  assert.equal(f.room.visible,true,'afterRender restores room visibility');
  f.session.rotate(-angle);f.scene.onBeforeRender?.();
  assert.ok(f.subject.quaternion.angleTo(original)<1e-10,'opposite turn cancels the temporary rotation');
  f.scene.onAfterRender?.();f.session.stop();
});

test('photo session: reset clears rotation, lens replacement keeps it, and stop clears it',()=>{
  const f=sessionFixture(),angle=Math.PI/12,second={...f.video,videoWidth:1920,videoHeight:1080};
  f.session.start(f.video,true);f.session.rotate(angle);f.session.resetView();
  f.scene.onBeforeRender?.();assert.ok(f.subject.quaternion.angleTo(new THREE.Quaternion())<1e-10,'reset removes the turn');f.scene.onAfterRender?.();
  f.session.rotate(angle);f.session.setSource(second,false);f.scene.onBeforeRender?.();
  const expected=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),angle);
  assert.ok(f.subject.quaternion.angleTo(expected)<1e-10,'switching the video source preserves the turn');f.scene.onAfterRender?.();
  f.session.stop();assert.equal(f.session.active,false);assert.ok(f.subject.quaternion.angleTo(new THREE.Quaternion())<1e-10,'stop clears the turn');
});

test('photo: denial, play failure and track interruption release resources and permit retry',async()=>{
  let interrupted=0;const f=fixture({onInterrupted(){++interrupted;}});await f.provider.start();f.streams[0].track.dispatchEvent(new Event('ended'));
  assert.equal(interrupted,1);assert.equal(f.provider.state,'idle');assert.equal(f.streams[0].track.stopped,1);await f.provider.start();f.provider.dispose();
  const denied=fixture({mediaDevices:{getUserMedia:()=>Promise.reject(new DOMException('denied','NotAllowedError'))}});
  await assert.rejects(denied.provider.start(),{name:'NotAllowedError'});assert.equal(denied.provider.state,'idle');
  const v=new Video();v.play=()=>Promise.reject(new Error('play failed'));const broken=fixture({createVideo:()=>v});
  await assert.rejects(broken.provider.start(),/play failed/);assert.equal(broken.streams[0].track.stopped,1);assert.equal(v.removed,true);
  assert.match(cameraErrorMessage(new DOMException('denied','NotAllowedError')),/相机权限/);
});

test('photo: permission timeout releases even a subsequently granted stream',async()=>{
  let grant;const f=fixture({timeoutMs:10,mediaDevices:{getUserMedia:()=>new Promise(r=>grant=r)}});
  await assert.rejects(f.provider.start(),/超时/);const value=stream();grant(value);await turn();assert.ok(value.track.stopped>0);assert.equal(f.provider.state,'idle');
});

test('photo: cover crop centers in the card window; mirroring changes only video U',()=>{
  const canvas={left:0,top:0,width:1024,height:768},frame={left:300,top:100,width:400,height:400};
  const normal=videoUvTransform(1920,1080,canvas,frame,false),flipped=videoUvTransform(1920,1080,canvas,frame,true);
  const x=(frame.left+200)/1024,y=1-(frame.top+200)/768;
  assert.ok(Math.abs(normal.sx*x+normal.tx-.5)<1e-12);assert.ok(Math.abs(normal.sy*y+normal.ty-.5)<1e-12);
  assert.equal(flipped.sx,-normal.sx);assert.equal(flipped.sy,normal.sy);assert.equal(flipped.ty,normal.ty);
  assert.ok(Math.abs(normal.sx*(frame.left/1024)+normal.tx-(1-1080/1920)/2)<1e-12);
  assert.equal(videoUvTransform(0,0,canvas,frame,false),null);
});

test('photo: link bar is absent in card DOM and exported drawing, while descriptor identity stays stable',()=>{
  const text=[];const ctx=new Proxy({}, {get(target,key){if(key==='fillText')return value=>text.push(value);if(key==='createLinearGradient')return()=>({addColorStop(){}});return target[key]??(()=>{});},set(target,key,value){target[key]=value;return true;}});
  const descriptor=getShareCardDescriptor(42,{base:'#f6dfbd',primary:'#e6913f',secondary:'#ad5d22',accent:'#d99a2b'});
  drawCardDecor(ctx,{cardX:30,cardY:30,cardWidth:1140,cardHeight:1540,windowX:120,windowY:200,windowWidth:950,windowHeight:1000,descriptor,copy:CARD_COPY});
  assert.ok(text.includes('MEOW CARD'));assert.ok(!text.some(s=>/github|ringhyacinth|https?:|↗/i.test(s)));
  assert.equal(getShareCardDescriptor(0).serial,'0052');assert.equal(getShareCardFilename(-42),'meow_card_42.png');
  const source=readFileSync(new URL('../../src/shareCard.js',import.meta.url),'utf8');assert.doesNotMatch(source,/getRepositoryMarkup|share-card-repo/);
});

test('photo: only child documents and the same-origin studio delegate camera permission',()=>{
  for(const route of ['/','/index.html','/studio.html'])assert.match(cameraPermissionsPolicy(route),/^camera=\(self\)/);
  for(const route of ['/parent.html','/api/state','/assets/a.js','/foreign.html'])assert.match(cameraPermissionsPolicy(route),/^camera=\(\)/);
  assert.match(cameraPermissionsPolicy('/'),/microphone=\(\)/);
  const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');assert.match(server,/cameraPermissionsPolicy\(path\)/);
});

test('photo: the device save path contains no album persistence or upload API',()=>{
  const source=readFileSync(new URL('../../src/camera/photoMode.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/localStorage|indexedDB|fetch\s*\(|XMLHttpRequest|sendBeacon|\.download\s*=/);
  assert.doesNotMatch(source,/navigator\.share|navigator\.canShare|revokeObjectURL|存储图像|device-photo-(preview|save|done)/);
  assert.match(readFileSync(new URL('../../src/shareCard.js',import.meta.url),'utf8'),/downloadBlob\(blob, value\.filename\)/);
  assert.match(readFileSync(new URL('../../src/platform.browser.js',import.meta.url),'utf8'),/anchor\.download\s*=\s*filename/);
});
