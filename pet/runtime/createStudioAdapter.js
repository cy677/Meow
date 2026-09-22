import { STUDIO_FIELDS as petStudioFields } from '../studioSchema.mjs';
import { containerBuild as petContainerBuild } from '../environment/containerAdapter.js';
import { scaleToy as petScaleToy } from '../environment/upstreamAdapters.js';
import { disposeObjects as petDisposeObjects } from '../environment/dispose.js';
import * as petCannon from 'cannon-es';
import { createMotionTimeline as petCreateMotionTimeline } from '../motionTimeline.js';
import { timelineLayers as petTimelineLayers } from '../motionPrograms.mjs';
import { SPEECH_BUBBLE_COPY as petSpeechCopy } from '../../src/speechBubbles.js';
import { CAT_DIALOGUE as petCatDialogue, TOY_DIALOGUE as petToyDialogue } from '../catDialogue.js';

let dialogueInstalled=false;
/** All access to the upstream renderer passes through this explicit port. */
export function createStudioAdapter(host) {
  const {THREE,params,key,ambient,camera,scene,controls,motionCameraOffset,floorParams,rugState,lightAngles,weatherAmounts,pokeUniforms,pokeFeel,hatchUniforms,sketchShadowMat,blockShadowMat,refreshers,petControlSyncs,ground,toyWorld,rugLayer,motionMachine,bgm,weatherAudio,renderer,resetMotionWorld,drawWoodFloor,syncRugPlacement,updateKeyLight,syncLightOrb,setThunder,setWeather,setWeatherAmount}=host;
if(!dialogueInstalled){petSpeechCopy['zh-CN'].cat.push(...petCatDialogue);
for(const [role,lines] of Object.entries(petToyDialogue))petSpeechCopy['zh-CN'][role].push(...lines);dialogueInstalled=true;}
let petActivePlan=null,petTimeline=null,petTimelineRig=null;
let petChildMotion=false,petLastElapsed=0;
const petWander={x:0,z:0,heading:0,targetX:0,targetZ:.8};
function petChooseDestination(){
  const angle=Math.random()*Math.PI*2,radius=.65+Math.random()*.4;
  petWander.targetX=Math.sin(angle)*radius;petWander.targetZ=Math.cos(angle)*radius;
  if(Math.hypot(petWander.targetX-petWander.x,petWander.targetZ-petWander.z)<.45){petWander.targetX=-petWander.targetX;petWander.targetZ=-petWander.targetZ;}
}
function petAdvanceWander(plan,elapsed){
  const dt=Math.max(0,Math.min(.1,elapsed-petLastElapsed));petLastElapsed=elapsed;
  if(plan.action==='spin')return;
  const speed=petTimelineLayers(plan,elapsed).reduce((sum,layer)=>sum+({walk:.56,run:1.05,sneak:.28}[layer.clip]||0)*layer.weight,0)*(plan.motion.speed??1);
  if(!speed)return;
  if(Math.hypot(petWander.targetX-petWander.x,petWander.targetZ-petWander.z)<.2)petChooseDestination();
  const target=Math.atan2(petWander.targetX-petWander.x,petWander.targetZ-petWander.z);
  const turn=Math.atan2(Math.sin(target-petWander.heading),Math.cos(target-petWander.heading));
  petWander.heading+=Math.max(-2.6*dt,Math.min(2.6*dt,turn));
  const distance=speed*dt*Math.max(0,Math.cos(turn));
  petWander.x+=Math.sin(petWander.heading)*distance;petWander.z+=Math.cos(petWander.heading)*distance;
  const radius=Math.hypot(petWander.x,petWander.z);
  if(radius>1.25){petWander.x*=1.25/radius;petWander.z*=1.25/radius;petWander.targetX=0;petWander.targetZ=0;}
}
function petSampleMotion(elapsed,options){
  if(!petActivePlan)return host.motionRig.update(elapsed,options);
  if(petTimelineRig!==host.motionRig){petTimelineRig=host.motionRig;petTimeline=petCreateMotionTimeline(host.motionRig,host.cat);}
  const state=petTimeline(petActivePlan,elapsed);
  petAdvanceWander(petActivePlan,elapsed);
  params.motionAction=state.actionId;
  return state;
}
let petRoomBed=null,petRoomBedBody=null;
const petOriginalRoom={keyColor:key.color.clone(),keyIntensity:key.intensity,ambientColor:ambient.color.clone(),ambientIntensity:ambient.intensity,fov:camera.fov,fog:scene.fog.clone()};
const petPick = (fields, source) => Object.fromEntries(fields.filter(f=>source[f.key]!==undefined).map(f=>[f.key,source[f.key]]));
const studio = {
  get childMotion() { return petChildMotion; },
  get worldPose() { return petWander; },
  sampleMotion: petSampleMotion,
  photo: host.photo,
  animationState: host.animationState,
  resetView(view) {
    const damping=controls.enableDamping;
    controls.enableDamping=false;controls.update();
    camera.position.set(view.x+motionCameraOffset.x,view.y,view.z+motionCameraOffset.y);
    controls.target.set(view.targetX+motionCameraOffset.x,view.targetY,view.targetZ+motionCameraOffset.y);
    controls.update();controls.enableDamping=damping;
  },
  setAccess(access) {
    petChildMotion=true;
    // Called only for a child session. Editing and random generation belong to parents.
    for(const el of document.querySelectorAll('#controls input,#controls select,#controls button,#btn-random'))el.disabled=true;
  },
  capture() {
    return {
      params:petPick(petStudioFields.params,params),floor:{...floorParams},rug:{...rugState},light:{...lightAngles},
      weather:{mode:host.weatherMode,thunder:host.thunderEnabled,...weatherAmounts},
      poke:{radius:pokeUniforms.uPokeRadius.value,freq:pokeFeel.freq,damping:pokeFeel.damping},
      hatch:Object.fromEntries(petStudioFields.hatch.map(f=>{const v=hatchUniforms[f.key].value;return [f.key,v?.isColor?'#'+v.getHexString():v];})),
      camera:{x:camera.position.x-motionCameraOffset.x,y:camera.position.y,z:camera.position.z-motionCameraOffset.y,targetX:controls.target.x-motionCameraOffset.x,targetY:controls.target.y,targetZ:controls.target.z-motionCameraOffset.y},
    };
  },
  restore(value) {
    resetMotionWorld();
    if(value.rug)Object.assign(rugState,value.rug);
    if(value.params){Object.assign(params,value.params);host.staticPoseBeforeMotion=params.pose;host.setParams(value.params);}
    if(value.floor){Object.assign(floorParams,value.floor);drawWoodFloor();}
    if(value.rug){rugLayer.setSeed(rugState.seed);rugLayer.setVisible(rugState.enabled);syncRugPlacement();}
    if(value.light){Object.assign(lightAngles,value.light);updateKeyLight();syncLightOrb();}
    if(value.weather){setThunder(value.weather.thunder??false);setWeather(value.weather.mode||'sunny');for(const type of ['rain','cloud','fish'])if(value.weather[type]!==undefined)setWeatherAmount(type,value.weather[type]);}
    if(value.poke){if(value.poke.radius!==undefined)pokeUniforms.uPokeRadius.value=value.poke.radius;for(const key of ['freq','damping'])if(value.poke[key]!==undefined)pokeFeel[key]=value.poke[key];}
    if(value.hatch)for(const [key,v] of Object.entries(value.hatch)){const uniform=hatchUniforms[key];if(uniform.value?.isColor)uniform.value.set(v);else uniform.value=v;}
    sketchShadowMat.color.copy(hatchUniforms.uGroundHatchColor.value);blockShadowMat.color.copy(hatchUniforms.uGroundShadowColor.value);
    if(value.camera){const c=value.camera;camera.position.set(c.x??camera.position.x,c.y??camera.position.y,c.z??camera.position.z);controls.target.set(c.targetX??controls.target.x,c.targetY??controls.target.y,c.targetZ??controls.target.z);controls.update();}
    refreshers.forEach(f=>f());petControlSyncs.forEach(f=>f());
  },
  restrict({floor=true,toy='mixed',count=99,cushion=false}) {
    ground.visible=floor;
    toyWorld.releaseGrab();
    toyWorld.scatterAroundRug(rugLayer.getBounds(),rugState.seed);
    let shown=0;
    let hidden=0;
    const all=toyWorld.toys.filter(t=>t.kind!=='bed');
    const pool=toy==='mixed'?['yarn','ball','fish','duck','yarn'].map((kind,i)=>all.filter(t=>t.kind===kind)[i===4?1:0]):all.filter(t=>t.kind===toy);
    const active=new Set(pool.filter(Boolean).slice(0,count));
    for(const t of toyWorld.toys){const visible=active.has(t)||(t.kind==='bed'&&cushion);if(visible)shown++;t.mesh.visible=visible;t.shadowProxy.visible=visible;t.body.collisionFilterMask=visible?-1:0;if(!visible)t.body.position.set(0,-100-hidden++,0);}
    toyWorld.group.visible=shown>0;
  },
  playProgram(plan){petActivePlan=plan;petLastElapsed=0;host.setAnimation({enabled:true,stateMachine:false,action:plan.segments[0].clip,speed:1,intensity:plan.motion.intensity});},
  stop(){
    petActivePlan=null;host.setAnimation({enabled:false,stateMachine:false});
    if(petChildMotion&&host.cat){host.cat.position.x=petWander.x;host.cat.position.z=petWander.z;host.cat.rotation.set(0,petWander.heading,0);host.cat.updateMatrixWorld(true);}
  },
  clearKeys(){motionMachine.clearKeys();},
  resetRoom(){
    Object.assign(petWander,{x:0,z:0,heading:0,targetX:0,targetZ:.8});petLastElapsed=0;
    if(petRoomBed){petDisposeObjects([petRoomBed]);petRoomBed=null;}
    if(petRoomBedBody){toyWorld.world.removeBody(petRoomBedBody);petRoomBedBody=null;}
    scene.fog=petOriginalRoom.fog.clone();key.color.copy(petOriginalRoom.keyColor);key.intensity=petOriginalRoom.keyIntensity;
    ambient.color.copy(petOriginalRoom.ambientColor);ambient.intensity=petOriginalRoom.ambientIntensity;
    camera.fov=petOriginalRoom.fov;camera.updateProjectionMatrix();
    const g=scene.getObjectByName('procedural-rug-layer');if(g){g.rotation.y=0;for(const mesh of g.children)mesh.scale.set(1,1,1);}
    for(const t of toyWorld.toys)petScaleToy(t,1);
    this.restrict({cushion:true});
  },
  applyRoom(value,slots) {
    if(slots.includes('lighting')){const p=value.lighting;key.color.set(p.keyColor);key.intensity=p.keyIntensity;ambient.color.set(p.ambientColor);ambient.intensity=p.ambientIntensity;Object.assign(lightAngles,{azimuth:p.azimuth,elevation:p.elevation});updateKeyLight();syncLightOrb();}
    if(slots.includes('camera')){const p=value.camera;resetMotionWorld();camera.position.copy(controls.target).add(new THREE.Vector3().setFromSphericalCoords(5.7*p.distance,THREE.MathUtils.degToRad(90-p.elevation),THREE.MathUtils.degToRad(p.azimuth)));camera.fov=p.fov;camera.updateProjectionMatrix();controls.update();}
    if(slots.includes('effect')){const p=value.effect;scene.fog=p.kind==='fog'?new THREE.Fog(p.color,p.near,p.far):petOriginalRoom.fog.clone();}
    if(slots.includes('rug')){const p=value.rug,g=scene.getObjectByName('procedural-rug-layer');if(g){g.rotation.y=THREE.MathUtils.degToRad(p.rotation);const factor=p.size/rugLayer.mesh.scale.x;for(const mesh of g.children){mesh.scale.x*=factor;mesh.scale.y*=factor;}}}
    if(slots.includes('toy')){this.restrict({toy:value.toy.kind,count:value.toy.count,cushion:value.bed.kind==='cushion'});for(const t of toyWorld.toys.filter(t=>t.kind!=='bed'&&t.mesh.visible))petScaleToy(t,value.toy.scale);}
    if(slots.includes('bed')){
      if(petRoomBed){petDisposeObjects([petRoomBed]);petRoomBed=null;}
      if(petRoomBedBody){toyWorld.world.removeBody(petRoomBedBody);petRoomBedBody=null;}
      const p=value.bed,cushion=toyWorld.toys.find(t=>t.kind==='bed');
      cushion.mesh.visible=cushion.shadowProxy.visible=p.kind==='cushion';cushion.body.collisionFilterMask=p.kind==='cushion'?-1:0;
      if(p.kind==='cushion'){petScaleToy(cushion,p.size);cushion.body.position.set(p.x,.15,p.z);cushion.body.velocity.setZero();cushion.body.angularVelocity.setZero();cushion.body.wakeUp();toyWorld.group.visible=true;}
      else {cushion.body.position.set(0,-120,0);if(p.kind!=='none'&&p.placement==='beside'){petRoomBed=petContainerBuild(p,params).mesh;petRoomBed.position.set(p.x,.035,p.z);scene.add(petRoomBed);petRoomBedBody=new petCannon.Body({type:petCannon.Body.STATIC,shape:new petCannon.Box(new petCannon.Vec3(.6*p.size,.28,.6*p.size)),position:new petCannon.Vec3(p.x,.28,p.z)});toyWorld.world.addBody(petRoomBedBody);}}
    }
  },
  pauseAudio(){bgm.pause();},
  motionKey(code,down){motionMachine.setKey(code,down);if(down&&motionMachine.triggerCode(code))host.motionElapsed=0;},
  lock(){bgm.pause();weatherAudio.setRain(false);motionMachine.clearKeys();renderer.setAnimationLoop(null);},
};

  return studio;
}
