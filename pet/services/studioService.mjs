import {requireContext} from '../contracts/userContext.mjs';
export function createStudioService(store) {
  return {
    read(context) { requireContext(context); return store.studio(context.role==='parent'); },
    save(context,data) { requireContext(context,['parent']); return store.saveStudio(data.preset,data.expectedRevision); },
  };
}
