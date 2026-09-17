import {createContainer,getContainerDescriptor} from '../../src/container.js';
export function containerSeed(kind,seed) {
 for(let offset=0;offset<2048;offset++)if(getContainerDescriptor(seed+offset).id===kind)return seed+offset;
 throw new Error('无法找到对应猫窝预设');
}
export function containerBuild(params,catParams) {
 const seed=containerSeed(params.kind,params.seed);
 const fitScale=Math.max(.96,Math.min(1.8,Math.sqrt(catParams.chubbiness??1.15)*1.05))*(params.size??1);
 const mesh=createContainer(seed,{fitScale});
 const d=mesh.userData.container;
 return {mesh,catParams:{...catParams,pose:'containerCrouch',motionDebug:false,containerId:d.id,containerScale:d.heightScale,containerRimY:d.rimY,containerOpeningShape:d.openingShape,containerOpeningWidth:d.openingWidth,containerOpeningDepth:d.openingDepth,containerOffsetZ:d.offsetZ,containerSoftBody:true}};
}
