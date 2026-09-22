/** Reviewed local assets only. No model URL, script or physics settings come from saved JSON. */
const file = (pack, name) => `models/kenney/${pack}/${name}.glb`;
const brick = name => file('brick-kit', `round-lq-${name}`);
const definition = (id, title, slot, group, cost, unlockAt, description, extra) => Object.freeze({id, title, slot, group, cost, unlockAt, description, ...extra});
export const MODEL_DEFINITIONS = Object.freeze([
  definition('chick','小鸡','companion','小伙伴',25,35,'会在小猫身边走动；轻点打招呼。',{kind:'companion',file:file('cube-pets','animal-chick'),size:.38,position:[1.1,0,.6]}),
  definition('bunny','小兔','companion','小伙伴',40,70,'会跟随小猫、停留休息；轻点打招呼。',{kind:'companion',file:file('cube-pets','animal-bunny'),size:.57,position:[1.1,0,.6]}),
  definition('bee','小蜜蜂','ambient-bee','环境小动物',20,30,'在房间边缘轻轻飞舞；轻点会回应。',{kind:'flyer',file:file('cube-pets','animal-bee'),size:.22,position:[-1.5,1.05,-.4]}),
  definition('caterpillar','毛毛虫','ambient-caterpillar','环境小动物',15,20,'沿地板边缘慢慢爬行；轻点会回应。',{kind:'crawler',file:file('cube-pets','animal-caterpillar'),size:.24,position:[1.5,0,1.3]}),
  definition('car','迷你小汽车','model-vehicle','物理玩具',20,30,'拖动、推开或轻抛的小汽车，可与坡道一起摆放。',{kind:'vehicle',file:file('toy-car-kit','vehicle-speedster'),size:.60,position:[.9,0,1.35]}),
  definition('racer','迷你赛车','model-vehicle','物理玩具',25,45,'小巧赛车，可抓取、滚动，与其他玩具碰撞。',{kind:'vehicle',file:file('toy-car-kit','vehicle-racer'),size:.63,position:[.9,0,1.35]}),
  definition('truck','小卡车','model-vehicle','物理玩具',30,60,'稍重的小卡车，可抓取、推开，与积木碰撞。',{kind:'vehicle',file:file('toy-car-kit','vehicle-truck'),size:.66,position:[.9,0,1.35]}),
  definition('ramp','汽车坡道','model-ramp','物理玩具',35,75,'带实际斜面碰撞的固定坡道，拖动汽车到坡顶再松手。',{kind:'ramp',file:file('toy-car-kit','track-wide-straight-hill-complete'),size:1.8,position:[-1.65,0,1.3]}),
  definition('bricks-basic','基础积木盒','model-bricks','物理玩具',20,30,'六块基础积木，可以拖动、堆叠、推倒。',{kind:'bricks',files:['brick-1x1','brick-1x2','brick-1x4','brick-2x2','brick-1x1','brick-1x2'].map(brick),position:[1.65,0,0]}),
  definition('bricks-color','彩色积木盒','model-bricks','物理玩具',30,55,'十块积木，增加圆柱、斜面、转角与薄板；不是单纯换色。',{kind:'bricks',files:['brick-1x1','brick-1x2','brick-1x4','brick-2x2','brick-2x4','brick-1x1-round','brick-slope-1x2','brick-slope-2x2','brick-corner','plate-2x4'].map(brick),position:[1.65,0,0]}),
  definition('stool','小矮凳','furniture-stool','小屋家具',20,35,'摆在小猫旁边的小凳子，轻点可转向。',{kind:'furniture',file:file('furniture-kit','stoolBar'),size:.65,position:[-1.45,0,-.75]}),
  definition('table','小边桌','furniture-table','小屋家具',25,50,'小小的边桌，提供实际碰撞和桌面；轻点可转向。',{kind:'furniture',file:file('furniture-kit','sideTable'),size:.85,position:[1.35,0,-.85]}),
  definition('shelf','小书架','furniture-shelf','小屋家具',35,75,'低矮书架放在房间后方，不遮挡小猫；轻点可转向。',{kind:'furniture',file:file('furniture-kit','bookcaseOpenLow'),size:1.05,position:[0,0,-1.8]}),
  definition('lamp','落地灯','furniture-lamp','小屋家具',35,90,'带柔和局部灯光，轻点开灯或关灯。',{kind:'lamp',file:file('furniture-kit','lampRoundFloor'),size:1.4,position:[-1.75,0,-1.45]}),
]);
const byId = new Map(MODEL_DEFINITIONS.map(item=>[item.id,item]));
export const MODEL_SLOTS = Object.freeze([...new Set(MODEL_DEFINITIONS.map(item=>item.slot))]);
export function modelDefinition(id) { return byId.get(id); }
export function modelSlot(reward) { return reward?.category==='model' ? byId.get(reward.params?.modelId)?.slot : reward?.category; }
export function validateModelReward(reward) {
  const def = byId.get(reward.params?.modelId);
  if (!def || reward.id!==`kenney-${def.id}` || Object.keys(reward.params).length!==1 || reward.starter || reward.action!==undefined || reward.motion!==undefined || reward.preset!==undefined)
    throw new Error('模型奖励只接受已审核的本地模型，不能更改模型标识、脚本或地址');
}
export const MODEL_REWARDS = Object.freeze(MODEL_DEFINITIONS.map(def=>Object.freeze({id:`kenney-${def.id}`,title:def.title,description:def.description,category:'model',cost:def.cost,unlockAt:def.unlockAt,params:{modelId:def.id}})));
export function equippedModels(catalog,equipped,owned) {
  const permitted=new Set(owned);
  return catalog.rewards.filter(r=>r.category==='model'&&permitted.has(r.id)&&equipped[modelSlot(r)]===r.id).map(r=>r.params.modelId);
}
