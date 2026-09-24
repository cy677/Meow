import { LEGACY_MOUTH_VALUES } from '../src/catAppearance/catalog.js';

export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new AppError(status, message); };
export function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400,'需要 JSON 对象');
  if (Object.keys(value).some(k => !keys.includes(k))) fail(400,'包含不支持的字段');
  return value;
}
export function text(value, name, max=80, min=1) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(400,`${name}长度应为 ${min}–${max} 个字符`);
  return value.trim();
}
export function integer(value, name, min=0, max=1000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(400,`${name}必须是 ${min}–${max} 的整数`);
  return value;
}
export function validateFields(params, fields) {
  if (params && Object.hasOwn(params, 'mouthMode') && fields.some(f => f.key === 'catAppearance')) {
    if (!LEGACY_MOUTH_VALUES.includes(params.mouthMode)) fail(400, '历史口型参数无效');
    const { mouthMode: ignored, ...current } = params;
    params = current;
  }
  object(params, fields.map(f => f.key));
  if (!Object.keys(params).length) fail(400,'奖励参数不能为空');
  for (const [key, value] of Object.entries(params)) {
    const field = fields.find(f => f.key === key);
    if (field.type === 'select') {
      if (!field.choices.some(c => c[0] === value)) fail(400,`未知${field.label}`);
    } else if (field.type === 'checkbox') {
      if (typeof value !== 'boolean') fail(400,`${field.label}必须为布尔值`);
    } else if (field.type === 'color') {
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail(400,`${field.label}应为六位十六进制颜色`);
    } else if (!Number.isFinite(value) || value < field.min || value > field.max || (field.step === 1 && !Number.isInteger(value))) {
      fail(400,`${field.label}超出范围或不是有效数字`);
    }
  }
}
