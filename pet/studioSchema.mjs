import { PARAM_FIELDS } from './presetSchema.mjs';
import { SCENE_FIELDS } from './environmentSchema.mjs';
import { POSES } from '../src/coats.js';
import { CLIPS } from './motionPrograms.mjs';
import { object, validateFields } from './validation.mjs';
const number=(key,min,max,step=.01)=>({key,label:key,type:'number',min,max,step});
const bool=key=>({key,label:key,type:'checkbox'});
const select=(key,values)=>({key,label:key,type:'select',choices:values.map(v=>[v,v])});
const color=key=>({key,label:key,type:'color'});
export const STUDIO_FIELDS={
  params:[...PARAM_FIELDS.coat,...PARAM_FIELDS.shape,...PARAM_FIELDS.eyes,
    select('pose',POSES.map(p=>p.id)),number('containerSeed',0,4294967295,1),number('containerSize',.72,1.5),bool('containerSoftBody'),bool('containerSoftCollision'),
    bool('motionDebug'),bool('motionStateMachine'),select('motionAction',CLIPS.map(c=>c.id)),number('motionSpeed',.25,2),number('motionIntensity',0,1.6)],
  floor:SCENE_FIELDS.floor.filter(f=>f.key!=='kind'),
  rug:[bool('enabled'),number('seed',0,4294967295,1)],
  light:[number('azimuth',-180,360),number('elevation',0,90)],
  weather:[select('mode',['sunny','cloudy','fishRain']),bool('thunder'),number('rain',0,4),number('cloud',0,2),number('fish',0,4)],
  poke:[number('radius',.15,.78),number('freq',1.8,9),number('damping',.05,.5)],
  hatch:[...['Hatch','Body'].flatMap(prefix=>[number(`u${prefix}Style`,0,1,1),number(`u${prefix}Width`,.75,.93),number(`u${prefix}Freq`,60,260),number(`u${prefix}Jitter`,0,.5),number(`u${prefix}Angle`,0,Math.PI),number(`u${prefix}DashStretch`,.35,4)]),...['uGroundHatchColor','uGroundShadowColor','uShadeColor'].map(color),...['uShadeAlpha','uBodyHatch','uHatchScreen'].map(key=>number(key,0,1))],
  camera:[...['x','y','z','targetX','targetY','targetZ'].map(key=>number(key,-100,100))],
};
export function validateStudio(input) {
  object(input,Object.keys(STUDIO_FIELDS));
  for(const [key,values] of Object.entries(input))validateFields(values,STUDIO_FIELDS[key]);
  return structuredClone(input);
}
