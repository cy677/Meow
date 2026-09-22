import * as THREE from 'three';
import { createMesh2MotionSkinRig } from '../src/mesh2motionSkinRig.js';
import { createClipPlayer } from '../src/catMotion/clipPlayer.js';
import { createMotionController } from '../src/catMotion/motionController.js';

/** Preview adapter. Rig ownership stays here; evaluation/scheduling is shared
 * with the main home stage in src/catMotion. No second animation implementation.
 */
export function createSkeletalPlayer(cat) {
  const rig=createMesh2MotionSkinRig(cat,'standing');
  if(!rig||rig.weightStats.invalidWeights)throw new Error('小猫骨骼绑定失败');
  cat.userData.updateStaticIdle?.(0,false);
  const player=createClipPlayer(rig,cat),motion=createMotionController(player);
  motion.update(0);
  return {
    rig,
    play(action,settings={},script=settings.script,options={}) {return motion.play(action,settings,script,options).duration;},
    playScript:motion.playScript,enqueue:motion.enqueue,
    stop:motion.stop,cancel:motion.cancel,update:motion.update,
    pause:motion.pause,resume:motion.resume,on:motion.on,
    setTarget:motion.setTarget,getTargets:motion.getTargets,getState:motion.getState,
    get active(){return motion.active;},
    getDiagnostics() {
      const position=rig.fur.geometry.getAttribute('position'),state=player.getState(),scheduler=motion.getState();
      const deformed=[];
      for(let i=0;i<position.count;i+=Math.max(1,Math.floor(position.count/32))) {
        const point=new THREE.Vector3().fromBufferAttribute(position,i);
        rig.fur.applyBoneTransform(i,point);deformed.push(...point.toArray());
      }
      return {type:rig.type,action:scheduler.current?.action??'idle',clip:state.actionId??'idle',
        source:state.source??'mesh2motion',sourceFrame:state.retarget?.sourceFrame??null,
        bones:rig.skeleton.bones.length,weights:rig.weightStats,geometryId:rig.fur.geometry.uuid,
        vertices:position.count,positionVersion:position.version,active:motion.active,
        elapsed:scheduler.current?.elapsed??0,scheduler,
        boneQuaternions:rig.skeleton.bones.map(b=>b.quaternion.toArray()),deformed,
        boneLengthError:rig.getState()?.boneLengthError??0};
    },
    dispose(){motion.dispose();rig.skeleton.dispose();},
  };
}
