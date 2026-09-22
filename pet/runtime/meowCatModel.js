/** The procedural model owns its existing render clock; do not start a second loop. */
export function createMeowCatModel(native) {
  let disposed=false;
  const ensure=()=>{if(disposed)throw new Error('小猫模型已销毁');};
  return {
    id:'meow-procedural',externallyDriven:true,
    load(){ensure();return this;},
    applyAppearance(params){ensure();native.restore({params});},
    playAction(plan){ensure();native.playProgram(plan);},
    setPose(pose){ensure();native.restore({params:{pose}});},
    update(){ensure();},
    stop(){if(!disposed)native.stop();},
    dispose(){if(disposed)return;native.stop();native.lock();disposed=true;},
  };
}
