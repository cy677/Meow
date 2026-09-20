import { fail } from '../validation.mjs';
export const LOCAL_PROFILE_ID = 'local-child';
/** Created from an authenticated role, NEVER from client JSON or query parameters. */
export function createUserContext(role) {
  if (!['parent','child'].includes(role)) fail(401,'需要有效身份');
  return Object.freeze({userId:`local-${role}`,profileId:LOCAL_PROFILE_ID,role});
}
export function requireContext(context, roles=['parent','child']) {
  if(!context || !roles.includes(context.role)) fail(403,'没有此操作权限');
  if(context.profileId!==LOCAL_PROFILE_ID||context.userId!==`local-${context.role}`)
    fail(400,'当前版本仅支持本地单儿童档案');
  return context;
}
