// Accepted legacy IDs keep old family catalogues readable; editing now belongs to parents.
export const EDITORS=[
  ['pose','姿势与随机猫窝',35,60],['body','身体尺寸',30,50],['fur','毛发设置',25,40],
  ['coat','自定义花色',35,60],['eyes','眼睛设置',30,50],['rug','垫子设置',20,30],
  ['floor','木地板设置',25,40],['line','线条设置',25,40],['poke','捏猫手感设置',20,30],
  ['shadow','地面影子设置',30,50],['shade','身上阴影设置',30,50],
];
export const isMenuOnly=reward=>['weather','lighting'].includes(reward.category)||reward.category==='capability';
