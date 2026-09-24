import { readFileSync } from 'node:fs';

export function replaceChecked(code,needle,replacement,expected=1) {
  const count=code.split(needle).length-1;
  if(count!==expected)throw new Error(`原版适配点失配：${needle}；预期 ${expected}，实际 ${count}`);
  return code.split(needle).join(replacement);
}
// Compatibility boundary only. Runtime behavior now lives in an ordinary module.
const anchors = [
  [
    "    motionMachine.translate(contactShift.x, contactShift.z);",
    "    if (petStudio.childMotion) { petStudio.worldPose.x += contactShift.x; petStudio.worldPose.z += contactShift.z; petStudio.avoidObstacle(contactShift); }\n    else motionMachine.translate(contactShift.x, contactShift.z);",
    1
  ],
  [
    "let worldX = 0;",
    "let worldX = petStudio.childMotion ? petStudio.worldPose.x : 0;",
    1
  ],
  [
    "let worldZ = 0;",
    "let worldZ = petStudio.childMotion ? petStudio.worldPose.z : 0;",
    1
  ],
  [
    "let worldHeading = 0;",
    "let worldHeading = petStudio.childMotion ? petStudio.worldPose.heading : 0;",
    1
  ],
  [
    "    motionWasEnabled = true;",
    "    if (petStudio.childMotion) { worldX=petStudio.worldPose.x; worldZ=petStudio.worldPose.z; worldHeading=petStudio.worldPose.heading; }\n    motionWasEnabled = true;",
    1
  ],
  [
    "    if (params.motionDebug && params.motionStateMachine) {",
    "    if (petStudio.childMotion && !motionState) cat.rotation.set(0,worldHeading,0);\n    if ((params.motionDebug && params.motionStateMachine) || petStudio.childMotion) {",
    1
  ],
  [
    "motionState = motionRig.update(motionElapsed, {",
    "motionState = petStudio.sampleMotion(motionElapsed, {",
    1
  ],
  [
    "const bgm =",
    "const petControlSyncs = [];\nconst bgm =",
    1
  ],
  [
    "return { row, input, sync };",
    "petControlSyncs.push(sync); return { row, input, sync };",
    3
  ],
  [
    "return { row, select, sync };",
    "petControlSyncs.push(sync); return { row, select, sync };",
    1
  ],
  [
    "return refresh;",
    "petControlSyncs.push(refresh); return refresh;",
    1
  ]
];
const bridge = "\nimport { createStudioAdapter } from '../pet/runtime/createStudioAdapter.js';\nexport const petStudio=createStudioAdapter({\n  THREE,params,key,ambient,camera,scene,controls,motionCameraOffset,floorParams,rugState,lightAngles,weatherAmounts,pokeUniforms,pokeFeel,hatchUniforms,sketchShadowMat,blockShadowMat,refreshers,petControlSyncs,ground,toyWorld,rugLayer,motionMachine,bgm,weatherAudio,renderer,resetMotionWorld,drawWoodFloor,syncRugPlacement,updateKeyLight,syncLightOrb,setThunder,setWeather,setWeatherAmount,\n  get cat(){return cat;},get motionRig(){return motionRig;},\n  get weatherMode(){return weatherMode;},get thunderEnabled(){return thunderEnabled;},\n  set staticPoseBeforeMotion(value){staticPoseBeforeMotion=value;},\n  set motionElapsed(value){motionElapsed=value;},\n  setParams:value=>window.__setParams(value),setAnimation:value=>window.__setAnimation(value),\n  animationState:()=>window.__getAnimation(),photo:shareCardCapture,\n});\n";
export function studioBuild() {
  const template=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  return {name:'pet-original-runtime',enforce:'pre',
    transformIndexHtml:{order:'pre',handler(html,context){
      if(!context.filename.replaceAll('\\','/').endsWith('/pet/studio.html'))return html;
      let result=template.replaceAll('/src/','../src/');
      result=replaceChecked(result,'src="../src/main.js"','src="./studio.js"');
      return replaceChecked(result,'<title>Meow Generator</title>','<title>原版互动 · Meow 积分小猫</title>');
    }},
    transform(code,id){
      if(!id.split('?')[0].replaceAll('\\','/').endsWith('/src/main.js'))return null;
      for(const [needle,replacement,count] of anchors)code=replaceChecked(code,needle,replacement,count);
      return {code:code+bridge,map:null};
    },
  };
}
