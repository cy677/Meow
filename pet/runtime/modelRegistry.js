const METHODS=['load','applyAppearance','playAction','setPose','update','stop','dispose'];
export function createModelRegistry() {
  const entries=new Map();
  return Object.freeze({
    register(id,factory) {
      if(typeof id!=='string'||!/^[-a-z0-9]+$/.test(id)||typeof factory!=='function')throw new TypeError('模型注册无效');
      if(entries.has(id))throw new Error('模型已注册：'+id);
      entries.set(id,factory);
    },
    list(){return [...entries.keys()];},
    create(id,context) {
      const factory=entries.get(id);if(!factory)throw new Error('模型尚未接入：'+id);
      const model=factory(context);
      for(const key of METHODS)if(typeof model?.[key]!=='function')throw new TypeError(`模型 ${id} 缺少 ${key}`);
      return model;
    },
  });
}
