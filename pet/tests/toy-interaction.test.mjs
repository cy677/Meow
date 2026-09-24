import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {createToyInteraction} from '../runtime/toyInteraction.js';
import {createToyWorld} from '../../src/toys.js';
import {installCanvasStub} from './helpers/canvasStub.mjs';

function harness({blocked=()=>false}={}) {
  const pose={x:0,z:0,heading:0},actions=[];
  const toy={kind:'ball',radius:.2,mesh:{visible:true},body:{mass:1,collisionFilterMask:-1,position:{x:.2,y:.2,z:1.15},velocity:{x:0,z:0}}};
  let held=false,taps=0;
  const interaction=createToyInteraction({getToys:()=>[toy],getPose:()=>pose,getReach:()=>({side:.2,forward:.48}),blocked,dragging:()=>held,
    play:action=>{actions.push(action);return 1.4;},tap:()=>{taps++;return true;}});
  return {pose,toy,actions,interaction,hold:()=>{held=true;},get taps(){return taps;},advance(seconds){for(let t=0;t<seconds;t+=.02)interaction.update(.02);}};
}
test('toy attention turns and approaches gradually before one paw contact, then watches and rests',()=>{
  const h=harness();assert.ok(h.interaction.start());assert.deepEqual(h.actions,['idle-alert']);
  h.advance(.5);assert.equal(h.pose.z,0);assert.equal(h.interaction.contact(),false);
  for(let i=0;i<200&&h.interaction.getState().phase!=='pawing';i++){
    const before={...h.pose};h.interaction.update(.02);
    assert.ok(Math.hypot(h.pose.x-before.x,h.pose.z-before.z)<=.42*.02001);
    assert.ok(Math.abs(h.pose.heading-before.heading)<=1.7*.02001);
  }
  assert.equal(h.interaction.getState().phase,'pawing');assert.ok(h.pose.z>.3);
  assert.equal(h.interaction.contact(),true);assert.equal(h.interaction.contact(),false);assert.equal(h.taps,1);
  h.advance(2.5);assert.equal(h.interaction.active,false);
  assert.deepEqual(h.actions,['idle-alert','walk','paw','idle-alert']);assert.equal(h.interaction.start(),false);
  h.advance(7);assert.equal(h.interaction.start(),true);
});
test('hidden, elevated, held and furniture-blocked toys never attract the cat',()=>{
  for(const change of [h=>{h.toy.mesh.visible=false;},h=>{h.toy.body.position.y=2;},h=>h.hold()]){
    const h=harness();change(h);assert.equal(h.interaction.start(),false);assert.deepEqual(h.actions,[]);
  }
  const h=harness({blocked:()=>true});assert.equal(h.interaction.start(),false);assert.equal(h.pose.z,0);
});
test('a removed target or a newly blocked route cancels without a remote paw hit',()=>{
  let blocked=false;const h=harness({blocked:()=>blocked});h.interaction.start();h.advance(.8);
  blocked=true;h.advance(.1);assert.equal(h.interaction.active,false);assert.equal(h.interaction.contact(),false);
  const other=harness();other.interaction.start();other.toy.mesh.visible=false;other.advance(.1);
  assert.equal(other.interaction.active,false);assert.equal(other.taps,0);
});
test('only a nearby visible toy receives a bounded physical impulse; furniture blocks approach',t=>{
  const restore=installCanvasStub();t.after(restore);
  const toys=createToyWorld(new THREE.Scene()),ball=toys.toys.find(t=>t.kind==='ball');
  ball.body.position.set(.2,.2,.9);ball.body.velocity.setZero();ball.body.angularVelocity.setZero();
  assert.equal(toys.tapToy(ball,{x:0,y:.2,z:0},0),false);assert.equal(ball.body.velocity.length(),0);
  assert.equal(toys.tapToy(ball,{x:.2,y:.2,z:.78},0),true);
  assert.ok(ball.body.velocity.z>.6&&ball.body.velocity.z<.7);assert.ok(ball.body.velocity.y<.1);
  const velocity=ball.body.velocity.clone();ball.mesh.visible=false;
  assert.equal(toys.tapToy(ball,{x:.2,y:.2,z:.78},0),false);assert.deepEqual(ball.body.velocity,velocity);
  assert.equal(toys.catDiagnostics().pawTouchCount,1);
  toys.setCatColliders([{c:new THREE.Vector3(0,.45,0),r:.35}]);
  const wall=new CANNON.Body({mass:0,shape:new CANNON.Box(new CANNON.Vec3(.6,1,.1))});wall.position.set(0,.6,1);
  toys.world.addBody(wall);assert.equal(toys.catMoveBlocked(0,.8,0),true);assert.equal(toys.catMoveBlocked(0,0,0),false);
});
