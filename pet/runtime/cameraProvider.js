/** Scene capture and the device camera have independent, disposable lifetimes. */
export function createSceneCaptureProvider(capture) {
  for(const key of ['open','close','capture','dispose'])if(typeof capture?.[key]!=='function')throw new TypeError(`缺少拍照能力：${key}`);
  let disposed=false;
  const ensure=()=>{if(disposed)throw new Error('拍照提供者已销毁');};
  return {
    id:'scene',capabilities:Object.freeze({deviceCamera:false,sceneCapture:true}),
    get active(){return !disposed&&capture.active;},
    start(){ensure();capture.open();},
    stop(){if(!disposed)capture.close();},
    capture(options){ensure();return capture.capture(options);},
    dispose(){if(disposed)return;disposed=true;capture.dispose();},
  };
}
export {createDeviceCameraProvider} from '../../src/camera/deviceCamera.js';
