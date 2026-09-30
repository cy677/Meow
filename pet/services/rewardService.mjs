import {requireContext} from '../contracts/userContext.mjs';
export function createRewardService(store) {
  return {
    catalog(context) { requireContext(context,['parent']); return store.catalog(); },
    presets(context) { requireContext(context,['parent']); return {catalog:store.catalog(),revision:store.catalogRevision()}; },
    saveCatalog(context,data,revision) { requireContext(context,['parent']); return store.saveCatalog(data,revision); },
    savePreset(context,data) { requireContext(context,['parent']); return store.savePreset(data.reward,data.expectedRevision); },
    purchase(context,data) { requireContext(context,['child']); return store.purchase(data); },
    equip(context,data) { requireContext(context,['child']); return store.equip(data.rewardId); },
    unequip(context,data) { requireContext(context,['child']); return store.unequip(data.slot); },
    randomScript(context,data) { requireContext(context,['child']); return store.setRandomScript(data.rewardId,data.enabled); },
    play(context,data) { requireContext(context,['child']); return store.play(data.rewardId); },
    config(context) {
      requireContext(context,['child']); const s=store.snapshot();
      return {version:s.version,params:s.params,sceneParams:s.sceneParams,creation:s.creation,equipped:s.equipped,
        actions:s.access.actions.map(({id,action,motion})=>({id,action,...(motion?{motion}:{})}))};
    },
  };
}
