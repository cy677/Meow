import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/** Simple, bounded collision representations, independent of detailed render meshes. */
export function modelBody(def,asset,world) {
  const s=asset.dimensions,h=s.y/2;
  if(def.kind==='ramp')return rampBody(asset,def.position,world);
  const moving=['vehicle','bricks'].includes(def.kind);
  const body=new CANNON.Body({mass:moving?(def.kind==='bricks'?.12:def.id==='truck'?.65:.30):0,allowSleep:true,sleepSpeedLimit:.06,sleepTimeLimit:.6,linearDamping:.18,angularDamping:.32});
  if(def.kind==='vehicle') {
    body.addShape(new CANNON.Box(new CANNON.Vec3(s.x*.42,h*.64,s.z*.42)),new CANNON.Vec3(0,.025,0));
    const r=Math.max(.025,Math.min(s.x,s.y,s.z)*.20);
    for(const x of [-1,1])for(const z of [-1,1])body.addShape(new CANNON.Sphere(r),new CANNON.Vec3(x*(s.x*.42-r),-h+r,z*(s.z*.42-r)));
  } else if(def.kind==='furniture'&&['stool','table'].includes(def.id)) {
    body.addShape(new CANNON.Box(new CANNON.Vec3(s.x/2,.035,s.z/2)),new CANNON.Vec3(0,h-.035,0));
    for(const x of [-1,1])for(const z of [-1,1])body.addShape(new CANNON.Box(new CANNON.Vec3(.035,Math.max(.02,h-.035),.035)),new CANNON.Vec3(x*s.x*.38,-.035,z*s.z*.38));
  } else if(def.id==='lamp') {
    body.addShape(new CANNON.Box(new CANNON.Vec3(s.x*.40,.035,s.z*.40)),new CANNON.Vec3(0,-h+.035,0));
    body.addShape(new CANNON.Box(new CANNON.Vec3(.025,h,.025)));
  } else body.addShape(new CANNON.Box(new CANNON.Vec3(Math.max(.02,s.x/2),Math.max(.02,h),Math.max(.02,s.z/2))));
  // Put visual and body origins at the same center of mass.
  asset.root.children[0].position.y-=h;
  body.position.set(def.position[0],def.position[1]+h+.025,def.position[2]);
  asset.root.position.copy(body.position);world.addBody(body);
  return body;
}

function rampBody(asset,position,world) {
  asset.root.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(asset.root),s=asset.dimensions;
  const spacing=Math.max(s.x,s.z)/36,nx=Math.ceil(s.x/spacing)+1,nz=Math.ceil(s.z/spacing)+1;
  const ray=new THREE.Raycaster(),data=Array.from({length:nx},()=>Array(nz).fill(0));
  // The imported track's actual visible surface supplies the collision heights.
  // Heightfield uses X/Y as its grid, Z as height; rotate it into Three's X/Z plane.
  for(let x=0;x<nx;x++)for(let z=0;z<nz;z++) {
    ray.set(new THREE.Vector3(bounds.min.x+x*spacing,bounds.max.y+1,bounds.max.z-z*spacing),new THREE.Vector3(0,-1,0));
    const hit=ray.intersectObject(asset.model,true)[0];
    data[x][z]=Math.max(0,hit?.point.y??0);
  }
  const shape=new CANNON.Heightfield(data,{elementSize:spacing});
  const body=new CANNON.Body({mass:0});body.addShape(shape);
  body.quaternion.setFromEuler(-Math.PI/2,0,0);
  body.position.set(position[0]+bounds.min.x,position[1]+.025,position[2]+bounds.max.z);
  asset.root.position.set(position[0],position[1]+.025,position[2]);world.addBody(body);
  return body;
}
