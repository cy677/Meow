import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { solveTwoBone } from '../../src/catMotion/kinematics.js';
import { sampleExpression } from '../../src/catMotion/expression.js';
import { createClipPlayer } from '../../src/catMotion/clipPlayer.js';
import { createRealtimePlayer } from '../../src/catMotion/realtimePlayer.js';
import { createMotionController } from '../../src/catMotion/motionController.js';
import { planMotion, timelineLayers } from '../../src/catMotion/motionScript.js';
import { BONE_NAMES, BONE_PARENT } from '../../src/catMotion/skeleton.js';
import { CAT_MOTION_CLIPS, requireClip } from '../../src/catMotion/clipCatalog.js';
import { buildCat } from '../../src/catBuilder.js';
import { createMesh2MotionSkinRig } from '../../src/mesh2motionSkinRig.js';
import { DEFAULT_PARAMS } from '../catalog.mjs';
import { installCanvasStub, disposeTestCat } from './helpers/canvasStub.mjs';
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);

function fakeRig() {
  const cat=new THREE.Group(),map=new Map();
  for(const name of BONE_NAMES){const b=new THREE.Bone();b.name=`m2m_${name}`;b.position.set(0,.1,0);map.set(name,b);(map.get(BONE_PARENT[name])||cat).add(b);}
  const skeleton=new THREE.Skeleton([...map.values()]);
  return {cat,rig:{skeleton,update(t,{actionId,intensity=1}){
    const p=t/requireClip(actionId).duration;
    for(const [i,b] of skeleton.bones.entries())b.quaternion.setFromAxisAngle(V(1,0,0),.2*Math.sin(p*Math.PI*2+i));
    return {actionId,progress:p,amount:intensity,...sampleExpression(actionId,p,intensity),rootLift:.02*Math.sin(p*Math.PI*2)};
  }}};
}

test('two-link IK keeps both lengths for reachable, singular and unreachable targets',()=>{
  for(const target of [V(0,-1,0),V(1,0,0),V(0,0,0),V(0,-50,0),V(0,20,1)]){
    const root=V(0,0,0),out=solveTwoBone(root,target,.75,.5,V(0,-2,0));
    near(root.distanceTo(out.joint),.75);near(out.joint.distanceTo(out.end),.5);
    for(const v of [...out.joint,...out.end])assert.ok(Number.isFinite(v));
    if(!out.clamped)assert.ok(out.end.distanceTo(target)<1e-8);
  }
  for(const scale of [.001,.1,1,10]){
    const root=V(.3,.4,.5),target=root.clone().add(V(.3,-.7,.2).multiplyScalar(scale));
    const out=solveTwoBone(root,target,.6*scale,.5*scale,root.clone().add(V(0,0,1)));
    near(root.distanceTo(out.joint),.6*scale);near(out.joint.distanceTo(out.end),.5*scale);
    assert.ok(out.end.distanceTo(target)<1e-8);
  }
  assert.throws(()=>solveTwoBone(V(0,0,0),V(0,1,0),0,1,V(0,0,1)));
  assert.throws(()=>solveTwoBone(V(0,NaN,0),V(0,1,0),1,1,V(0,0,1)));
});

test('repeated gait cycles do not lose duration or blend against a shifted copy',()=>{
  const plan=planMotion('walk',{duration:4,transition:.3,speed:1});near(plan.duration,4);
  assert.equal(plan.segments.length,4);assert.ok(plan.segments.every(s=>s.overlap===0));
  for(const t of [0,1-1e-10,1,1+1e-10,2,3,4]){
    const layers=timelineLayers(plan,t);assert.equal(layers.length,1);near(layers[0].weight,1);
    assert.ok(Number.isFinite(layers[0].progress));
  }
  const mixed=planMotion('sequence',{},[{clip:'walk'},{clip:'run'}]);
  assert.ok(mixed.segments[1].overlap>0);
  const layers=timelineLayers(mixed,mixed.segments[1].start+.01);assert.equal(layers.length,2);
  near(layers.reduce((s,l)=>s+l.weight,0),1);
});

test('mouth, bones and root share interruption and script-overlap weights',()=>{
  const {cat,rig}=fakeRig(),player=createClipPlayer(rig,cat);
  player.renderClip('bark',.2,{},1);const before=player.getState().mouthOpen;
  player.begin();const mid=player.renderClip('walk',.2,{},.5);near(mid.mouthOpen,before*.5);
  near(player.renderClip('walk',.2,{},0).mouthOpen,before);
  near(player.renderClip('walk',.2,{},1).mouthOpen,0);
  const plan=planMotion('sequence',{transition:.6},[{clip:'howl'},{clip:'bark'}]);
  const t=plan.segments[1].start+plan.segments[1].overlap*.5;
  const expected=timelineLayers(plan,t).reduce((s,l)=>s+sampleExpression(l.clip,l.progress,.85).mouthOpen*l.weight,0);
  near(player.render(plan,t,100).mouthOpen,expected);player.dispose();
});

test('real-time phase is continuous when speed changes and action/reverse transitions start at the shown pose',()=>{
  const {cat,rig}=fakeRig(),live=createRealtimePlayer(rig,cat);
  let state;for(let i=0;i<12;i++)state=live.update(.025,{actionId:'walk'});
  const phase=state.progress,root=cat.userData.animationRootLift,bones=rig.skeleton.bones.map(b=>b.quaternion.clone());
  state=live.update(0,{actionId:'walk',speed:2});near(state.progress,phase);near(cat.userData.animationRootLift,root);
  for(let i=0;i<bones.length;i++)assert.ok(bones[i].angleTo(rig.skeleton.bones[i].quaternion)<1e-7);
  live.update(0,{actionId:'run'});
  for(let i=0;i<bones.length;i++)assert.ok(bones[i].angleTo(rig.skeleton.bones[i].quaternion)<1e-7);
  state=live.update(.1,{actionId:'run'});assert.ok(state.mouthOpen===0);
  assert.throws(()=>live.update(-1));assert.throws(()=>live.update(.1,{speed:NaN}));
  live.dispose();
});

test('same one-shot can explicitly restart and a pause freezes expression as well as bones',()=>{
  const {cat,rig}=fakeRig(),live=createRealtimePlayer(rig,cat);
  for(let i=1;i<=20;i++)live.update(.1,{actionId:'paw',elapsed:i*.1});
  const state=live.update(0,{actionId:'paw',elapsed:0});assert.ok(state.progress>.99); // entry is still displayed
  let restarted;for(let i=1;i<=4;i++)restarted=live.update(.1,{actionId:'paw',elapsed:i*.1});
  assert.ok(restarted.progress<.4);live.dispose();
  const player=createClipPlayer(rig,cat),controller=createMotionController(player);
  controller.play('bark',{duration:2.8});for(let i=0;i<6;i++)controller.update(.1);
  assert.ok(player.getState().mouthOpen>.5);controller.pause();
  const before=JSON.stringify(player.getState());controller.update(60);assert.equal(JSON.stringify(player.getState()),before);
  controller.resume();controller.stop();for(let i=0;i<5;i++)controller.update(.1);
  near(player.getState().mouthOpen,0);controller.dispose();
});

test('actual native and leaf meshes keep the same skin and rig across sizes, without rewriting texture data per frame',()=>{
  const restore=installCanvasStub();
  try{
    for(const shape of [{legLength:.5,chubbiness:1.8},{legLength:1,chubbiness:1},{legLength:1.4,chubbiness:.75}]){
      const params={...DEFAULT_PARAMS,...shape,pose:'standing',motionDebug:true};
      const native=buildCat(params,'draft'),leaf=buildCat({...params,catAppearance:'leaf',mouthMode:'open'},'draft');
      const ra=createMesh2MotionSkinRig(native),rb=createMesh2MotionSkinRig(leaf);
      assert.equal(ra.skeleton.bones.length,19);assert.equal(rb.skeleton.bones.length,19);
      for(const attr of ['position','normal','skinIndex','skinWeight'])assert.deepEqual(ra.fur.geometry.attributes[attr].array,rb.fur.geometry.attributes[attr].array);
      assert.deepEqual(ra.fur.geometry.index.array,rb.fur.geometry.index.array);
      const map=leaf.getObjectByName('leafOpenMouth').material.map,version=map.version;
      const geometryVersion=rb.fur.geometry.attributes.position.version;
      assert.equal(leaf.userData.setMouthOpen,undefined);assert.equal(leaf.userData.setMouthMode,undefined);
      let beforeTotal=0,afterTotal=0;
      for(const clip of CAT_MOTION_CLIPS)for(const phase of [0,.1,.25,.5,.75,.99]){
        const a=ra.update(phase*clip.duration,{actionId:clip.id,intensity:.85});
        const b=rb.update(phase*clip.duration,{actionId:clip.id,intensity:.85});
        assert.equal(b.boneLengthError,0);
        ra.skeleton.bones.forEach((bone,i)=>assert.deepEqual(bone.quaternion.toArray(),rb.skeleton.bones[i].quaternion.toArray()));
        near(a.rootLift,b.rootLift);near(leaf.userData.getMouthState().openness,b.mouthOpen);
        if(b.grounding.enabled){
          const g=b.grounding;beforeTotal+=Math.abs(g.minClearanceBefore);afterTotal+=Math.abs(g.minClearanceAfter);
          assert.ok(Math.abs(g.bodyShift)<=g.meanLegLength*.150001);
        }
        if(['run','jump','fall','death','climb-up','climb-down','mantle','sit','rest-pose','stretch'].includes(clip.id))assert.equal(b.grounding.enabled,false);
      }
      assert.ok(afterTotal<beforeTotal*.5,`plane-contact metric did not improve: ${afterTotal}/${beforeTotal}`);
      assert.equal(map.version,version);assert.equal(rb.fur.geometry.attributes.position.version,geometryVersion);
      rb.update(.55,{actionId:'bark'});assert.ok(leaf.userData.getMouthState().openness>.5);
      rb.reset();assert.equal(leaf.userData.getMouthState().openness,0);
      // Hidden absolute samples must not change the published expression.
      rb.update(.55,{actionId:'bark',sampleOnly:true});assert.equal(leaf.userData.getMouthState().openness,0);
      disposeTestCat(native,ra);disposeTestCat(leaf,rb);
    }
  }finally{restore();}
});
