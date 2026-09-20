export function studioRoutes(service) {
  return [
    ['GET','/api/studio','child',c=>service.read(c.user)],
    ['GET','/api/parent/studio','parent',c=>service.read(c.user)],
    ['PUT','/api/parent/studio','parent',c=>service.save(c.user,c.data),['preset','expectedRevision']],
  ];
}
