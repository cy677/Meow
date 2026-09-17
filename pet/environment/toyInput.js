import * as THREE from 'three';
/** Captured pointer events only for an unlocked, displayed physics toy. Other touches orbit. */
export function createToyInput(host,canvas,controls,environment,viewCamera) {
 const ray=new THREE.Raycaster(),ndc=new THREE.Vector2(),plane=new THREE.Plane(),point=new THREE.Vector3(),normal=new THREE.Vector3();
 let pointer=null,blocked=false;
 const usable=()=>!blocked&&!document.hidden&&host.offsetParent!==null;
 function cast(event){const b=canvas.getBoundingClientRect();ndc.set((event.clientX-b.left)/b.width*2-1,-(event.clientY-b.top)/b.height*2+1);ray.setFromCamera(ndc,viewCamera);}
 function prevent(e){e.preventDefault();e.stopImmediatePropagation();}
 function finish(){
   const old=pointer;pointer=null;
   if(old!==null&&canvas.hasPointerCapture(old))canvas.releasePointerCapture(old);environment.stopDrag();controls.enabled=true;delete host.dataset.dragToy;
 }
 function down(event) {
   if(event.button!==0||!usable())return;
   if(pointer!==null){finish();prevent(event);return;}
   cast(event);
   let closest=null;
   for(const toy of environment.toys){
     toy.mesh.updateWorldMatrix(true,true);
     const hit=ray.intersectObject(toy.mesh,true)[0];
     if(hit&&(!closest||hit.distance<closest.hit.distance))closest={toy,hit};
   }
   if(!closest)return;
   pointer=event.pointerId;canvas.setPointerCapture(pointer);controls.enabled=false;
   viewCamera.getWorldDirection(normal);plane.setFromNormalAndCoplanarPoint(normal,closest.hit.point);
   environment.grab(closest.toy,closest.hit.point);host.dataset.dragToy=closest.toy.kind;prevent(event);
 }
 function move(event){
   if(event.pointerId!==pointer)return;
   cast(event);
   if(ray.ray.intersectPlane(plane,point)){point.x=THREE.MathUtils.clamp(point.x,-4,4);point.z=THREE.MathUtils.clamp(point.z,-4,4);point.y=THREE.MathUtils.clamp(point.y,.12,3);environment.move(point);}
   prevent(event);
 }
 function end(event){if(event.pointerId!==pointer)return;prevent(event);finish();}
 const overlay=e=>{blocked=e.detail===true;finish();};
 const hide=()=>{if(document.hidden)finish();};
 canvas.addEventListener('pointerdown',down,true);canvas.addEventListener('pointermove',move,true);
 for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,end,true);
 host.addEventListener('meow:overlay-change',overlay);document.addEventListener('visibilitychange',hide);
 return {cancel:finish,dispose(){finish();canvas.removeEventListener('pointerdown',down,true);canvas.removeEventListener('pointermove',move,true);for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.removeEventListener(type,end,true);host.removeEventListener('meow:overlay-change',overlay);document.removeEventListener('visibilitychange',hide);}};
}
