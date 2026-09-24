import { createClipPlayer } from './clipPlayer.js';
import { requireClip } from './clipCatalog.js';

const locomotion=id=>['walk','run','sneak'].includes(id);
/** Editor/keyboard adapter. Integrate phase rather than multiplying total wall
 * time by the NEW speed. Script players already own a playhead and bypass this.
 */
export function createRealtimePlayer(rig,cat) {
  const player=createClipPlayer(rig,cat,{applyRoot:false});
  let action=null,phase=0,entryElapsed=0,transition=.25,direction=1,lastElapsed=null;
  return {
    update(dt,{actionId='idle',speed=1,intensity=.85,travelDirection=1,elapsed}={}) {
      if(![dt,speed,intensity].every(Number.isFinite)||dt<0)throw new TypeError('动作时钟参数必须是非负有限数值');
      if(elapsed!==undefined&&!Number.isFinite(elapsed))throw new TypeError('无效动作时间');
      const restarted=elapsed!==undefined&&lastElapsed!==null&&elapsed<lastElapsed-1e-9;
      const clip=requireClip(actionId),reverse=travelDirection<0?-1:1,delta=Math.min(.1,dt);
      if(action===null)player.capture();
      if(action!==actionId||direction!==reverse||restarted){
        const keepPhase=action&&locomotion(action)&&locomotion(actionId)&&(!restarted||action!==actionId);
        phase=keepPhase?phase%1:0;player.begin();entryElapsed=0;
        transition=keepPhase?.20:['sit','rest-pose','death','stretch'].includes(actionId)?.32:.22;
        action=actionId;direction=reverse;
      }
      lastElapsed=elapsed??lastElapsed;
      phase+=delta*Math.max(.1,Math.min(3,speed))/clip.duration;
      if(clip.loop)phase%=1;else phase=Math.min(1,phase);
      entryElapsed+=delta;
      return player.renderClip(actionId,phase,{intensity,travelDirection},Math.min(1,entryElapsed/transition));
    },
    reset(){action=null;phase=0;entryElapsed=0;lastElapsed=null;player.capture();},
    dispose(){player.dispose();},
  };
}
