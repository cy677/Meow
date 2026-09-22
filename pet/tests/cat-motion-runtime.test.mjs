import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CLIPS,SOURCE_CLIPS,AUTHORED_CLIPS,CLIP_BY_ID } from '../../src/catMotion/clipCatalog.js';
import { BONE_NAMES,BONE_PARENT,assertSkeleton } from '../../src/catMotion/skeleton.js';
import { sampleAuthoredPose,authoredGlobalQuaternions } from '../../src/catMotion/authoredPoses.js';
import { planMotion,canAutoPlay } from '../../src/catMotion/motionScript.js';
import { createMotionEvents,markersBetween } from '../../src/catMotion/motionEvents.js';
import { createMotionController } from '../../src/catMotion/motionController.js';
import { createClipPlayer } from '../../src/catMotion/clipPlayer.js';
import { createMotionTimeline } from '../motionTimeline.js';
const data=JSON.parse(readFileSync(new URL('../../src/mesh2motionClips.json',import.meta.url)));
function mock() {
  const calls=[],player={begin(){calls.push('begin');},render(p,t,e){calls.push([p.action,t,e]);},idle(t,w){calls.push(['idle',t,w]);},dispose(){calls.push('dispose');}};
  return {motion:createMotionController(player),calls};
}
function advance(m,seconds) {for(let i=0;i<Math.ceil(seconds/.02);i++)m.update(.02);}

test('one immutable catalog has 14 unchanged sources and 6 separately attributed authored clips',()=>{
 assert.equal(CLIPS.length,20);assert.equal(SOURCE_CLIPS.length,14);assert.equal(AUTHORED_CLIPS.length,6);
 assert.equal(new Set(CLIPS.map(c=>c.id)).size,20);
 assert.deepEqual(SOURCE_CLIPS.map(c=>c.id).sort(),data.clips.map(c=>c.id).sort());
 assert.deepEqual(BONE_NAMES,data.boneOrder);
 for(const c of CLIPS){assert.ok(c.duration>0);assert.ok(Object.isFrozen(c));assert.ok(Object.isFrozen(c.markers));}
 assert.equal(CLIP_BY_ID.set,undefined);
});
test('all six authored clips move multiple joints; one-shots and loops have continuous seams',()=>{
 const signatures=new Set();
 for(const c of AUTHORED_CLIPS) {
  const first=authoredGlobalQuaternions(sampleAuthoredPose(c.id,.18)),second=authoredGlobalQuaternions(sampleAuthoredPose(c.id,.53));
  assert.equal(first.size,19);
  const changes=[...first].filter(([name,q])=>q.angleTo(second.get(name))>1e-4).length;
  assert.ok(changes>=4,`${c.id}: ${changes} changing joints`);
  for(const q of second.values()){assert.ok(q.toArray().every(Number.isFinite));assert.ok(Math.abs(q.length()-1)<1e-7);}
  signatures.add(JSON.stringify([...second.values()].map(q=>q.toArray())));
  const start=authoredGlobalQuaternions(sampleAuthoredPose(c.id,0)),end=authoredGlobalQuaternions(sampleAuthoredPose(c.id,1));
  for(const [name,q] of start)assert.ok(q.angleTo(end.get(name))<1e-7,`${c.id} seam ${name}`);
  for(const q of authoredGlobalQuaternions(sampleAuthoredPose(c.id,.5,0)).values())assert.ok(q.angleTo(new THREE.Quaternion())<1e-7);
 }
 assert.equal(signatures.size,6);
});
test('script plans copy and freeze caller settings and are independent of the account layer',()=>{
 const settings={script:[{clip:'paw',cycles:1}],intensity:1};
 const p=planMotion('sequence',settings,settings.script);settings.script[0].clip='run';
 assert.equal(p.script[0].clip,'paw');assert.equal(p.motion.script[0].clip,'paw');assert.ok(Object.isFrozen(p.segments[0]));
 assert.ok(canAutoPlay('stretch'));assert.ok(!canAutoPlay('climb-up'));
 assert.ok(!canAutoPlay('sequence',{script:[{clip:'walk'},{clip:'mantle'}]}));
});
test('direct runtime calls enforce script/number validation too',()=>{
 for(const args of [['walk',{speed:NaN}],['walk',{height:.01}],['spin',{turns:1.5}],['walk',{eval:'x'}],['walk',null],['walk',{script:[]}],['sequence',{script:[{clip:'paw',cycles:2}]}]])assert.throws(()=>planMotion(...args,args[1]?.script));
});
test('nominal markers cross exactly once, with scaled duration and overlapping repeated segments',()=>{
 const p=planMotion('sequence',{speed:2},[{clip:'scratch',cycles:3,speed:1.5}]);
 const all=markersBetween(p,-Infinity,p.duration);assert.equal(all.length,6);assert.ok(all.every(e=>e.semanticOnly));
 const seen=[];let prev=-Infinity;
 for(const t of [0,.15,.42,.81,p.duration]){seen.push(...markersBetween(p,prev,t));prev=t;}
 assert.deepEqual(seen,all);assert.deepEqual(markersBetween(p,p.duration,p.duration),[]);
});
test('priority queue and protected jump finish before normal interruption',()=>{
 const {motion:m}=mock();const order=[];m.on('started',e=>order.push(e.action));
 m.play('jump',{duration:.6});advance(m,.1);
 assert.equal(m.play('walk',{duration:.6},undefined,{priority:10}).status,'queued');
 m.enqueue('stretch',{duration:.6},undefined,{priority:5});
 advance(m,2.6);assert.deepEqual(order,['jump','walk','stretch']);assert.equal(m.active,false);
});
test('same-priority requests crossfade by default; explicit force can interrupt protected clips',()=>{
 const {motion:m,calls}=mock();m.play('walk');advance(m,.2);m.play('run');assert.equal(m.getState().current.action,'run');
 assert.deepEqual(calls.at(-1),['run',0,0]);m.play('jump');
 m.play('paw',{},undefined,{force:true});assert.equal(m.getState().current.action,'paw');
});
test('suspended playhead resumes without replaying earlier markers',()=>{
 const {motion:m}=mock();const seen=[];m.on('scratch_contact',e=>seen.push(e));
 m.play('scratch',{duration:1.8});advance(m,.62);const t=m.getState().current.elapsed;
 m.play('stretch',{duration:.6},undefined,{priority:10,resumePrevious:true});advance(m,.62);
 assert.equal(m.getState().current.action,'scratch');assert.ok(m.getState().current.elapsed>=t);
 advance(m,2);assert.equal(seen.length,2);assert.equal(new Set(seen.map(e=>e.time)).size,2);
});
test('pause freezes both playhead and markers; resume never catches up hidden elapsed time',()=>{
 const {motion:m}=mock();m.play('paw');advance(m,.2);const t=m.getState().current.elapsed;
 m.pause();m.update(60);assert.equal(m.getState().current.elapsed,t);
 m.resume();m.update(.02);assert.ok(Math.abs(m.getState().current.elapsed-t-.02)<1e-9);
});
test('stop clears queue and suspended actions and returns smoothly; cancel is immediate',()=>{
 const {motion:m}=mock();m.play('walk');m.play('paw',{},undefined,{priority:10,resumePrevious:true});m.enqueue('run');
 m.stop();assert.equal(m.getState().status,'returning');assert.equal(m.getState().queue.length,0);assert.equal(m.getState().suspended.length,0);
 advance(m,.4);assert.equal(m.active,false);m.play('walk');m.cancel();assert.equal(m.active,false);
});
test('queues are bounded, invalid parameters cannot replace a valid running action',()=>{
 const {motion:m}=mock();m.play('jump');for(let i=0;i<16;i++)m.enqueue('walk');
 assert.throws(()=>m.enqueue('run'));assert.equal(m.getState().queue.length,16);
 assert.throws(()=>m.play('paw',{},undefined,{priority:NaN}));assert.equal(m.getState().current.action,'jump');
 assert.throws(()=>m.update(NaN));assert.throws(()=>m.update(-1));
});
test('targets are validated, copied and reserved only: no IK/physics side effects',()=>{
 const {motion:m}=mock(),point={x:1,y:2,z:3};m.setTarget('frontLFoot',point);point.x=9;
 assert.equal(m.getTargets().frontLFoot.x,1);assert.equal(m.getState().targetsApplied,false);
 assert.throws(()=>m.setTarget('url',point));assert.throws(()=>m.setTarget('head',{x:NaN,y:0,z:0}));
 const copy=m.getTargets();copy.frontLFoot.x=8;assert.equal(m.getTargets().frontLFoot.x,1);
 m.setTarget('frontLFoot',null);assert.deepEqual(m.getTargets(),{});
});
test('event unsubscription, instance isolation, listener failure and disposal are bounded',()=>{
 const a=createMotionEvents(),b=createMotionEvents();let calls=0;
 const off=a.on('contact',()=>calls++);a.on('contact',()=>{throw new Error('consumer');});
 b.emit('contact');a.emit('contact');off();a.emit('contact');a.dispose();a.emit('contact');assert.equal(calls,1);
 const {motion:m}=mock();m.play('walk');m.dispose();assert.equal(m.active,false);assert.throws(()=>m.play('run'));assert.throws(()=>m.on('x',()=>{}));
});
test('reentrant event listeners can stop or replace a finished job without being overwritten',()=>{
 const {motion:m}=mock();m.on('completed',()=>m.cancel());m.play('paw',{duration:.6});advance(m,.7);assert.equal(m.active,false);
 const {motion:n}=mock();n.on('completed',e=>{if(e.action==='paw')n.play('run',{duration:2});});n.play('paw',{duration:.6});advance(n,.7);assert.equal(n.getState().current.action,'run');
});
function fakeRig() {
 const cat=new THREE.Group(),map=new Map();
 for(const name of BONE_NAMES){const b=new THREE.Bone();b.name=`m2m_${name}`;b.position.set(0,.1,0);map.set(name,b);(map.get(BONE_PARENT[name])||cat).add(b);}
 const skeleton=new THREE.Skeleton([...map.values()]);
 const rig={skeleton,update(t,{actionId}) {
   for(const [i,b] of skeleton.bones.entries())b.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),Math.sin(t+i)*.1);
   const k=actionId==='walk'?1:actionId==='run'?3:0;cat.userData.animationRootLift=k;
   return {actionId,rootX:k,rootZ:k/2,rootPitch:k/10,rootYaw:k/7,rootRoll:k/15};
 }};
 return {rig,cat};
}
test('pose crossfade includes every root component and preserves bone lengths',()=>{
 const {rig,cat}=fakeRig();assertSkeleton(rig.skeleton);const player=createClipPlayer(rig,cat),m=createMotionController(player);
 m.play('walk');advance(m,.4);const root=cat.position.clone(),q=cat.quaternion.clone();m.play('run');
 assert.ok(cat.position.distanceTo(root)<1e-9);assert.ok(cat.quaternion.angleTo(q)<1e-7);
 advance(m,.4);assert.ok(cat.position.y>2.9);m.stop();advance(m,.4);assert.ok(cat.position.length()<1e-7);
 for(const b of rig.skeleton.bones)assert.ok(Math.abs(b.position.length()-.1)<1e-9);
});
test('main timeline and preview evaluator share the same full-root and bone samples',()=>{
 const a=fakeRig(),b=fakeRig(),player=createClipPlayer(a.rig,a.cat,{applyRoot:false}),timeline=createMotionTimeline(b.rig,b.cat);
 const plan=planMotion('sequence',{},[{clip:'walk'},{clip:'run'}]);player.begin();
 for(const t of [0,.1,.5,.9,1.2]){
   const x=player.render(plan,t),y=timeline(plan,t);
   for(const key of ['rootX','rootZ','rootLift','rootPitch','rootYaw','rootRoll'])assert.ok(Math.abs(x[key]-y[key])<1e-8,key);
   a.rig.skeleton.bones.forEach((bone,i)=>assert.ok(bone.quaternion.angleTo(b.rig.skeleton.bones[i].quaternion)<1e-7));
 }
});
