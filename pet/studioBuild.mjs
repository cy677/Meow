import { readFileSync } from 'node:fs';
// Reuse the original renderer and original HTML, not a reduced reconstruction.
export function studioBuild() {
  const template=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const bridge=readFileSync(new URL('./studioRuntime.txt',import.meta.url),'utf8');
  return {name:'pet-original-runtime',enforce:'pre',
    transformIndexHtml:{order:'pre',handler(html,context){
      if(!context.filename.replaceAll('\\','/').endsWith('/pet/studio.html'))return html;
      return template.replaceAll('/src/','../src/').replace('src="../src/main.js"','src="./studio.js"').replace('<title>Meow Generator</title>','<title>原版互动 · Meow 积分小猫</title>');
    }},
    transform(code,id){
      if(!id.replaceAll('\\','/').endsWith('/src/main.js'))return null;
      return {code:code.replace('let worldX = 0;', 'let worldX = petChildMotion ? petWander.x : 0;').replace('let worldZ = 0;', 'let worldZ = petChildMotion ? petWander.z : 0;').replace('let worldHeading = 0;', 'let worldHeading = petChildMotion ? petWander.heading : 0;').replace('    motionWasEnabled = true;', '    if (petChildMotion) { worldX=petWander.x; worldZ=petWander.z; worldHeading=petWander.heading; }\n    motionWasEnabled = true;').replace('    if (params.motionDebug && params.motionStateMachine) {', '    if (petChildMotion && !motionState) cat.rotation.set(0,worldHeading,0);\n    if ((params.motionDebug && params.motionStateMachine) || petChildMotion) {').replace('motionState = motionRig.update(motionElapsed, {','motionState = petSampleMotion(motionElapsed, {').replace('const i18n =','const petControlSyncs = [];\nconst i18n =').replaceAll('return { row, input, sync };','petControlSyncs.push(sync); return { row, input, sync };').replaceAll('return { row, select, sync };','petControlSyncs.push(sync); return { row, select, sync };').replaceAll('return refresh;','petControlSyncs.push(refresh); return refresh;')+'\n'+bridge,map:null};
    },
  };
}
