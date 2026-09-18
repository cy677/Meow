/** The home stage runs the complete original renderer without a second entrance. */
export function createHomeScene(host) {
  const frame=document.createElement('iframe');frame.className='home-scene';frame.title='小猫互动场景';
  let message;
  const controller={
    applyState(state){frame.contentWindow?.meowHome?.applyState(state);},
    play(action,motion){frame.contentWindow?.meowHome?.play(action,motion);},
    feature(name){frame.contentWindow?.meowHome?.feature(name);},
    dispose(){window.removeEventListener('message',message);host.removeEventListener('meow:overlay-change',overlay);frame.remove();delete host.dataset.ready;},
  };
  const overlay=event=>frame.contentWindow?.meowHome?.overlay(event.detail);
  host.addEventListener('meow:overlay-change',overlay);
  controller.ready=new Promise((resolve,reject)=>{
    message=event=>{
      if(event.origin!==location.origin||event.source!==frame.contentWindow)return;
      if(event.data?.type==='meow:ready'){host.dataset.ready='true';resolve(controller);}
      if(event.data?.type==='meow:error'){controller.dispose();reject(new Error(event.data.message));}
    };
    window.addEventListener('message',message);frame.src='./studio.html?embedded=1';host.append(frame);
  });
  return controller;
}
