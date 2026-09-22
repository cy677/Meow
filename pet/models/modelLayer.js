import * as THREE from 'three';
import { modelDefinition } from '../modelCatalog.mjs';
import { createModelAssets } from './modelAssets.js';
import { modelBody } from './modelPhysics.js';

const COLORS=['#e8bd91','#b6cdb2','#aabfd1','#d5b2c0','#e6d197','#bcb1cf'];
const bound=value=>THREE.MathUtils.clamp(value,-2.8,2.8);
const animated=def=>['companion','flyer','crawler'].includes(def.kind);

/** One layer per home renderer. Uses the original toy world's clock, collisions and drag constraint. */
export function createModelRewardsLayer({scene,camera,canvas,controls,toyWorld,getCat}) {
  const assets=createModelAssets(),group=new THREE.Group(),entries=new Map(),errors=new Map();
  group.name='kenney-rewards';scene.add(group);
  let disposed=false,generation=0,wanted=[],loading=0,time=0,drag=null,pending=Promise.resolve();
  const ray=new THREE.Raycaster(),pointer=new THREE.Vector2(),plane=new THREE.Plane(),point=new THREE.Vector3();
  const notice=document.createElement('p');notice.className='model-load-status';notice.setAttribute('role','status');notice.hidden=true;canvas.parentElement.append(notice);
  function status(){notice.hidden=!loading&&!errors.size;notice.textContent=errors.size?'部分礼物未加载成功，请在收藏中卸下后重新装备。':loading?'正在摆放新礼物…':'';}
  function release() {
    if(!drag)return;
    const current=drag;drag=null;
    if(current.entry.body?.mass){toyWorld.releaseGrab();current.entry.body.angularDamping=.32;}
    controls.enabled=current.controlsEnabled;
    try{canvas.releasePointerCapture(current.pointerId);}catch{/* Pointer may have been cancelled by Safari. */}
  }
  function remove(entry) {
    if(drag?.entry===entry)release();
    entry.mixer?.stopAllAction();entry.mixer?.uncacheRoot(entry.asset.model);
    if(entry.body)toyWorld.world.removeBody(entry.body);
    entry.light?.removeFromParent();
    entry.shadow.removeFromParent();entry.shadow.geometry.dispose();entry.shadow.material.dispose();
    if(entry.pickProxy){entry.pickProxy.geometry.dispose();entry.pickProxy.material.dispose();}
    entry.asset.dispose();
  }
  async function make(def,file,index=0) {
    const bricks=def.kind==='bricks';
    const dimensions=file.match(/(\d)x(\d)/);
    const size=bricks?.19*Math.max(Number(dimensions?.[1]||2),Number(dimensions?.[2]||2)):def.size;
    const asset=await assets.instantiate(file,size,{horizontal:bricks,color:bricks?COLORS[index%COLORS.length]:undefined});
    const positioned={...def,position:bricks?[def.position[0]+(index%3-1)*.38,Math.floor(index/3)*.24+.18,def.position[2]+(Math.floor(index/3)%2)*.5]:def.position};
    const entry={def,asset,body:null,mixer:null,action:null,actions:new Map(),until:0,index};
    const shadow=new THREE.Mesh(new THREE.CircleGeometry(1,24),new THREE.MeshBasicMaterial({color:'#6e5745',transparent:true,opacity:.15,depthWrite:false}));
    shadow.rotation.x=-Math.PI/2;shadow.scale.set(asset.dimensions.x*.58,asset.dimensions.z*.58,1);shadow.position.y=.032;shadow.raycast=()=>{};entry.shadow=shadow;
    if(animated(def)) {
      asset.root.position.fromArray(def.position);asset.root.position.y+=.025;
      entry.pickProxy=new THREE.Mesh(new THREE.SphereGeometry(Math.max(asset.dimensions.x,asset.dimensions.y,asset.dimensions.z)*.5+.05,12,8),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,colorWrite:false}));
      entry.pickProxy.position.y=asset.dimensions.y/2;entry.pickProxy.userData.skipShadow=true;asset.root.add(entry.pickProxy);
      entry.mixer=new THREE.AnimationMixer(asset.model);
      for(const clip of asset.clips)entry.actions.set(clip.name,entry.mixer.clipAction(clip));
      play(entry,'idle');
    }else {entry.body=modelBody(positioned,asset,toyWorld.world);entry.body.modelRewardId=def.id;}
    if(def.kind==='lamp') {
      // The visible pole can be thinner than a screen pixel. A bounded invisible
      // target makes finger taps reliable without enlarging the lamp or its collider.
      // modelBody already centres the static visual at the body's origin.
      entry.pickProxy=new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(.38,asset.dimensions.x),asset.dimensions.y,Math.max(.38,asset.dimensions.z)),
        new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,colorWrite:false})
      );
      entry.pickProxy.name='lamp-touch-target';entry.pickProxy.userData.skipShadow=true;
      asset.root.add(entry.pickProxy);
      entry.light=new THREE.PointLight('#ffd6a0',.9,4,2);entry.light.position.set(def.position[0],def.size*.86,def.position[2]);entry.light.castShadow=false;group.add(entry.light);
    }
    group.add(asset.root,shadow);
    return entry;
  }
  function play(entry,name) {
    const next=entry.actions.get(name)||entry.actions.get('idle');
    if(!next||entry.action===next)return;
    entry.action?.fadeOut(.2);next.reset().fadeIn(.2).play();entry.action=next;
  }
  async function select(ids=[]) {
    if(disposed)return;
    const slots=new Set();
    const defs=(Array.isArray(ids)?ids:[]).map(modelDefinition).filter(def=>def&&!slots.has(def.slot)&&slots.add(def.slot));
    const key=defs.map(d=>d.id).sort().join('|');
    if(key===wanted.join('|'))return pending;
    wanted=defs.map(d=>d.id).sort();const token=++generation;
    for(const [id,items]of entries)if(!wanted.includes(id)){for(const entry of items)remove(entry);entries.delete(id);}
    for(const id of errors.keys())if(!wanted.includes(id))errors.delete(id);
    pending=Promise.all(defs.filter(d=>!entries.has(d.id)).map(async def=>{
      loading++;status();const made=[];
      try {
        const files=def.files||[def.file];
        // Sequential per-set creation bounds transient geometry and avoids half-visible failed sets.
        for(let index=0;index<files.length;index++) {
          if(disposed||token!==generation)break;
          const entry=await make(def,files[index],index);made.push(entry);
        }
        if(disposed||token!==generation){for(const entry of made)remove(entry);return;}
        entries.set(def.id,made);errors.delete(def.id);
      }catch(error){for(const entry of made)remove(entry);if(!disposed&&token===generation){errors.set(def.id,error.message);console.error(`模型 ${def.id} 加载失败`,error);}}
      finally{loading--;if(!disposed)status();}
    })).then(()=>{if(!disposed&&token===generation)fitView();});
    return pending;
  }
  // Fit only after equipment changes or explicit view reset, never on each frame/poll.
  // Preserve the viewing direction and target; ordinary orbit/zoom remains available.
  function fitView() {
    if(disposed||!entries.size)return;
    const bounds=new THREE.Box3();
    for(const items of entries.values())for(const entry of items)bounds.expandByObject(entry.asset.root);
    const cat=getCat();if(cat)bounds.expandByObject(cat);
    if(bounds.isEmpty())return;
    bounds.expandByScalar(.16);camera.updateMatrixWorld(true);
    const backward=camera.position.clone().sub(controls.target).normalize();
    const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0);
    const up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
    const tanV=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
    const tanH=tanV*camera.aspect;
    let distance=camera.position.distanceTo(controls.target);
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]) {
      const relative=new THREE.Vector3(x,y,z).sub(controls.target),depth=relative.dot(backward);
      distance=Math.max(distance,depth+Math.abs(relative.dot(right))/(tanH*.84),depth+Math.abs(relative.dot(up))/(tanV*.72));
    }
    distance=Math.min(controls.maxDistance,distance);
    camera.position.copy(controls.target).addScaledVector(backward,distance);
    controls.update();camera.updateMatrixWorld(true);
  }
  function projected(e) {
    const rect=canvas.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);
  }
  function down(e) {
    if(disposed||drag||e.target!==canvas||e.button>0||!e.isPrimary)return;
    projected(e);
    const candidates=[];
    for(const items of entries.values())for(const entry of items){const hit=ray.intersectObject(entry.asset.root,true)[0];if(hit)candidates.push({entry,hit});}
    candidates.sort((a,b)=>a.hit.distance-b.hit.distance);
    const picked=candidates[0];if(!picked)return;
    // A foreground cat or original toy retains its original touch interaction.
    const blockers=[getCat(),...toyWorld.toys.filter(t=>t.mesh.visible).map(t=>t.mesh)].filter(Boolean);
    const blocked=ray.intersectObjects(blockers,true).find(h=>h.object.visible&&!h.object.userData.skipShadow);
    if(blocked&&blocked.distance<picked.hit.distance-.025)return;
    e.preventDefault();e.stopImmediatePropagation();
    const {entry,hit}=picked;
    drag={entry,pointerId:e.pointerId,controlsEnabled:controls.enabled,startX:e.clientX,startY:e.clientY,moved:false};controls.enabled=false;
    try{canvas.setPointerCapture(e.pointerId);}catch{/* Browser may already have implicit capture. */}
    if(entry.body?.mass) {
      plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()),hit.point);
      toyWorld.grabToy({body:entry.body},hit.point);
    }
  }
  function move(e) {
    if(!drag||e.pointerId!==drag.pointerId)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>6)drag.moved=true;
    if(!drag.entry.body?.mass)return;
    projected(e);if(ray.ray.intersectPlane(plane,point)){point.x=bound(point.x);point.z=bound(point.z);point.y=THREE.MathUtils.clamp(point.y,.07,2.8);toyWorld.moveGrab(point);}
  }
  function up(e) {
    if(!drag||(e.pointerId!==undefined&&e.pointerId!==drag.pointerId))return;
    const {entry,moved}=drag;
    if(e.type==='pointerup'&&!moved) {
      if(entry.mixer){entry.until=time+1.3;play(entry,'gesture-positive');}
      else if(entry.light)entry.light.intensity=entry.light.intensity?0:.9;
      else if(entry.def.kind==='furniture'){entry.body.quaternion.setFromEuler(0,(entry.yaw=(entry.yaw||0)+Math.PI/8),0);entry.body.aabbNeedsUpdate=true;}
    }
    if(e.type.startsWith('pointer')){e.preventDefault();e.stopImmediatePropagation();}
    release();
  }
  // Capture before OrbitControls and the original cat picker; consume only a confirmed model hit.
  window.addEventListener('pointerdown',down,true);window.addEventListener('pointermove',move,{capture:true,passive:false});window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',up,true);window.addEventListener('blur',up);canvas.addEventListener('lostpointercapture',up);
  function update(delta) {
    if(disposed)return;
    const dt=document.hidden?0:THREE.MathUtils.clamp(delta,0,.05);time+=dt;
    for(const items of entries.values())for(const entry of items) {
      const {def,asset,body}=entry;
      if(entry.mixer) {
        const position=asset.root.position;
        if(entry.until<=time) {
          let target;
          if(def.kind==='flyer')target=new THREE.Vector3(-1.3+Math.sin(time*.45)*.7,1.0+Math.sin(time*1.8)*.12,-.3+Math.cos(time*.45)*.7);
          else if(def.kind==='crawler')target=new THREE.Vector3(Math.sin(time*.13)*1.6,.025,1.65+Math.cos(time*.13)*.16);
          else {
            const cat=getCat();const origin=cat?.getWorldPosition(new THREE.Vector3())||new THREE.Vector3();
            target=new THREE.Vector3(bound(origin.x+Math.sin(time*.26)*1.1),.025,bound(origin.z+.75+Math.cos(time*.26)*.35));
          }
          const distance=position.distanceTo(target),speed=def.kind==='crawler'?.09:def.kind==='flyer'?.55:.27;
          if(def.id==='bunny')position.y=.025+(distance>.08?Math.abs(Math.sin(time*7))*.035:0);
          if(distance>.08){asset.root.lookAt(target.x,position.y,target.z);position.lerp(target,Math.min(1,dt*speed/Math.max(.001,distance)));play(entry,'walk');}else play(entry,'idle');
        }
        entry.mixer.update(dt);
      }else if(def.kind!=='ramp') {
        if(body.position.y<-.8||Math.abs(body.position.x)>4||Math.abs(body.position.z)>4) {
          if(drag?.entry===entry)release();body.position.set(def.position[0],asset.dimensions.y/2+.2,def.position[2]);body.velocity.setZero();body.angularVelocity.setZero();body.quaternion.set(0,0,0,1);body.wakeUp();
        }
        asset.root.position.copy(body.position);asset.root.quaternion.copy(body.quaternion);
      }
      entry.shadow.position.x=asset.root.position.x;entry.shadow.position.z=asset.root.position.z;
      entry.shadow.material.opacity=def.kind==='flyer'?.06:THREE.MathUtils.clamp(.18-asset.root.position.y*.035,.04,.18);
    }
  }
  function screenPoint(entry){
    const center=new THREE.Box3().setFromObject(entry.asset.root).getCenter(new THREE.Vector3()).project(camera),rect=canvas.getBoundingClientRect();
    return [(center.x+1)*rect.width/2,(1-center.y)*rect.height/2];
  }
  return {select,update,fitView,diagnostics(){return {loading,errors:[...errors],cached:assets.size,dragging:!!drag,items:[...entries.values()].flat().map(e=>({id:e.def.id,index:e.index,position:e.asset.root.position.toArray(),screen:screenPoint(e),size:e.asset.dimensions.toArray(),animations:[...e.actions.keys()],animationTime:e.mixer?.time||0,body:!!e.body,shapes:e.body?.shapes.map(s=>s.type)||[],light:e.light?.intensity}))};},dispose(){if(disposed)return;disposed=true;generation++;release();for(const items of entries.values())for(const e of items)remove(e);entries.clear();assets.dispose();group.removeFromParent();notice.remove();window.removeEventListener('pointerdown',down,true);window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',up,true);window.removeEventListener('blur',up);canvas.removeEventListener('lostpointercapture',up);}};
}
