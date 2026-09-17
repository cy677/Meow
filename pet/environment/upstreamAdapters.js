import {createRng} from '../../src/rng.js';
// Named selection over the original seeded renderer: the resulting seed is stable and persisted by the recipe.
export function rugSeedForStyle(seed,index){
 for(let offset=0;offset<2048;offset++){
  const selected=Math.floor(createRng(((seed+offset)^0x72a4b19d)>>>0).next()*7);
  if(selected===index)return seed+offset;
 }
 throw new Error('无法匹配原版地毯样式');
}
// Extracted from src/toys.js's private scale helper. Public toy/body metadata is unchanged.
export function scaleToy(toy,factor){
 toy.scale=factor;toy.radius=toy.baseRadius*factor;toy.mesh.scale.copy(toy.baseMeshScale).multiplyScalar(factor);toy.shadowProxy.scale.setScalar(factor);
 for(let i=0;i<toy.body.shapes.length;i++){
  const shape=toy.body.shapes[i],base=toy.baseShapes[i];
  toy.body.shapeOffsets[i].set(base.offset.x*factor,base.offset.y*factor,base.offset.z*factor);
  if(base.type==='sphere'){shape.radius=base.radius*factor;shape.updateBoundingSphereRadius();}
  else if(base.type==='box'){shape.halfExtents.set(base.halfExtents.x*factor,base.halfExtents.y*factor,base.halfExtents.z*factor);shape.updateConvexPolyhedronRepresentation();shape.updateBoundingSphereRadius();}
 }
 toy.body.mass=toy.baseMass*Math.pow(factor,2.35);toy.body.updateMassProperties();toy.body.updateBoundingRadius();toy.body.aabbNeedsUpdate=true;toy.body.wakeUp();
}
