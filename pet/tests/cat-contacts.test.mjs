import test from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { resolveCatObstacles } from '../../src/catContacts.js';
import { createToyWorld } from '../../src/toys.js';

test('furniture blocks sphere, allows tangential motion and overhead clearance', () => {
  const box = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(.5,.5,.5)) });
  const contact = resolveCatObstacles([{ x:.8,y:0,z:.2,r:.4 }], [box]);
  assert.ok(contact.x > .09 && contact.x < .11); assert.equal(contact.z, 0);
  assert.equal(resolveCatObstacles([{x:0,y:1,z:0,r:.4}], [box]).body, null);
  box.quaternion.setFromEuler(0,Math.PI/4,0);
  assert.ok(resolveCatObstacles([{x:.8,y:0,z:0,r:.4}], [box]).x > .2);
  box.collisionFilterMask = 0;
  assert.equal(resolveCatObstacles([{x:0,y:0,z:0,r:.4}], [box]).body, null);
});

test('cat follows lifted pose, pushes a toy, and throttles contact feedback', (context) => {
  // Only procedural texture painting is stubbed; Cannon collision/solver is real.
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({
    fillRect(){}, beginPath(){}, moveTo(){}, bezierCurveTo(){}, stroke(){},
  }) }) };
  context.after(() => { if(previousDocument) globalThis.document = previousDocument; else delete globalThis.document; });
  const toys = createToyWorld(new THREE.Scene());
  const ball = toys.toys.find(t => t.kind === 'ball');
  for (const t of toys.toys) if(t !== ball) toys.world.removeBody(t.body);
  toys.setCatColliders([{c:new THREE.Vector3(0,.5,0),r:.5}]);
  const cat = new THREE.Object3D(); let contacts = 0;
  toys.onCatContact(() => contacts++);
  cat.position.y = 2; toys.syncCat(cat,1/60);
  assert.equal(toys.catDiagnostics().spheres[0].y,2.5);
  cat.position.y = 0; toys.syncCat(cat,1/60);
  ball.body.position.set(.75,.5,0); ball.body.velocity.set(-2,0,0);
  for(let i=0;i<25;i++){toys.syncCat(cat,1/60);toys.step(1/60);}
  assert.ok(ball.body.position.x > .75, 'ball rebounds away from the cat');
  assert.equal(contacts,1);
  assert.equal(toys.catDiagnostics().lastContact.kind,'ball');
  ball.body.position.set(1,.5,0); ball.body.velocity.setZero(); ball.body.sleep();
  for(let i=0;i<45;i++){cat.position.x += .02; toys.syncCat(cat,1/60); toys.step(1/60);}
  assert.ok(ball.body.position.x > 1.3, 'walking cat wakes and pushes a settled toy');
});
