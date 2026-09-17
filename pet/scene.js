import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildCat } from '../src/catBuilder.js';
import { createSceneControls } from './sceneControls.js';
import { createSkeletalPlayer } from './skeletalPlayer.js';
import './motion.css';
import { ACTION_CHOICES, planMotion, defaultDuration } from './motionPrograms.mjs';

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
  const motionFocus=new THREE.Vector3(),motionFocusTarget=new THREE.Vector3(),renderTarget=new THREE.Vector3();let motionZoom=1;
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
  let cat,signature='',frame=0,disposed=false,radius=1.5,height=2;
  let savedParams=null,staticEntry=null,dynamicEntry=null,current=null,swap=null;
  const entries=[];
  const motionBar=document.createElement('div');motionBar.className='motion-bar';motionBar.hidden=true;
  const motionText=document.createElement('span'),stopButton=document.createElement('button');
  stopButton.type='button';stopButton.textContent='停止动作';stopButton.className='button small';stopButton.dataset.motionStop='';
  motionBar.append(motionText,stopButton);host.append(motionBar);
  stopButton.addEventListener('click',()=>dynamicEntry?.player?.stop());
  const workspace=host.id==='pet-scene'?document.getElementById('workspace'):null;
  const workspaceObserver=workspace?new MutationObserver(()=>{if(workspace.hidden){dynamicEntry?.player?.cancel();if(staticEntry)selectEntry(staticEntry,false);motionBar.hidden=true;host.dataset.motionPlaying='false';}}):null;
  workspaceObserver?.observe(workspace,{attributes:true,attributeFilter:['hidden']});
  const start=performance.now();
  function release(object) {
    const geometries=new Set(),materials=new Set(),textures=new Set();
    object.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of (Array.isArray(o.material)?o.material:[o.material]).filter(Boolean)){materials.add(m);if(m.map)textures.add(m.map);}});
    for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();
    // The original builder caches its gradient map globally; do not dispose it here.
  }
  function fade(entry,alpha) {
    if(!entry)return;
    entry.object.visible=alpha>0;
    entry.object.traverse(o=>{for(const material of (Array.isArray(o.material)?o.material:[o.material]).filter(Boolean)){
      if(!material.userData.meowFade)material.userData.meowFade={opacity:material.opacity,transparent:material.transparent,depthWrite:material.depthWrite};
      const base=material.userData.meowFade,transparent=alpha<1||base.transparent;
      if(material.transparent!==transparent){material.transparent=transparent;material.needsUpdate=true;}
      material.opacity=base.opacity*alpha;material.depthWrite=alpha===1?base.depthWrite:false;
    }});
  }
  function buildEntry(params,rigged) {
    const object=buildCat({...params,pose:rigged?'standing':params.pose,motionDebug:rigged},'draft');
    const box=new THREE.Box3().setFromObject(object),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
    if(!Number.isFinite(size.length())||size.length()===0){release(object);throw new Error('小猫参数无法生成有效模型');}
    // Bind at the origin, then apply the visual centering offset in the parent group.
    const player=rigged?createSkeletalPlayer(object):null;
    const wrapper=new THREE.Group();wrapper.position.set(-center.x,-box.min.y,-center.z);wrapper.add(object);pivot.add(wrapper);
    if(player)for(const mesh of [player.rig.fur,player.rig.outline].filter(Boolean))mesh.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,size.y/2,0),size.length()*1.5);
    const entry={object:wrapper,cat:object,player,size};wrapper.visible=false;
    return entry;
  }
  function selectEntry(entry,animate=true) {
    if(current===entry)return;
    if(swap){fade(swap.from,0);fade(swap.to,1);swap=null;}
    const from=current;current=entry;cat=entry.cat;
    if(from&&animate&&!reduced.matches){fade(entry,0);swap={from,to:entry,time:0};}
    else {fade(from,0);fade(entry,1);}
    host.dataset.bindingPose=entry.player?'standing':savedParams?.pose??'standing';
    host.dataset.motionEngine=entry.player?'fixed-skinned-mesh':'static';
  }
  function clearEntries(){for(const entry of entries){entry.player?.dispose();pivot.remove(entry.object);release(entry.object);}entries.length=0;current=null;cat=null;swap=null;staticEntry=null;dynamicEntry=null;}
  // Read-only on-demand diagnostics; skin sampling is not part of normal frame evaluation.
  host.getMotionDiagnostics=()=>{
    const d=dynamicEntry?.player?.getDiagnostics()??{type:'static',active:false};
    if(d.deformed){let minY=Infinity,maxY=-Infinity;for(let i=0;i<d.deformed.length;i+=3){const p=new THREE.Vector3(...d.deformed.slice(i,i+3));dynamicEntry.player.rig.fur.localToWorld(p);p.project(viewCamera);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}d.screenY=[minY,maxY];}
    return d;
  };
  function fit(reset=false) {
    const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);
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
    if(document.hidden||host.offsetParent===null){lastFrame=now;return;}
    const t=(now-start)/1000,dt=Math.min(0.1,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
    for(const entry of entries)if(entry.object.visible){entry.cat.userData.updateEyeAnimation?.(t);if(!entry.player)entry.cat.userData.updateStaticIdle?.(t,!reduced.matches);}
    pivot.position.y=0;pivot.rotation.y=-0.2;
    pivot.scale.setScalar(!reduced.matches&&petPulse&&now-petPulse<600?1+Math.sin((now-petPulse)/600*Math.PI)*0.025:1);
    if(dynamicEntry?.player&&(dynamicEntry.object.visible||dynamicEntry.player.active)){
      const wasActive=dynamicEntry.player.active;
      if(!reduced.matches)dynamicEntry.player.update(dt);
      else dynamicEntry.player.cancel();
      if(wasActive&&!dynamicEntry.player.active){motionBar.hidden=true;if(staticEntry)selectEntry(staticEntry);}
      host.dataset.motionPlaying=String(dynamicEntry.player.active);
    }
    if(swap){swap.time+=dt;const alpha=Math.min(1,swap.time/0.22);fade(swap.from,1-alpha);fade(swap.to,alpha);if(alpha===1)swap=null;}
    controls.update();
    // Motion framing and sensors are render-only offsets, preserving the user's orbit.
    const blend=1-Math.exp(-8*dt);
    const lift=current?.player?Math.max(0,current.cat.position.y):0;
    motionFocusTarget.set(0,lift*0.8,0);motionFocus.lerp(motionFocusTarget,1-Math.exp(-10*dt));
    motionZoom+=(1+Math.min(0.25,lift*0.16)-motionZoom)*blend;
    renderTarget.copy(controls.target).add(motionFocus);
    tiltCurrent.x+=(tiltTarget.x-tiltCurrent.x)*blend;tiltCurrent.y+=(tiltTarget.y-tiltCurrent.y)*blend;
    basePosition.copy(camera.position);baseQuaternion.copy(camera.quaternion);
    orbit.setFromVector3(camera.position.clone().sub(controls.target));
    orbit.theta+=tiltCurrent.x*0.3;
    orbit.phi=THREE.MathUtils.clamp(orbit.phi+tiltCurrent.y*0.22,controls.minPolarAngle,controls.maxPolarAngle);
    orbit.radius*=motionZoom;
    camera.position.copy(renderTarget).add(new THREE.Vector3().setFromSpherical(orbit));camera.lookAt(renderTarget);
    camera.updateMatrixWorld(true);viewCamera.copy(camera);
    renderer.render(scene,camera);
    camera.position.copy(basePosition);camera.quaternion.copy(baseQuaternion);camera.updateMatrixWorld(true);
  }
  frame=requestAnimationFrame(tick);
  return {
    setParams(params) {
      if(disposed||JSON.stringify(params)===signature)return;
      const next=buildEntry(params,params.pose==='standing');
      clearEntries();entries.push(next);savedParams=structuredClone(params);
      if(next.player)dynamicEntry=next;else staticEntry=next;
      height=next.size.y;radius=Math.max(next.size.length()/2+0.12,1.3);signature=JSON.stringify(params);selectEntry(next,false);motionBar.hidden=true;fit(true);
      host.dataset.ready='true';host.dataset.coat=params.coatId;host.dataset.pose=params.pose;host.dataset.params=JSON.stringify(params);
    },
    play(action, motion = {}, script = motion.script) {
      if(!savedParams||disposed)throw new Error('小猫尚未准备好');
      planMotion(action,motion,script);
      host.dataset.lastAction=action;host.dataset.actionDuration=String(motion.duration??defaultDuration(action));
      if(reduced.matches){host.dataset.motionPlaying='false';return false;}
      if(!dynamicEntry){dynamicEntry=buildEntry({...savedParams,pose:'standing'},true);entries.push(dynamicEntry);}
      selectEntry(dynamicEntry);
      const duration=dynamicEntry.player.play(action,motion,script);
      host.dataset.motionPlaying='true';host.dataset.motionDuration=String(duration);
      motionText.textContent=(ACTION_CHOICES.find(c=>c[0]===action)?.[1]??action)+(staticEntry?' · 临时站立表演，结束恢复原造型':'');motionBar.hidden=false;
      return true;
    },
    stop(immediate=false){if(immediate){dynamicEntry?.player?.cancel();if(staticEntry)selectEntry(staticEntry,false);motionBar.hidden=true;host.dataset.motionPlaying='false';}else dynamicEntry?.player?.stop();},
    getMotionDiagnostics:()=>host.getMotionDiagnostics(),
    dispose() {disposed=true;cancelAnimationFrame(frame);input.dispose();observer.disconnect();workspaceObserver?.disconnect();controls.removeEventListener('change',recordView);controls.dispose();clearEntries();motionBar.remove();delete host.getMotionDiagnostics;release(floor);renderer.dispose();renderer.domElement.remove();},
  };
}
