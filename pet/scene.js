import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildCat } from '../src/catBuilder.js';
import { createSceneControls } from './sceneControls.js';

/** Rendering adapter only. Account balances and entitlements never live here. */
export function createPetScene(host) {
  const scene=new THREE.Scene();
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label','可以拖动旋转查看的三维小猫');
  renderer.domElement.setAttribute('role','img');
  host.append(renderer.domElement);
  const camera=new THREE.PerspectiveCamera(35,1,0.1,100);
  camera.position.set(3,2.6,5);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enablePan=false;controls.enableDamping=true;controls.maxPolarAngle=Math.PI*0.49;
  controls.minPolarAngle=0.12;controls.rotateSpeed=0.65;controls.zoomSpeed=0.8;
  controls.touches.ONE=THREE.TOUCH.ROTATE;controls.touches.TWO=THREE.TOUCH.DOLLY_PAN;
  renderer.domElement.style.touchAction='none';
  const tiltTarget={x:0,y:0},tiltCurrent={x:0,y:0},viewCamera=camera.clone();
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let petPulse=0,lastFrame=performance.now(),lastSize='';
  const recordView=()=>{host.dataset.view=JSON.stringify({azimuth:controls.getAzimuthalAngle(),polar:controls.getPolarAngle(),distance:controls.getDistance()});};
  controls.addEventListener('change',recordView);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  scene.add(new THREE.HemisphereLight('#ffffff','#c2b19b',3));
  const light=new THREE.DirectionalLight('#fff5df',3);
  light.position.set(-3,7,5);light.castShadow=true;light.shadow.mapSize.set(1024,1024);
  Object.assign(light.shadow.camera,{left:-4,right:4,top:4,bottom:-4});scene.add(light);
  const floor=new THREE.Mesh(new THREE.CylinderGeometry(2.05,2.1,0.12,80),new THREE.MeshStandardMaterial({color:'#ede2cd',roughness:1}));
  floor.position.y=-0.08;floor.receiveShadow=true;scene.add(floor);
  const pivot=new THREE.Group();scene.add(pivot);
  let cat,signature='',frame=0,disposed=false,animation=null,radius=1.5,height=2;
  const start=performance.now();
  function release(object) {
    const geometries=new Set(),materials=new Set(),textures=new Set();
    object.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of (Array.isArray(o.material)?o.material:[o.material]).filter(Boolean)){materials.add(m);if(m.map)textures.add(m.map);}});
    for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();
    // The original builder caches its gradient map globally; do not dispose it here.
  }
  function fit(reset=false) {
    const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);
    // CSS owns layout; only resize the drawing buffer to avoid stale inline widths on mobile.
    const sizeKey=`${w}:${h}`;
    if(!reset&&sizeKey===lastSize)return;
    lastSize=sizeKey;
    renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
    const v=THREE.MathUtils.degToRad(camera.fov),fov=Math.min(v,2*Math.atan(Math.tan(v/2)*camera.aspect));
    const distance=radius/Math.sin(fov/2)*1.15;
    controls.target.set(0,height*0.47,0);
    camera.position.copy(controls.target).add(new THREE.Vector3(0.45,0.3,1).normalize().multiplyScalar(distance));
    controls.minDistance=distance*0.65;controls.maxDistance=distance*1.7;controls.update();controls.saveState();recordView();
  }
  const observer=new ResizeObserver(()=>fit());observer.observe(host);
  const input=createSceneControls(host,{
    resetView(){controls.reset();fit(true);},
    zoom(factor){
      const offset=camera.position.clone().sub(controls.target);
      const distance=THREE.MathUtils.clamp(offset.length()*factor,controls.minDistance,controls.maxDistance);
      camera.position.copy(controls.target).add(offset.setLength(distance));controls.update();recordView();
    },
    setTilt({x,y}){tiltTarget.x=x;tiltTarget.y=y;host.dataset.tilt=JSON.stringify({x,y});},
    petAt(x,y){
      if(!cat)return false;
      const rect=renderer.domElement.getBoundingClientRect();
      pointer.set((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1);
      scene.updateMatrixWorld(true);raycaster.setFromCamera(pointer,viewCamera);
      if(!raycaster.intersectObject(cat,true).length)return false;
      petPulse=performance.now();host.dataset.petCount=String(Number(host.dataset.petCount||0)+1);return true;
    },
  });
  const basePosition=new THREE.Vector3(),baseQuaternion=new THREE.Quaternion(),orbit=new THREE.Spherical();
  function tick(now) {
    if(disposed)return;
    frame=requestAnimationFrame(tick);
    if(document.hidden||host.offsetParent===null)return;
    const t=(now-start)/1000,dt=Math.min(0.1,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
    if(cat){cat.userData.updateEyeAnimation?.(t);cat.userData.updateStaticIdle?.(t,!reduced.matches);}
    pivot.position.y=0;pivot.rotation.y=-0.2;
    pivot.scale.setScalar(!reduced.matches&&petPulse&&now-petPulse<600?1+Math.sin((now-petPulse)/600*Math.PI)*0.025:1);
    if(animation){
      const f=Math.min(1,(now-animation.start)/(animation.duration*1000)),ease=f*f*(3-2*f);
      if(!reduced.matches){if(animation.action==='jump')pivot.position.y=Math.sin(f*Math.PI)*animation.height;else if(animation.action==='spin')pivot.rotation.y+=ease*Math.PI*2*animation.turns;}
      if(f>=1)animation=null;
    }
    controls.update();
    // Render a bounded sensor offset without feeding it back into OrbitControls.
    // The base camera remains exclusively under touch/mouse control.
    const blend=1-Math.exp(-8*dt);
    tiltCurrent.x+=(tiltTarget.x-tiltCurrent.x)*blend;tiltCurrent.y+=(tiltTarget.y-tiltCurrent.y)*blend;
    basePosition.copy(camera.position);baseQuaternion.copy(camera.quaternion);
    orbit.setFromVector3(camera.position.clone().sub(controls.target));
    orbit.theta+=tiltCurrent.x*0.3;
    orbit.phi=THREE.MathUtils.clamp(orbit.phi+tiltCurrent.y*0.22,controls.minPolarAngle,controls.maxPolarAngle);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(orbit));camera.lookAt(controls.target);
    camera.updateMatrixWorld(true);viewCamera.copy(camera);
    renderer.render(scene,camera);
    camera.position.copy(basePosition);camera.quaternion.copy(baseQuaternion);camera.updateMatrixWorld(true);
  }
  frame=requestAnimationFrame(tick);
  return {
    setParams(params) {
      if(disposed||JSON.stringify(params)===signature)return;
      // Construct first so a failed rebuild leaves the previous pet intact.
      const next=buildCat(params,'draft');
      const box=new THREE.Box3().setFromObject(next),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
      if(!Number.isFinite(size.length())||size.length()===0){release(next);throw new Error('小猫参数无法生成有效模型');}
      if(cat){pivot.remove(cat);release(cat);}cat=next;
      cat.position.set(-center.x,-box.min.y,-center.z);pivot.add(cat);
      height=size.y;radius=Math.max(size.length()/2,1.3);signature=JSON.stringify(params);animation=null;fit(true);
      host.dataset.ready='true';host.dataset.coat=params.coatId;host.dataset.pose=params.pose;host.dataset.params=JSON.stringify(params);
    },
    play(action, motion = {}) {
      if(!['jump','spin'].includes(action))throw new Error('未知互动动作');
      animation={action,start:performance.now(),duration:motion.duration??1.2,height:motion.height??0.5,turns:motion.turns??1};
      host.dataset.lastAction=action;host.dataset.actionDuration=String(animation.duration);
    },
    dispose() {disposed=true;cancelAnimationFrame(frame);input.dispose();observer.disconnect();controls.removeEventListener('change',recordView);controls.dispose();if(cat)release(cat);release(floor);renderer.dispose();renderer.domElement.remove();},
  };
}
