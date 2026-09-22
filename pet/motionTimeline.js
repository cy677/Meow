import { createClipPlayer } from '../src/catMotion/clipPlayer.js';
/** Legacy absolute-time adapter. All evaluation and full-root crossfades are now
 * shared with the preview/controller; the stage applies the returned root once.
 */
export function createMotionTimeline(rig,cat) {
  const player=createClipPlayer(rig,cat,{applyRoot:false});
  let lastPlan=null,lastTime=-1;
  const sample=(plan,time)=>{
    if(lastPlan!==plan||time<lastTime){player.begin();lastPlan=plan;}
    lastTime=time;
    return player.render(plan,time);
  };
  sample.dispose=()=>player.dispose();
  return sample;
}
