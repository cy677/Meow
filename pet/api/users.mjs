export function userRoutes(service) {
  const history=c=>service.history(c.user,{before:c.query.has('before')?Number(c.query.get('before')):null,
    limit:c.query.has('limit')?Number(c.query.get('limit')):40,kind:c.query.get('kind')??'all',q:c.query.get('q')??'',category:c.query.get('category')??'all'});
  return [
    ['GET','/api/me','child',c=>service.me(c.user)],
    ['GET','/api/parent/me','parent',c=>service.me(c.user)],
    ['GET','/api/state','child',c=>service.state(c.user)],
    ['GET','/api/parent/state','parent',c=>service.state(c.user)],
    ['GET','/api/history','child',history],['GET','/api/parent/history','parent',history],
    ['POST','/api/parent/points','parent',c=>service.points(c.user,c.data),['delta','reason','idempotencyKey']],
    ['POST','/api/appearance','child',c=>service.appearance(c.user,c.data),['appearance']],
    ['PUT','/api/parent/profile','parent',c=>service.profile(c.user,c.data),['childName','petName']],
    ['GET','/api/parent/storage','parent',c=>service.storage(c.user)],
    ['GET','/api/parent/export','parent',c=>{c.res.setHeader('Content-Disposition','attachment; filename="meow-progress.json"');return service.export(c.user);}],
  ];
}
