export function rewardRoutes(service) {
  return [
    ['GET','/api/pet/config','child',c=>service.config(c.user)],
    ['GET','/api/parent/catalog','parent',c=>service.catalog(c.user)],
    ['GET','/api/parent/presets','parent',c=>service.presets(c.user)],
    ['PUT','/api/parent/catalog','parent',c=>service.saveCatalog(c.user,c.data,c.req.headers['if-match'])],
    ['PUT','/api/parent/presets','parent',c=>service.savePreset(c.user,c.data),['reward','expectedRevision']],
    ['POST','/api/purchase','child',c=>service.purchase(c.user,c.data),['rewardId','idempotencyKey','expectedCost']],
    ['POST','/api/equip','child',c=>service.equip(c.user,c.data),['rewardId']],
    ['POST','/api/unequip','child',c=>service.unequip(c.user,c.data),['slot']],
    ['POST','/api/random-script','child',c=>service.randomScript(c.user,c.data),['rewardId','enabled']],
    ['POST','/api/play','child',c=>service.play(c.user,c.data),['rewardId']],
  ];
}
