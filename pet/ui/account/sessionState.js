/** Server-resolved context is display/routing state, never an authorization source. */
export function createSessionState(role) {
  let current=null;
  return {
    accept(response) {
      if(!response.context||response.context.role!==role||typeof response.csrf!=='string')throw new Error('会话角色或上下文无效');
      if(current&&current.context.profileId!==response.context.profileId)throw new Error('档案发生变化，请重新登录');
      current={csrf:response.csrf,expires:response.expires,context:Object.freeze({...response.context})};
      return current;
    },
    get csrf(){return current?.csrf??'';},
    get context(){return current?.context??null;},
    clear(){current=null;},
  };
}
