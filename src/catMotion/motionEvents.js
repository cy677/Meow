import { requireClip } from './clipCatalog.js';

/** Per-instance listeners: no DOM, global bus, or physics side effects. */
export function createMotionEvents({onListenerError=()=>{}}={}) {
  const listeners=new Map();let disposed=false;
  return {
    on(type,listener) {
      if(disposed)throw new Error('动作事件系统已释放');
      if(typeof type!=='string'||typeof listener!=='function')throw new TypeError('事件名与监听函数无效');
      if(!listeners.has(type))listeners.set(type,new Set());
      listeners.get(type).add(listener);
      return ()=>{listeners.get(type)?.delete(listener);if(!listeners.get(type)?.size)listeners.delete(type);};
    },
    emit(type,payload={}) {
      if(disposed)return;
      const event=Object.freeze({...payload,type});
      for(const fn of [...(listeners.get(type)||[]),...(listeners.get('*')||[])]) {
        try{fn(event);}catch(error){try{onListenerError(error,event);}catch{/* Listener errors must not break the render clock. */}}
      }
    },
    dispose(){disposed=true;listeners.clear();},
  };
}
/** (from,to] crossing test catches skipped render frames and repeated segments.
 * Each segment has its own identity, so a loop emits once per actual cycle.
 */
export function markersBetween(plan,from,to) {
  if(!Number.isFinite(to)||!(Number.isFinite(from)||from===-Infinity)||to<from)return [];
  const events=[];
  plan.segments.forEach((segment,index)=>{
    requireClip(segment.clip).markers.forEach((marker,markerIndex)=>{
      const time=segment.start+marker.phase*segment.duration;
      if(time>from && time<=to)events.push({...marker,time,clip:segment.clip,segment:index,markerIndex,semanticOnly:true});
    });
  });
  return events.sort((a,b)=>a.time-b.time||a.segment-b.segment||a.markerIndex-b.markerIndex);
}
