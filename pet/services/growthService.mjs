import {requireContext} from '../contracts/userContext.mjs';
export function createGrowthService(store) {
  const parent = (context,method,data) => { requireContext(context,['parent']); return store.growth[method](data); };
  return {
    read(context,query) { requireContext(context); return {...store.growth.read(context.role==='parent',query),visualization:store.growth.summary(query)}; },
    summary(context,query) { requireContext(context); return store.growth.summary(query); },
    configure:(context,data)=>parent(context,'configure',data),
    saveTask:(context,data)=>parent(context,'saveTask',data),
    award:(context,data)=>parent(context,'award',data),
    cancel:(context,data)=>parent(context,'cancelSubmission',data),
    classify:(context,data)=>parent(context,'classify',data),
    correct:(context,data)=>parent(context,'correct',data),
    submit(context,data) { requireContext(context,['child']); return store.growth.submit(data); },
  };
}
