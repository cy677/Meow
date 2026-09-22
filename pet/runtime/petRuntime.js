import {createModelRegistry} from './modelRegistry.js';
import {createMeowCatModel} from './meowCatModel.js';
import {createSceneCaptureProvider} from './cameraProvider.js';

/** Composition root: UI code neither reaches bones nor simulates a second cat. */
export function createPetRuntime(native,{modelId='meow-procedural',registry=createModelRegistry()}={}) {
  if(!registry.list().includes('meow-procedural'))registry.register('meow-procedural',createMeowCatModel);
  const model=registry.create(modelId,native);
  let loaded;try{loaded=model.load();}catch(error){model.dispose();throw error;}
  const camera=createSceneCaptureProvider(native.photo);
  let disposed=false;
  const ensure=()=>{if(disposed)throw new Error('小猫运行时已销毁');};
  const invoke=name=>(...args)=>{ensure();return native[name](...args);};
  return {
    model,camera,registry,ready:Promise.resolve(loaded),
    capture:invoke('capture'),captureState:invoke('capture'),
    restore(value){ensure();const {params,...rest}=value;if(params)model.applyAppearance(params);if(Object.keys(rest).length)native.restore(rest);},
    playProgram(plan){ensure();model.playAction(plan);},
    stop(){if(!disposed)model.stop();},
    update(delta){ensure();model.update(delta);},
    setAccess:invoke('setAccess'),resetRoom:invoke('resetRoom'),applyRoom:invoke('applyRoom'),
    clearKeys:invoke('clearKeys'),resetView:invoke('resetView'),pauseAudio:invoke('pauseAudio'),
    animationState:invoke('animationState'),lock:invoke('lock'),
    dispose(){if(disposed)return;disposed=true;try{camera.dispose();}finally{model.dispose();}},
  };
}
