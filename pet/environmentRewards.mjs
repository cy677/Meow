import {SCENE_SLOTS,SCENE_LABELS,sceneDefaults,RUG_CHOICES,BED_CHOICES} from './environmentSchema.mjs';
const reward=(id,title,category,params,cost=20,unlockAt=30)=>({id,title,description:`为小猫布置${title}，解锁后永久使用。`,category,cost,unlockAt,params:sceneDefaults(category,params)});
export const SCENE_STARTERS=SCENE_SLOTS.map(slot=>({...reward(`scene-default-${slot}`,slot==='floor'?'原始展示垫':slot==='weather'?'晴朗天气':slot==='lighting'?'日常光线':slot==='camera'?'默认镜头':slot==='effect'?'清晰视野':`暂不放置${SCENE_LABELS[slot]}`,slot,{},0,0),starter:true}));
export const SCENE_REWARDS=[
 ...[
 ['oak','温暖原木',{baseColor:'#d9b77f',seamColor:'#7d5b3e',grainColor:'#9f744d'}],
 ['rose','蜜桃木地板',{baseColor:'#e4b49e',seamColor:'#805548',grainColor:'#b47763'}],
 ['blue','蓝灰木地板',{baseColor:'#b8c9ca',seamColor:'#53696d',grainColor:'#7d9293'}],
 ['forest','浅绿木地板',{baseColor:'#becbad',seamColor:'#596b51',grainColor:'#7e9270'}],
 ['violet','淡紫木地板',{baseColor:'#c9bfd5',seamColor:'#665973',grainColor:'#8e7f9b'}],
 ['cream','奶油木地板',{baseColor:'#e1d0a4',seamColor:'#716047',grainColor:'#9a835b'}],
 ['walnut','胡桃木地板',{baseColor:'#c58c6b',seamColor:'#664636',grainColor:'#925f49'}],
 ['pink','粉白木地板',{baseColor:'#e8c7bd',seamColor:'#825b5f',grainColor:'#b48279'}]
 ].map(([id,title,params],i)=>reward(`scene-floor-${id}`,title,'floor',{kind:'wood',...params},20+i*3,25+i*10)),
 ...RUG_CHOICES.map(([style,title],i)=>reward(`scene-rug-${style}`,title,'rug',{style,seed:7+i*17},20+i*3,30+i*8)),
 ...BED_CHOICES.map(([kind,title],i)=>reward(`scene-bed-${kind}`,title,'bed',{kind},30+i*3,40+i*8)),
 ...[['yarn','毛线球'],['ball','彩色皮球'],['fish','小鱼布偶'],['duck','小鸭子'],['mixed','玩具乐园']].map(([kind,title],i)=>reward(`scene-toy-${kind}`,title,'toy',{kind,count:kind==='ball'?1:3},15+i*5,20+i*10)),
 ...[['cloudy','云朵慢慢飘'],['rain','窗边细雨'],['thunder','远处雷雨'],['fishRain','小鱼从天而降']].map(([mode,title],i)=>reward(`scene-weather-${mode.toLowerCase()}`,title,'weather',{mode},35+i*5,60+i*20)),
 reward('scene-light-warm','暖暖晚灯','lighting',{keyColor:'#ffd5a3',keyIntensity:2,ambientColor:'#ffe8d2',ambientIntensity:1.5},30,50),
 reward('scene-light-cool','蓝色月光','lighting',{keyColor:'#b5d4ff',keyIntensity:1.8,ambientColor:'#afbde2',ambientIntensity:1.3,azimuth:60},40,80),
 reward('scene-camera-room','看看整个小屋','camera',{distance:1.5,elevation:28},15,20),
 reward('scene-camera-overhead','俯看小猫','camera',{distance:1.15,elevation:65},25,40),
 reward('scene-fog-soft','柔和晨雾','effect',{kind:'fog',near:8,far:28},30,60),
 reward('scene-fog-blue','蓝色薄雾','effect',{kind:'fog',color:'#c5d8e7',near:6,far:24},35,70),
];
const theme=(id,title,members,cost,unlockAt)=>({id,title,description:'兑换后获得套装内所有场景物品，一次应用整套布置。',category:'theme',cost,unlockAt,params:{members}});
export const SCENE_THEMES=[
 theme('scene-theme-cozy','温馨小屋套装',{floor:'scene-floor-oak',rug:'scene-rug-medallion',bed:'scene-bed-basket',toy:'scene-toy-yarn',lighting:'scene-light-warm'},100,120),
 theme('scene-theme-rain','听雨小屋套装',{floor:'scene-floor-blue',rug:'scene-rug-striped',weather:'scene-weather-rain',lighting:'scene-light-cool',effect:'scene-fog-blue'},110,160),
 theme('scene-theme-play','玩具乐园套装',{floor:'scene-floor-cream',rug:'scene-rug-pizza',bed:'scene-bed-cardboard',toy:'scene-toy-mixed',camera:'scene-camera-room'},110,150),
];
export const SCENE_CATALOG_ADDITIONS=[...SCENE_STARTERS,...SCENE_REWARDS,...SCENE_THEMES];
