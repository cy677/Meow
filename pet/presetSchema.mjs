import { SCENE_FIELDS, SCENE_LABELS, sceneDefaults, sceneFieldVisible } from './environmentSchema.mjs';
import { ACTION_CHOICES, PROGRAMS } from './motionPrograms.mjs';
import { COATS, POSES } from '../src/coats.js';
import { EDITORS } from './editorRewards.mjs';

// One schema drives both the parent's form and the server's allow-list.
const select = (key, label, choices) => ({ key, label, type: 'select', choices });
const number = (key, label, min, max, value, step = 0.01) => ({ key, label, type: 'number', min, max, value, step });
const check = (key, label, value = false) => ({ key, label, type: 'checkbox', value });
const color = (key, label, value) => ({ key, label, type: 'color', value });
export const CATEGORY_LABELS = { coat: '花色', shape: '体型', eyes: '眼睛', pose: '姿态', trick: '互动动作', creation:'家长作品', capability:'历史功能', ...SCENE_LABELS, theme:'场景套装', model:'模型礼物' };
export const PARAM_FIELDS = {
  ...SCENE_FIELDS,
  capability: [select('capability','解锁功能', [...EDITORS.map(([id,title])=>[`editor-${id}`,title]),['complete','原版完整创作室'],['keyboard','键盘自由行动'],['capture','拍照与分享卡'],['export','GLB 与 Codex 导出'],['music','原版背景音乐']])],
  coat: [
    select('coatId', '基础花色', COATS.map(c => [c.id, c.name])),
    check('dynamicCoat', '启用自定义配色'),
    color('dynamicCoatBase', '底色', '#f6dfbd'), color('dynamicCoatA', '主色', '#e6913f'), color('dynamicCoatB', '辅助色', '#ad5d22'),
    number('dynamicCoatCount', '色块数量', 1, 12, 7, 1),
    number('dynamicCoatScale', '色块大小', 0.45, 2, 1),
    number('dynamicCoatSoftness', '边缘柔和度', 0, 1.4, 0),
    number('dynamicCoatIrregularity', '色块不规则度', 0, 1.5, 0.65),
    number('dynamicCoatBodyDensity', '身体条纹密度', 0.8, 32, 8.2, 0.1),
    number('dynamicCoatBodyWidth', '身体条纹宽度', 0.01, 1.1, 0.24),
    number('dynamicCoatBodyIrregularity', '身体条纹不规则度', 0, 4, 0.42),
    number('dynamicCoatHeadDensity', '头部条纹密度', 1, 64, 18, 1),
    number('dynamicCoatHeadWidth', '头部条纹宽度', 0.01, 1.1, 0.2),
    number('dynamicCoatHeadIrregularity', '头部条纹不规则度', 0, 4, 0.28),
  ],
  shape: [
    number('headSize', '头部大小', 0.35, 2.8, 1.08), number('chubbiness', '圆润程度', 0.3, 4.5, 1.15),
    number('legLength', '腿长', 0.05, 5, 0.85), number('earSize', '耳朵大小', 0.1, 4.5, 1),
    number('tailLength', '尾巴长度', 0.05, 4.5, 0.95), number('tailCurl', '尾巴卷曲', -0.75, 2.25, 0.35),
    check('fluffy', '蓬松毛发'), number('furFluff', '蓬松程度', 0.15, 3, 0.9),
    number('seed', '模型随机种子', 0, 4294967295, 20260916, 1), number('outlineJitter','手绘线条抖动',0,1,.25),
  ],
  eyes: [
    color('eyeColor', '眼睛颜色', '#d99a2b'), check('oddEyes', '双色眼睛'), color('eyeColorRight', '另一只眼睛颜色', '#5b8fd4'),
    number('eyeSize', '眼睛大小', 0.6, 1.7, 1.05), number('eyeSpacing', '眼距', 0.55, 1, 1),
    number('irisScale', '瞳孔大小', 0.1, 1.3, 0.65), number('irisHighlightScale', '瞳孔高光', 1, 2.4, 1),
    check('wateryEyes', '水汪汪的眼睛'), number('wateryEyeShape', '泪眼程度', 0, 2, 1.1),
  ],
  pose: [select('pose', '小猫姿态', POSES.filter(p => p.id !== 'containerCrouch').map(p => [p.id, p.name]))],
};
export const ACTION_FIELD = select('action', '骨骼动作 / 动作脚本', ACTION_CHOICES);
export const MOTION_FIELDS = [
  number('duration', '表演片段时长（秒）', 0.6, 12, 2.6, 0.1),
  number('height', '跳跃高度', 0.05, 0.8, 0.5),
  number('turns', '转圈圈数', 1, 3, 1, 1),
  number('speed', '整体播放速度', 0.5, 2, 1, 0.1),
  number('intensity', '骨骼动作幅度', 0.25, 1.1, 0.85, 0.05),
  number('transition', '动作衔接时间（秒）', 0.1, 0.6, 0.25, 0.05),
];
export function defaultsFor(category, params = {}) {
  if(SCENE_FIELDS[category])return sceneDefaults(category,params);
  const defaults = Object.fromEntries((PARAM_FIELDS[category] || []).map(f => [f.key, f.type === 'select' ? f.choices[0][0] : f.value]));
  if (category === 'coat') {
    const c = COATS.find(c => c.id === params.coatId) || COATS[0], s = c.soft;
    Object.assign(defaults, {
      coatId: c.id, dynamicCoatBase: s.base, dynamicCoatA: s.colorA, dynamicCoatB: s.colorB,
      dynamicCoatCount: s.count ?? 7, dynamicCoatScale: s.scale ?? 1, dynamicCoatSoftness: s.softness ?? 0,
      dynamicCoatIrregularity: s.irregularity ?? 0.65,
      dynamicCoatBodyDensity: s.body?.density ?? 8.2, dynamicCoatBodyWidth: s.body?.width ?? 0.24,
      dynamicCoatBodyIrregularity: s.body?.irregularity ?? 0.42,
      dynamicCoatHeadDensity: s.head?.density ?? 18, dynamicCoatHeadWidth: s.head?.width ?? 0.2,
      dynamicCoatHeadIrregularity: s.head?.irregularity ?? 0.28,
    });
  }
  return { ...defaults, ...params };
}
export function fieldVisible(category, key, params) {
  if(SCENE_FIELDS[category])return sceneFieldVisible(category,key,params);
  if (category === 'coat' && key.startsWith('dynamicCoat') && key !== 'dynamicCoat') {
    if (!params.dynamicCoat) return false;
    const kind = COATS.find(c => c.id === params.coatId)?.kind;
    if (/Body|Head/.test(key)) return kind === 'tabby';
    if (/Count|Scale|Irregularity/.test(key)) return kind !== 'tabby' && kind !== 'solid';
  }
  if (key === 'eyeColorRight') return !!params.oddEyes;
  if (key === 'furFluff') return !!params.fluffy;
  if (key === 'wateryEyeShape') return !!params.wateryEyes;
  if (key === 'duration') return !PROGRAMS[params.action] && params.action !== 'sequence';
  if (key === 'height') return params.action === 'jump';
  if (key === 'turns') return params.action === 'spin';
  return true;
}
export function parameterDescription(reward) {
  if(reward.category==='creation')return '家长保存的小猫与场景完整作品，包含固定随机种子、模型和渲染设置。';
  if(reward.category==='theme')return Object.entries(reward.params?.members||{}).map(([slot,id])=>`${SCENE_LABELS[slot]}：${id}`).join('；');
  const fields = reward.category === 'trick' ? [ACTION_FIELD, ...MOTION_FIELDS] : PARAM_FIELDS[reward.category] || [];
  const values = reward.category === 'trick' ? { action: reward.action, ...reward.motion } : reward.params || {};
  const description=fields.filter(f => values[f.key] !== undefined && fieldVisible(reward.category, f.key, values)).map(f => {
    const value = values[f.key];
    return `${f.label}：${f.type === 'select' ? f.choices.find(c => c[0] === value)?.[1] || value : f.type === 'checkbox' ? (value ? '开启' : '关闭') : value}`;
  }).join('；');
  return description+(reward.motion?.script?'；步骤：'+reward.motion.script.map(s=>`${s.clip} × ${s.cycles??1} (${s.speed??1} 倍速)`).join(' → '):'');
}
