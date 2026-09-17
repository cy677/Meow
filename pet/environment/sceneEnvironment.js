import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {createRugLayer} from '../../src/rug.js';
import {createToyWorld} from '../../src/toys.js';
import {createCloudField,createRainField,createFishRain} from '../../src/weather.js';
import {createRng} from '../../src/rng.js';
import {createWeatherAudio} from './weatherAudio.js';
import {rugSeedForStyle,scaleToy} from './upstreamAdapters.js';
import {DEFAULT_SCENE,RUG_CHOICES,SCENE_SLOTS} from '../environmentSchema.mjs';
import {createWoodFloor} from './woodFloor.js';
import {containerBuild} from './containerAdapter.js';
import {disposeObjects} from './dispose.js';

/** Separate persistent scene configuration from transient physics and rendering. */
export function createSceneEnvironment({scene,renderer,platform,keyLight,ambientLight,host}) {
 let config=structuredClone(DEFAULT_SCENE),catParams={},cat=null,wood=null,rug=null,rugGroup=null,bed=null,bedBody=null;
 let toyWorld=null,activeToys=[],rain=null,clouds=null,fish=null,fishGroup=null,audio=null,audioEnabled=false;
 let last={},paused=false,disposed=false,elapsed=0,colliderClock=0;
 const room=new THREE.Group();room.name='reward-environment';scene.add(room);
 const lightning=new THREE.PointLight('#dce8ff',0,18);lightning.position.set(-3,4,-3);room.add(lightning);
 const fishTextures=new Set();
 function rememberFishTextures(){fishGroup?.traverse(o=>{const m=o.material;if(m?.gradientMap)fishTextures.add(m.gradientMap);});}
 const weatherColors={sunny:'#efe9dd',cloudy:'#dce3e5',rain:'#cedae1',thunder:'#bac7d7',fishRain:'#cee1e3'};
 const ensureWorld=()=>{
   if(toyWorld)return toyWorld;
   toyWorld=createToyWorld(scene);room.add(toyWorld.group);
   for(const t of toyWorld.toys){t.mesh.visible=false;t.shadowProxy.visible=false;toyWorld.world.removeBody(t.body);}
   // Keep thrown toys within the room, using invisible physical walls.
   for(const [x,z,hx,hz]of [[-4.4,0,.1,4.4],[4.4,0,.1,4.4],[0,-4.4,4.4,.1],[0,4.4,4.4,.1]]){
     const body=new CANNON.Body({type:CANNON.Body.STATIC,shape:new CANNON.Box(new CANNON.Vec3(hx,1.6,hz)),position:new CANNON.Vec3(x,1.6,z)});
     toyWorld.world.addBody(body);
   }
   return toyWorld;
 };
 function stopDrag(){toyWorld?.releaseGrab();host.dispatchEvent(new CustomEvent('meow:toy-drag',{detail:false}));}
 function placeToys() {
   if(!toyWorld)return;
   const p=config.toy,rng=createRng(p.seed);
   for(const [i,t]of activeToys.entries()){
     const angle=-.3+i*1.2+rng.range(-.14,.14),radius=rng.range(1.5,1.8),x=Math.cos(angle)*radius,z=Math.sin(angle)*radius*.9+.3;
     t.body.position.set(x,.45+t.radius,z);t.body.quaternion.setFromEuler(0,rng.range(-3,3),0);
     t.body.velocity.set(0,0,0);t.body.angularVelocity.set(0,0,0);t.body.force.set(0,0,0);t.body.torque.set(0,0,0);t.body.wakeUp();
     t.mesh.position.copy(t.body.position);
   }
 }
 function setToys(){
   stopDrag();if(config.toy.kind!=='none'||config.bed.kind==='cushion')ensureWorld();
   if(!toyWorld)return;
   const p=config.toy,all=toyWorld.toys.filter(t=>t.kind!=='bed');
   const pool=p.kind==='mixed'?['yarn','ball','fish','duck','yarn'].map((kind,i)=>all.filter(t=>t.kind===kind)[i===4?1:0]):all.filter(t=>t.kind===p.kind);
   activeToys=p.kind==='none'?[]:pool.slice(0,p.count);
   for(const t of all){
     const active=activeToys.includes(t);t.mesh.visible=t.shadowProxy.visible=active;
     if(!active){toyWorld.world.removeBody(t.body);continue;}
     scaleToy(t,p.scale);
     if(!toyWorld.world.bodies.includes(t.body))toyWorld.world.addBody(t.body);
   }
   placeToys();
 }
 function setBed(){
   stopDrag();
   if(bed){disposeObjects([bed]);bed=null;}
   if(bedBody){toyWorld?.world.removeBody(bedBody);bedBody=null;}
   const p=config.bed;
   if(toyWorld){const cushion=toyWorld.toys.find(t=>t.kind==='bed');cushion.mesh.visible=cushion.shadowProxy.visible=false;toyWorld.world.removeBody(cushion.body);}
   if(p.kind==='none'||p.placement==='inside'&&p.kind!=='cushion')return;
   const w=ensureWorld();
   if(p.kind==='cushion'){
     const t=w.toys.find(t=>t.kind==='bed');t.mesh.visible=t.shadowProxy.visible=true;
     scaleToy(t,p.size);t.body.position.set(p.x,.1,p.z);t.body.velocity.setZero();t.body.angularVelocity.setZero();w.world.addBody(t.body);return;
   }
   bed=containerBuild(p,catParams).mesh;bed.position.set(p.x,.035,p.z);bed.name=`reward-bed-${p.kind}`;room.add(bed);
   bedBody=new CANNON.Body({type:CANNON.Body.STATIC,shape:new CANNON.Box(new CANNON.Vec3(.6*p.size,.28,.6*p.size)),position:new CANNON.Vec3(p.x,.28,p.z)});
   w.world.addBody(bedBody);
 }
 function setRug(){
   const p=config.rug;
   if(p.style!=='none'&&!rug){rug=createRugLayer(scene);rugGroup=scene.getObjectByName('procedural-rug-layer');room.add(rugGroup);}
   if(!rug)return;
   rug.setVisible(p.style!=='none');
   if(p.style==='none')return;
   rug.setSeed(rugSeedForStyle(p.seed,RUG_CHOICES.findIndex(([id])=>id===p.style)));
   const rectangular=['striped','confetti'].includes(p.style),width=p.size,depth=p.size*(rectangular?.78:1);
   for(const mesh of rugGroup.children){
     const extra=mesh===rug.mesh?1:mesh.name.includes('shadow')?1.055:1.03;
     mesh.scale.set(width*extra,depth*extra,1);mesh.position.x=0;mesh.position.z=0;
   }
   rugGroup.rotation.y=THREE.MathUtils.degToRad(p.rotation);
 }
 function setWeather(){
   rememberFishTextures();
   const p=config.weather;
   if(p.mode!=='sunny'){
     if(!clouds){clouds=createCloudField(scene);room.add(clouds.group);}
     clouds.setMode(p.mode);clouds.setAmount(p.cloudAmount);
     // Original clouds were high above the editor floor: bring them into the child's room view.
     clouds.group.scale.set(.52,.55,.52);clouds.group.position.set(0,.45,-.8);
   }else clouds?.setMode('sunny');
   const raining=['rain','thunder','fishRain'].includes(p.mode);
   if(raining&&!rain){rain=createRainField(scene);room.add(rain.group);}
   rain?.setEnabled(raining);rain?.setAmount(p.rainAmount);
   if(p.mode==='fishRain'&&!fish){
     fish=createFishRain(scene,ensureWorld().world);fishGroup=scene.getObjectByName('fish-rain');room.add(fishGroup);
   }
   // Upstream max is higher. The public preset range is capped for a tablet, not secretly overridden.
   fish?.setAmount(p.fishAmount*.2);fish?.setEnabled(p.mode==='fishRain'&&!paused);
   scene.background=new THREE.Color(weatherColors[p.mode]);
   syncAudio();
 }
 function syncAudio(){
   if(!audio)return;
   audio.setMuted(!audioEnabled||paused);
   const rainOn=audioEnabled&&!paused&&['rain','thunder','fishRain'].includes(config.weather.mode);
   audio.setRainAmount(Math.min(1,config.weather.rainAmount));audio.setRain(rainOn);
 }
 function setLighting(){
   const p=config.lighting,a=THREE.MathUtils.degToRad(p.azimuth),e=THREE.MathUtils.degToRad(p.elevation);
   keyLight.color.set(p.keyColor);keyLight.intensity=p.keyIntensity;
   keyLight.position.set(Math.sin(a)*Math.cos(e)*8,Math.sin(e)*8,Math.cos(a)*Math.cos(e)*8);
   ambientLight.color.set(p.ambientColor);ambientLight.intensity=p.ambientIntensity;
 }
 function setEffects(){
   const p=config.effect;
   scene.fog=p.kind==='fog'?new THREE.Fog(p.color,p.near,p.far):null;
 }
 return {
   set(params, nextCatParams={}) {
     catParams=nextCatParams;const changed=[];
     const next=Object.fromEntries(SCENE_SLOTS.map(slot=>[slot,{...DEFAULT_SCENE[slot],...params?.[slot]}]));
     config=next;
     for(const slot of SCENE_SLOTS){
       const sig=JSON.stringify(next[slot]);
       if(last[slot]===sig)continue;last[slot]=sig;changed.push(slot);
       if(slot==='floor'){
         const p=next.floor;platform.visible=p.kind==='platform';
         if(p.kind==='wood'){if(!wood)wood=createWoodFloor(scene,renderer);wood.set(p);}
         if(wood)wood.mesh.visible=p.kind==='wood';
       }
       if(slot==='rug')setRug();
       if(slot==='bed')setBed();
       if(slot==='toy')setToys();
       if(slot==='weather')setWeather();
       if(slot==='lighting')setLighting();
       if(slot==='effect')setEffects();
     }
     host.dataset.sceneParams=JSON.stringify(config);
     return changed;
   },
   setCat(object){cat=object;colliderClock=1;},
   get params(){return config;},
   get roomExtent(){return config.toy.kind!=='none'||config.bed.kind!=='none'?2.7:config.rug.style!=='none'?Math.max(1.8,config.rug.size*.47):0;},
   get toys(){return activeToys;},
   get dragging(){return !!toyWorld?.dragging;},
   grab(toy,point){ensureWorld().grabToy(toy,point);host.dispatchEvent(new CustomEvent('meow:toy-drag',{detail:true}));},
   move(point){toyWorld?.moveGrab(point);},
   stopDrag,
   resetToys(){stopDrag();placeToys();},
   setAudio(on){
     audioEnabled=Boolean(on);if(audioEnabled&&!audio)audio=createWeatherAudio();
     if(audioEnabled)audio.prepare();syncAudio();return audioEnabled;
   },
   pause(on){paused=Boolean(on);if(paused)stopDrag();fish?.setEnabled(!paused&&config.weather.mode==='fishRain');syncAudio();},
   update(dt,time,viewCamera,reduced=false){
     if(disposed||paused)return;
     elapsed+=dt;colliderClock+=dt;
     if(cat&&toyWorld&&colliderClock>.12){
       colliderClock=0;cat.updateWorldMatrix(true,false);
       toyWorld.setCatColliders((cat.userData.colliders||[]).map(s=>({c:cat.localToWorld(s.c.clone()),r:s.r})));
     }
     if(!reduced){clouds?.update(dt);rain?.update(dt);fish?.update(dt,time);rememberFishTextures();toyWorld?.step(dt);}
     else if(toyWorld?.dragging)toyWorld.step(dt);
     if(viewCamera)toyWorld?.updateFishPupils(viewCamera);
     for(const t of activeToys)if(t.body.position.y < -1||Math.abs(t.body.position.x)>5||Math.abs(t.body.position.z)>5){placeToys();break;}
     // Opt-in low-amplitude, slow light pulse, not a full-screen strobe.
     const phase=elapsed%12;
     lightning.intensity=config.weather.mode==='thunder'&&config.weather.lightning&&!reduced&&phase<.9?Math.sin(phase/.9*Math.PI)*.55:0;
     if(audioEnabled&&config.weather.mode==='thunder'&&phase<dt)audio?.playThunder(.3);
   },
   diagnostics(){
     return {slots:structuredClone(config),roomExtent:this.roomExtent,wood:!!wood?.mesh.visible,rug:rug?{...rug.getState(),bounds:{width:config.rug.size,depth:config.rug.size*(['striped','confetti'].includes(config.rug.style)?.78:1),centerX:0,centerZ:0}}:null,
       container:bed?.userData.container?.id??(config.bed.placement==='inside'?config.bed.kind:null),
       toys:activeToys.map(t=>({kind:t.kind,position:t.body.position.toArray(),id:t.body.id})),toyCount:activeToys.length,
       bodyCount:toyWorld?.world.bodies.length??0,clouds:clouds?.count??0,rain:rain?.count??0,fish:fish?.count??0,
       fog:scene.fog?{near:scene.fog.near,far:scene.fog.far}:null,audioEnabled,audioState:audio?.getState()??null,paused,dragging:this.dragging};
   },
   dispose(){
     if(disposed)return;disposed=true;stopDrag();audio?.dispose();rememberFishTextures();fish?.setEnabled(false);fish?.clear();for(const texture of fishTextures)texture.dispose();
     if(fishGroup)disposeObjects([fishGroup]);
     if(toyWorld){
       for(const body of [...toyWorld.world.bodies])toyWorld.world.removeBody(body);
       for(const c of [...toyWorld.world.constraints])toyWorld.world.removeConstraint(c);
     }
     wood?.dispose();disposeObjects([room]);scene.fog=null;
   }
 };
}
