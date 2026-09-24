import {requireContext} from '../contracts/userContext.mjs';
export function createUserService(store) {
  return {
    me(context) {
      requireContext(context);
      const state=store.snapshot(context.role==='parent');
      return {schemaVersion:1,context,profile:{id:context.profileId,childName:state.childName,petName:state.petName,growth:state.growthProfile}};
    },
    state(context) { requireContext(context); return store.snapshot(context.role==='parent'); },
    history(context,query) { requireContext(context); return store.history(query); },
    profile(context,data) { requireContext(context,['parent']); return store.profile(data); },
    appearance(context,data) { requireContext(context,['child']); return store.setAppearance(data.appearance); },
    points(context,data) { requireContext(context,['parent']); return store.points(data); },
    storage(context) { requireContext(context,['parent']); return store.storageInfo(); },
    export(context) { requireContext(context,['parent']); return store.exportData(); },
  };
}
