export function growthRoutes(service) {
  const read=c=>service.read(c.user,{days:c.query.has('days')?Number(c.query.get('days')):7});
  const summary=c=>service.summary(c.user,{days:c.query.has('days')?Number(c.query.get('days')):7});
  return [
    ['GET','/api/growth/summary','child',summary],
    ['GET','/api/parent/growth/summary','parent',summary],
    ['GET','/api/growth','child',read],
    ['GET','/api/parent/growth','parent',read],
    ['PUT','/api/parent/growth/profile','parent',c=>service.configure(c.user,c.data)],
    ['PUT','/api/parent/growth/tasks','parent',c=>service.saveTask(c.user,c.data)],
    ['POST','/api/parent/growth/award','parent',c=>service.award(c.user,c.data)],
    ['POST','/api/parent/growth/cancel','parent',c=>service.cancel(c.user,c.data)],
    ['POST','/api/parent/growth/classify','parent',c=>service.classify(c.user,c.data)],
    ['POST','/api/parent/growth/correct','parent',c=>service.correct(c.user,c.data)],
    ['POST','/api/growth/submit','child',c=>service.submit(c.user,c.data)],
  ];
}
