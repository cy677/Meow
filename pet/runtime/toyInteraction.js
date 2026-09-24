const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
const angleDelta=(to,from)=>Math.atan2(Math.sin(to-from),Math.cos(to-from));
const kinds=new Set(['ball','yarn','fish','duck']);

/** Short, interruptible look → approach → paw → watch interaction. The host
 * owns the rendered pose and physics; this module never teleports a toy.
 */
export function createToyInteraction({getToys,getPose,getReach,blocked,dragging,play,tap}) {
  let target=null,phase='idle',elapsed=0,age=0,cooldown=0,actionDuration=0,touched=false,speed=0,reach=null;
  const usable=toy=>toy?.mesh.visible&&toy.body.collisionFilterMask!==0&&toy.body.mass>0&&
    kinds.has(toy.kind)&&toy.body.position.y>=-.1&&toy.body.position.y<=toy.radius+.3&&
    Math.hypot(toy.body.velocity.x,toy.body.velocity.z)<1.8;
  const geometry=toy=>{
    const pose=getPose(),dx=toy.body.position.x-pose.x,dz=toy.body.position.z-pose.z;
    const forward=Math.max(.25,reach.forward)+toy.radius*.65+.06;
    return {distance:Math.hypot(dx,dz),standOff:Math.hypot(reach.side,forward),
      heading:Math.atan2(dx,dz)-Math.atan2(reach.side,forward)};
  };
  function cancel(){if(target)cooldown=7;target=null;phase='idle';elapsed=0;speed=0;}
  function enter(next,action){phase=next;elapsed=0;actionDuration=play(action)||0;}
  return {
    start(){
      if(target||cooldown>0||dragging())return false;
      reach=getReach();
      const pose=getPose();
      const candidates=getToys().filter(usable).map(toy=>({toy,...geometry(toy)}))
        .filter(c=>c.distance<2.8&&c.distance>=c.standOff-.25).sort((a,b)=>a.distance-b.distance);
      for(const candidate of candidates){
        const {toy,distance,standOff,heading}=candidate,travel=Math.max(0,distance-standOff);
        const dx=Math.sin(heading)*travel,dz=Math.cos(heading)*travel;
        if(Math.hypot(pose.x+dx,pose.z+dz)>1.25)continue;
        const steps=Math.max(1,Math.ceil(travel/.15));let clear=true;
        for(let i=1;i<=steps;i++)if(blocked(pose.x+dx*i/steps,pose.z+dz*i/steps,heading)){clear=false;break;}
        if(!clear)continue;
        target=toy;age=0;touched=false;speed=0;enter('looking','idle-alert');return true;
      }
      cooldown=2;return false;
    },
    update(dt){
      const delta=clamp(dt,0,.1);cooldown=Math.max(0,cooldown-delta);
      if(!target)return;
      elapsed+=delta;age+=delta;
      if(!usable(target)||dragging()||age>12){cancel();play('idle-alert');return;}
      const pose=getPose(),g=geometry(target),turn=angleDelta(g.heading,pose.heading);
      if(phase==='looking'||phase==='approaching')pose.heading+=clamp(turn,-1.7*delta,1.7*delta);
      if(phase==='looking'&&elapsed>=.6)enter('approaching','walk');
      else if(phase==='approaching'){
        const gap=g.distance-g.standOff;
        if(gap<=.07&&Math.abs(turn)<.16){speed=0;enter('pawing','paw');return;}
        if(elapsed>4.5||g.distance>3){cancel();play('idle-alert');return;}
        const wanted=.42*clamp(gap/.4,0,1)*Math.max(0,Math.cos(turn));
        speed+=(wanted-speed)*(1-Math.exp(-delta*7));
        const x=pose.x+Math.sin(pose.heading)*speed*delta,z=pose.z+Math.cos(pose.heading)*speed*delta;
        if(Math.hypot(x,z)>1.25||blocked(x,z,pose.heading)){cancel();play('idle-alert');return;}
        pose.x=x;pose.z=z;
      }else if(phase==='pawing'&&elapsed>=actionDuration)enter('watching','idle-alert');
      else if(phase==='watching'&&elapsed>=1){cancel();}
    },
    contact(){
      if(!target||phase!=='pawing'||touched)return false;
      // One contact attempt per swing; the physical reach test can legitimately miss.
      touched=true;return tap(target);
    },
    cancel,
    getState:()=>({active:!!target,phase,target:target?.kind??null,touched,elapsed}),
    get active(){return !!target;},
  };
}
