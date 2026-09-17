/**
 * Persisted scene slots, shared by API validation and parent forms.
 * Enumerations correspond to actual upstream modules, not promised/imaginary assets.
 */
const choice=(key,label,choices)=>({key,label,type:'select',choices});
const number=(key,label,min,max,value,step=.01)=>({key,label,type:'number',min,max,value,step});
const color=(key,label,value)=>({key,label,type:'color',value});
const check=(key,label,value=false)=>({key,label,type:'checkbox',value});
export const SCENE_LABELS={floor:'地板',rug:'地毯',bed:'猫窝 / 容器',toy:'玩具',weather:'天气',lighting:'灯光',camera:'镜头',effect:'雾效'};
export const SCENE_SLOTS=Object.keys(SCENE_LABELS);
export const RUG_CHOICES=[['pizza','披萨圆毯'],['checker','棋盘方毯'],['striped','条纹长毯'],['medallion','圆心花毯'],['gingham','野餐格方毯'],['confetti','彩点长毯'],['sunburst','太阳放射圆毯']];
export const BED_CHOICES=[['cardboard','纸箱'],['flowerpot','花盆'],['basket','藤编篮'],['basin','搪瓷盆'],['bucket','小水桶'],['storage','布艺收纳箱'],['cushion','软垫猫窝']];
const off=['none','不放置'];
export const SCENE_FIELDS={
 floor:[choice('kind','地面类型',[['platform','原始展示垫'],['wood','原版手绘木地板']]),
 color('baseColor','木板底色','#d9b77f'),color('seamColor','接缝颜色','#7d5b3e'),color('grainColor','木纹颜色','#9f744d'),
 number('plankWidth','木板宽度',.35,1.6,.82),number('grainDensity','木纹密度',0,1.5,.72),number('direction','地板方向',0,180,8,1)],
 rug:[choice('style','地毯样式',[off,...RUG_CHOICES]),number('seed','固定配色种子',0,1000000,7,1),
 number('size','地毯直径',2.8,6.8,4.4,.1),number('rotation','地毯转角',-180,180,0,1)],
 bed:[choice('kind','猫窝 / 容器类型',[off,...BED_CHOICES]),number('seed','固定配色种子',0,1000000,13,1),
 choice('placement','放置方式',[['beside','放在小猫身边'],['inside','小猫进入容器']]),
 number('size','容器大小',.9,1.6,1,.05),number('x','旁置横向位置',-3.6,3.6,-2.1,.1),number('z','旁置纵向位置',-2.8,2.8,-.6,.1)],
 toy:[choice('kind','玩具类型',[off,['yarn','毛线球'],['ball','小皮球'],['fish','小鱼布偶'],['duck','小鸭子'],['mixed','玩具组合']]),
 number('count','玩具数量',1,5,3,1),number('scale','玩具大小',.65,1.4,1,.05),number('seed','固定摆放种子',0,1000000,19,1)],
 weather:[choice('mode','天气场景',[['sunny','晴天'],['cloudy','多云'],['rain','细雨'],['thunder','雷雨'],['fishRain','小鱼雨']]),
 number('cloudAmount','云量',0,2,.7,.1),number('rainAmount','雨量',0,2,.6,.1),number('fishAmount','小鱼雨数量',.1,1,.25,.05),
 check('lightning','缓慢闪电效果（默认关闭）')],
 lighting:[color('keyColor','主灯颜色','#fff5df'),number('keyIntensity','主灯亮度',.2,4,3,.1),
 color('ambientColor','环境光颜色','#ffffff'),number('ambientIntensity','环境光亮度',.3,3,2,.1),
 number('azimuth','主灯方位角',-180,180,-32,1),number('elevation','主灯仰角',20,85,55,1)],
 camera:[number('azimuth','初始观看方向',-180,180,24,1),number('elevation','初始观看仰角',12,78,17,1),
 number('distance','取景距离系数',.85,1.8,1,.05),number('fov','镜头视角',28,55,35,1)],
 effect:[choice('kind','雾效',[['none','清晰视野'],['fog','场景柔雾']]),color('color','雾颜色','#efe9dd'),
 number('near','雾开始距离',2,20,8,.5),number('far','雾完全覆盖距离',8,40,28,.5)]
};
export function sceneDefaults(slot,overrides={}) {
 const fields=SCENE_FIELDS[slot];if(!fields)throw new Error('未知场景槽位');
 return {...Object.fromEntries(fields.map(f=>[f.key,f.type==='select'?f.choices[0][0]:f.value])),...overrides};
}
export const DEFAULT_SCENE=Object.fromEntries(SCENE_SLOTS.map(slot=>[slot,sceneDefaults(slot)]));
export function composeScene(catalog,equipped){
 const scene=structuredClone(DEFAULT_SCENE);
 for(const slot of SCENE_SLOTS){const r=catalog.rewards.find(r=>r.id===equipped[slot]&&r.category===slot);if(r)scene[slot]=sceneDefaults(slot,r.params);}
 return scene;
}
export function sceneFieldVisible(category,key,params) {
 if(category==='floor'&&key!=='kind')return params.kind==='wood';
 if(['rug','bed','toy'].includes(category)&&key!==(category==='rug'?'style':'kind')&&params[category==='rug'?'style':'kind']==='none')return false;
 if(category==='bed'&&['x','z'].includes(key))return params.placement!=='inside';
 if(category==='bed'&&['placement','seed'].includes(key))return params.kind!=='cushion';
 if(category==='weather') {
   if(key==='lightning')return params.mode==='thunder';
   if(key==='rainAmount')return ['rain','thunder','fishRain'].includes(params.mode);
   if(key==='fishAmount')return params.mode==='fishRain';
   if(key==='cloudAmount')return params.mode!=='sunny';
 }
 if(category==='effect'&&key!=='kind')return params.kind==='fog';
 return true;
}
