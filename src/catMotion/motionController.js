import { CLIP_BY_ID } from './clipCatalog.js';
import { planMotion, timelineLayers } from './motionScript.js';
import { createMotionEvents, markersBetween } from './motionEvents.js';
import { TARGET_SLOTS } from './skeleton.js';

/** Animation scheduling only. The caller supplies ONE render clock in seconds.
 * Priority is 0..100. Protected clips queue interruptions; force is an explicit
 * caller choice. Resume preserves the suspended playhead and emitted markers.
 */
export function createMotionController(player,{maxQueue=16,onListenerError}={}) {
  if(!Number.isInteger(maxQueue)||maxQueue<1||maxQueue>64)throw new RangeError('队列容量必须为 1–64');
  const events=createMotionEvents({onListenerError}),queue=[],suspended=[],targets=new Map();
  let current=null,ending=null,paused=false,disposed=false,serial=0,idleTime=0,revision=0;
  const assertLive=()=>{if(disposed)throw new Error('动作运行时已释放');};
  const info=job=>({id:job.id,action:job.plan.action,elapsed:job.elapsed,duration:job.plan.duration,priority:job.priority});
  function start(job,resumed=false,interrupted=null,resumePrevious=false) {
    current=job;ending=null;job.entryElapsed=0;player.begin();
    player.render(job.plan,job.elapsed,0);
    if(interrupted)events.emit('interrupted',{...info(interrupted),willResume:resumePrevious});
    if(current===job&&!disposed)events.emit(resumed?'resumed':'started',info(job));
  }
  function next() {
    const resumable=suspended.at(-1);
    if(queue.length && (!resumable||queue[0].priority>=resumable.priority))start(queue.shift());
    else if(resumable)start(suspended.pop(),true);
    else {current=null;ending={elapsed:0,duration:.25};player.begin();}
  }
  function canInterrupt() {
    return !current || timelineLayers(current.plan,current.elapsed).filter(l=>l.weight>0).every(l=>CLIP_BY_ID.get(l.clip).interruptible);
  }
  function request(plan,options={}) {
    assertLive();
    const {priority=0,enqueue=false,resumePrevious=false,force=false}=options;
    if(!Number.isInteger(priority)||priority<0||priority>100 || [enqueue,resumePrevious,force].some(v=>typeof v!=='boolean'))throw new TypeError('动作调度选项无效');
    const job={id:++serial,plan,priority,elapsed:0,entryElapsed:0,cursor:-Infinity};
    if(enqueue&&current || current&&(priority<current.priority||!force&&!canInterrupt())) {
      if(queue.length>=maxQueue)throw new RangeError('动作队列已满');
      queue.push(job);queue.sort((a,b)=>b.priority-a.priority||a.id-b.id);
      events.emit('queued',info(job));return {...info(job),status:'queued',duration:plan.duration+plan.transition};
    }
    let interrupted=null;
    if(current) {
      if(resumePrevious){if(suspended.length>=maxQueue)throw new RangeError('暂停动作栈已满');suspended.push(current);}
      interrupted=current;current=null;
    }
    revision++;start(job,false,interrupted,resumePrevious);return {...info(job),status:'playing',duration:plan.duration+plan.transition};
  }
  const api={
    play(action,motion={},script=motion?.script,options={}) {return request(planMotion(action,motion,script),options);},
    playPlan(plan,options={}) {return request(planMotion(plan.action,plan.motionInput??plan.motion,plan.script??plan.motion?.script),options);},
    playScript(script,motion={},options={}) {
      return typeof script==='string'?api.play(script,motion,motion.script,options):api.play('sequence',motion,script,options);
    },
    enqueue(action,motion={},script=motion?.script,options={}) {return api.play(action,motion,script,{...options,enqueue:true});},
    update(dt) {
      if(disposed||paused)return !!current||!!ending;
      if(!Number.isFinite(dt)||dt<0)throw new TypeError('帧间隔必须为非负有限秒数');
      const delta=Math.min(.1,dt);idleTime+=delta;
      if(current) {
        const job=current;job.elapsed=Math.min(job.plan.duration,job.elapsed+delta);job.entryElapsed+=delta;
        player.render(job.plan,job.elapsed,job.entryElapsed);
        const crossed=markersBetween(job.plan,job.cursor,job.elapsed);job.cursor=job.elapsed;
        for(const marker of crossed) {
          if(current!==job)break;
          events.emit(marker.event,{...marker,jobId:job.id,action:job.plan.action});
        }
        if(current===job && job.elapsed>=job.plan.duration) {
          current=null;const beforeEvents=revision;
          events.emit('completed',info(job));
          if(!current&&revision===beforeEvents&&!disposed) {
            next();
            if(ending)ending.duration=job.plan.transition;
          }
        }
      } else if(ending) {
        ending.elapsed+=delta;player.idle(idleTime,Math.min(1,ending.elapsed/ending.duration));
        if(ending.elapsed>=ending.duration){ending=null;events.emit('idle');}
      } else player.idle(idleTime);
      return !!current||!!ending;
    },
    stop({immediate=false}={}) {
      assertLive();revision++;queue.length=0;suspended.length=0;
      const job=current;current=null;
      ending=immediate?null:{elapsed:0,duration:job?.plan.transition??.25};player.begin();
      if(immediate)player.idle(idleTime,1);
      if(job)events.emit('cancelled',info(job));
      if(immediate)events.emit('idle');
    },
    cancel(){api.stop({immediate:true});},
    pause(on=true){assertLive();if(typeof on!=='boolean')throw new TypeError('暂停状态必须为布尔值');if(paused!==on){paused=on;events.emit(on?'paused':'unpaused');}},
    resume(){api.pause(false);},
    on:events.on,
    setTarget(slot,point) {
      assertLive();if(!TARGET_SLOTS.includes(slot))throw new RangeError('未知动作目标槽位');
      if(point===null){targets.delete(slot);return;}
      if(!point||!['x','y','z'].every(k=>typeof point[k]==='number'&&Number.isFinite(point[k])))throw new TypeError('目标必须包含有限的 x/y/z');
      targets.set(slot,Object.freeze({x:point.x,y:point.y,z:point.z}));
    },
    getPlan:()=>current?.plan??null,
    getTargets:()=>Object.fromEntries([...targets].map(([k,v])=>[k,{...v}])),
    getState:()=>({active:!!current||!!ending,paused,status:disposed?'disposed':paused?'paused':current?'playing':ending?'returning':'idle',
      current:current?info(current):null,queue:queue.map(info),suspended:suspended.map(info),targetsApplied:false}),
    get active(){return !!current||!!ending;},
    dispose(){if(disposed)return;disposed=true;revision++;current=null;ending=null;queue.length=0;suspended.length=0;targets.clear();events.dispose();player.dispose?.();},
  };
  return api;
}
