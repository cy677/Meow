/** Shared live-card/export artwork. Upstream credit remains in README/LICENSE,
 * not in a clickable footer or embedded in family photographs. */
export const CARD_LAYOUT = Object.freeze({windowX: .08, windowY: .115, windowWidth: .84, windowHeight: .65});
// Compatibility metadata for existing consumers; never rendered into a photo.
export const SHARE_CARD_REPOSITORY = Object.freeze({label: 'github.com/ringhyacinth/Meow-Generator'});
const CARD_TOTAL = 9999;
const CARD_THEMES = Object.freeze([
  {name: 'peach', pattern: 'dots', paper: '#fff7dc', primary: '#f47f96', secondary: '#ffd05b', accent: '#45c6c0', ink: '#3f302b'},
  {name: 'sky', pattern: 'checker', paper: '#f4f5dc', primary: '#82add8', secondary: '#f08ab0', accent: '#ffd358', ink: '#303846'},
  {name: 'lime', pattern: 'confetti', paper: '#f8f4d9', primary: '#a6d84d', secondary: '#65c7dc', accent: '#ff9d4f', ink: '#33412d'},
  {name: 'orange', pattern: 'waves', paper: '#fff3d5', primary: '#f3a34b', secondary: '#ef718e', accent: '#70b7c8', ink: '#51352b'},
]);
const COPY = Object.freeze({
  'zh-CN': {camera: '拍照', close: '取消', saved: '已生成照片', saveFailed: '照片生成失败，请重试', hint: '拖动画面调整角度', title: '猫猫纪念卡', skin: '换一个皮肤', cardNumber: serial => `第 ${serial} 张 / ${CARD_TOTAL}`},
  'ja-JP': {camera: '撮影', close: '閉じる', saved: '写真を作成しました', saveFailed: '写真を作成できませんでした。再試行してください', hint: 'ドラッグして角度を調整', title: 'ねこ記念カード', skin: 'スキンを変更', cardNumber: serial => `${serial} / ${CARD_TOTAL} 枚目`},
  en: {camera: 'Capture', close: 'Close', saved: 'Photo created', saveFailed: 'Could not create photo. Please retry.', hint: 'Drag the scene to adjust the angle', title: 'Meow keepsake card', skin: 'New skin', cardNumber: serial => `CARD ${serial} / ${CARD_TOTAL}`},
});
export const localeCopy = locale => COPY[locale] ?? COPY['zh-CN'];
const positiveSeed = seed => Number.isFinite(Number(seed)) ? Math.abs(Math.trunc(Number(seed))) : 0;
export const getShareCardFilename = seed => `meow_card_${positiveSeed(seed)}.png`;
const clampChannel = value => Math.max(0, Math.min(255, Math.round(value)));
function normalizeHex(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(normalized)) return `#${normalized.slice(1).split('').map(digit => digit.repeat(2)).join('')}`.toLowerCase();
  return fallback;
}
function hexChannels(value) {
  const hex = normalizeHex(value, '#000000').slice(1);
  return [0, 2, 4].map(i => Number.parseInt(hex.slice(i, i + 2), 16));
}
function mixHex(a, b, amount) {
  const from = hexChannels(a), to = hexChannels(b), ratio = Math.max(0, Math.min(1, amount));
  return `#${from.map((channel, index) => clampChannel(channel + (to[index] - channel) * ratio).toString(16).padStart(2, '0')).join('')}`;
}
function colorLuma(value) {
  const [r, g, b] = hexChannels(value).map(channel => channel / 255);
  return r * .299 + g * .587 + b * .114;
}
function normalizeCatPalette(palette = {}) {
  const base = normalizeHex(palette.base, '#f6dfbd'), primary = normalizeHex(palette.primary, '#e6913f');
  const secondary = normalizeHex(palette.secondary, '#ad5d22'), accent = normalizeHex(palette.accent, '#d99a2b');
  const darkest = [base, primary, secondary, accent].sort((a, b) => colorLuma(a) - colorLuma(b))[0];
  return {base, primary, secondary, accent, ink: mixHex(darkest, '#2f2927', .7)};
}
function hashCardValue(seed, variant = 0) {
  let value = (positiveSeed(seed) ^ Math.imul(positiveSeed(variant) + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16; value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15; value = Math.imul(value, 0x846ca68b); value ^= value >>> 16;
  return value >>> 0;
}
function rarityFromSeed(seed) {
  const roll = hashCardValue(seed, 17) % 100;
  return roll < 12 ? 'AR' : roll < 38 ? 'SR' : 'R';
}
function createCatTheme(palette) {
  const cat = normalizeCatPalette(palette);
  return {name: 'cat-signature', pattern: 'cat-paws', paper: mixHex(cat.base, '#fffaf0', .78), primary: cat.primary,
    secondary: mixHex(cat.base, cat.secondary, .36), accent: mixHex(cat.accent, '#fff1a8', .12), ink: cat.ink};
}
function createAlternateTheme(seed, palette, skinVariant) {
  const catTheme = createCatTheme(palette), hash = hashCardValue(seed, skinVariant);
  const rugTheme = CARD_THEMES[hash % CARD_THEMES.length], blend = .22 + ((hash >>> 8) % 18) / 100;
  const primaryFirst = ((hash >>> 16) & 1) === 0;
  return {name: `cat-remix-${skinVariant}`, pattern: rugTheme.pattern, paper: mixHex(catTheme.paper, rugTheme.paper, .28),
    primary: mixHex(primaryFirst ? catTheme.primary : catTheme.secondary, rugTheme.primary, blend),
    secondary: mixHex(primaryFirst ? catTheme.secondary : catTheme.primary, rugTheme.secondary, blend),
    accent: mixHex(catTheme.accent, rugTheme.accent, .32), ink: catTheme.ink};
}
export function getShareCardDescriptor(seed, palette, skinVariant = 0) {
  const safeSeed = positiveSeed(seed), safeVariant = positiveSeed(skinVariant);
  const theme = palette ? (safeVariant === 0 ? createCatTheme(palette) : createAlternateTheme(safeSeed, palette, safeVariant)) : CARD_THEMES[safeSeed % CARD_THEMES.length];
  return {theme, serial: String(((safeSeed * 73 + 51) % CARD_TOTAL) + 1).padStart(4, '0'), rarity: rarityFromSeed(safeSeed), skinVariant: safeVariant, skinSeed: hashCardValue(safeSeed, safeVariant)};
}
export function roundedRect(ctx, x, y, width, height, radius) { ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); }
function drawStar(ctx, x, y, radius, color, rotation = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rotation); ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? radius : radius * .36, angle = -Math.PI / 2 + i * Math.PI / 4;
    const px = Math.cos(angle) * r, py = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.restore();
}
function drawPaw(ctx, x, y, scale, color) {
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = color; ctx.beginPath();
  ctx.ellipse(0, 6 * scale, 13 * scale, 11 * scale, 0, 0, Math.PI * 2); ctx.fill();
  for (const [dx, dy, rx, ry] of [[-14, -8, 6, 8], [-5, -15, 6, 8], [6, -15, 6, 8], [15, -7, 6, 8]]) {
    ctx.beginPath(); ctx.ellipse(dx * scale, dy * scale, rx * scale, ry * scale, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function drawCardPattern(ctx, {cardX, cardY, cardWidth, cardHeight, theme, skinSeed, scale}) {
  const topY = cardY, topHeight = cardHeight * .12, bottomY = cardY + cardHeight * .77, bottomHeight = cardHeight * .23;
  let state = skinSeed || 1;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const zones = [{y: topY, height: topHeight}, {y: bottomY, height: bottomHeight}];
  ctx.save(); ctx.globalAlpha = .18; ctx.fillStyle = theme.ink; ctx.strokeStyle = theme.ink;
  if (theme.pattern === 'checker') {
    const size = 38 * scale;
    for (const zone of zones) for (let row = 0; row < Math.ceil(zone.height / size); row++) for (let column = 0; column < Math.ceil(cardWidth / size); column++) {
      if ((row + column) % 2 === 0) ctx.fillRect(cardX + column * size, zone.y + row * size, size, size);
    }
  } else if (theme.pattern === 'confetti') {
    ctx.lineWidth = 8 * scale; ctx.lineCap = 'round';
    for (let index = 0; index < 48; index++) {
      const bottom = index >= 18, zoneY = bottom ? bottomY : topY, zoneHeight = bottom ? bottomHeight : topHeight;
      const x = cardX + random() * cardWidth, y = zoneY + random() * zoneHeight;
      const length = (12 + random() * 22) * scale, angle = random() * Math.PI;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length); ctx.stroke();
    }
  } else if (theme.pattern === 'waves') {
    ctx.lineWidth = 7 * scale;
    for (const zone of zones) for (let row = 0; row < 4; row++) {
      const y = zone.y + zone.height * (.16 + row * .25); ctx.beginPath();
      for (let x = -40 * scale; x <= cardWidth + 40 * scale; x += 12 * scale) {
        const px = cardX + x, py = y + Math.sin(x / (46 * scale)) * 10 * scale;
        if (x <= -40 * scale) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  } else if (theme.pattern === 'cat-paws') {
    for (let index = 0; index < 18; index++) {
      const bottom = index >= 7, rowIndex = bottom ? index - 7 : index, count = bottom ? 11 : 7;
      drawPaw(ctx, cardX + cardWidth * ((rowIndex + .55) / count), (bottom ? bottomY : topY) + (bottom ? bottomHeight * .52 : topHeight * .46), (bottom ? .4 : .34) * scale, theme.ink);
    }
  } else {
    for (let row = 0; row < 4; row++) for (let column = 0; column < 16; column++) {
      ctx.beginPath(); ctx.arc(cardX + cardWidth * (.06 + column * .059), cardY + cardHeight * (.025 + row * .022), 3.2 * scale, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineWidth = 7 * scale;
    for (let i = -3; i < 12; i++) {
      ctx.beginPath(); ctx.moveTo(cardX + i * 110 * scale, bottomY); ctx.lineTo(cardX + (i * 110 + 220) * scale, cardY + cardHeight); ctx.stroke();
    }
  }
  ctx.restore();
}
export function drawCardDecor(ctx, {cardX, cardY, cardWidth, cardHeight, windowX, windowY, windowWidth, windowHeight, descriptor, copy}) {
  const {theme, serial, rarity, skinSeed} = descriptor, scale = cardWidth / 1140;
  const outerRadius = 72 * scale, innerRadius = 40 * scale, inkWidth = 12 * scale;
  ctx.save(); ctx.shadowColor = 'rgba(63, 48, 43, 0.22)'; ctx.shadowBlur = 30 * scale; ctx.shadowOffsetY = 18 * scale;
  ctx.beginPath(); ctx.roundRect(cardX, cardY, cardWidth, cardHeight, outerRadius); ctx.roundRect(windowX, windowY, windowWidth, windowHeight, innerRadius);
  ctx.fillStyle = theme.paper; ctx.fill('evenodd'); ctx.restore();
  ctx.save(); roundedRect(ctx, cardX, cardY, cardWidth, cardHeight, outerRadius); ctx.clip();
  ctx.fillStyle = theme.primary; ctx.fillRect(cardX, cardY, cardWidth, cardHeight * .12);
  ctx.fillStyle = theme.secondary; ctx.fillRect(cardX, cardY + cardHeight * .77, cardWidth, cardHeight * .23);
  drawCardPattern(ctx, {cardX, cardY, cardWidth, cardHeight, theme, skinSeed, scale}); ctx.restore();
  roundedRect(ctx, windowX, windowY, windowWidth, windowHeight, innerRadius); ctx.strokeStyle = theme.ink; ctx.lineWidth = inkWidth; ctx.stroke();
  roundedRect(ctx, windowX + inkWidth * 1.1, windowY + inkWidth * 1.1, windowWidth - inkWidth * 2.2, windowHeight - inkWidth * 2.2, innerRadius * .72);
  ctx.strokeStyle = theme.accent; ctx.lineWidth = 5 * scale; ctx.stroke();
  roundedRect(ctx, cardX, cardY, cardWidth, cardHeight, outerRadius); ctx.strokeStyle = theme.ink; ctx.lineWidth = inkWidth; ctx.stroke();
  roundedRect(ctx, cardX + inkWidth * 1.35, cardY + inkWidth * 1.35, cardWidth - inkWidth * 2.7, cardHeight - inkWidth * 2.7, outerRadius * .78);
  ctx.strokeStyle = theme.accent; ctx.lineWidth = 5 * scale; ctx.stroke();
  ctx.fillStyle = '#fffaf0'; ctx.strokeStyle = theme.ink; ctx.lineWidth = 8 * scale;
  roundedRect(ctx, cardX + 46 * scale, cardY + 32 * scale, 310 * scale, 92 * scale, 28 * scale); ctx.fill(); ctx.stroke();
  ctx.fillStyle = theme.ink; ctx.font = `900 ${40 * scale}px "Arial Rounded MT Bold", "Microsoft YaHei", sans-serif`; ctx.textBaseline = 'middle';
  ctx.fillText('MEOW CARD', cardX + 70 * scale, cardY + 80 * scale);
  ctx.beginPath(); ctx.arc(cardX + cardWidth - 86 * scale, cardY + 78 * scale, 39 * scale, 0, Math.PI * 2); ctx.fillStyle = theme.ink; ctx.fill();
  ctx.beginPath(); ctx.arc(cardX + cardWidth - 86 * scale, cardY + 78 * scale, 25 * scale, 0, Math.PI * 2); ctx.fillStyle = theme.accent; ctx.fill();
  drawStar(ctx, cardX + cardWidth - 86 * scale, cardY + 78 * scale, 15 * scale, '#fffaf0', Math.PI / 8);
  drawStar(ctx, cardX + 52 * scale, cardY + cardHeight * .735, 24 * scale, theme.accent, .1);
  drawStar(ctx, cardX + cardWidth - 55 * scale, cardY + cardHeight * .74, 30 * scale, theme.primary, -.2);
  drawStar(ctx, cardX + cardWidth - 105 * scale, cardY + cardHeight * .19, 19 * scale, theme.secondary, .35);
  const captionY = cardY + cardHeight * .812;
  ctx.fillStyle = theme.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `900 ${55 * scale}px "Arial Rounded MT Bold", "Microsoft YaHei", sans-serif`; ctx.fillText('MEOW GENERATOR', cardX + cardWidth / 2, captionY);
  ctx.font = `800 ${29 * scale}px "Arial Rounded MT Bold", "Microsoft YaHei", sans-serif`; ctx.fillText(copy.title, cardX + cardWidth / 2, captionY + 52 * scale);
  const metaY = cardY + cardHeight * .894, metaHeight = 66 * scale;
  ctx.fillStyle = 'rgba(255, 250, 240, 0.86)'; ctx.strokeStyle = theme.ink; ctx.lineWidth = 5 * scale;
  roundedRect(ctx, cardX + 66 * scale, metaY, 450 * scale, metaHeight, 22 * scale); ctx.fill(); ctx.stroke();
  ctx.fillStyle = theme.ink; ctx.textAlign = 'left'; ctx.font = `900 ${29 * scale}px "Arial Rounded MT Bold", "Microsoft YaHei", sans-serif`;
  ctx.fillText(copy.cardNumber(serial), cardX + 92 * scale, metaY + metaHeight / 2);
  const rarityX = cardX + cardWidth - 214 * scale, rarityWidth = 148 * scale;
  const gradient = ctx.createLinearGradient(rarityX, metaY, rarityX + rarityWidth, metaY + metaHeight);
  gradient.addColorStop(0, rarity === 'R' ? '#fffaf0' : theme.primary);
  gradient.addColorStop(1, rarity === 'AR' ? theme.accent : rarity === 'SR' ? theme.secondary : theme.paper);
  roundedRect(ctx, rarityX, metaY, rarityWidth, metaHeight, 24 * scale); ctx.fillStyle = gradient; ctx.fill(); ctx.strokeStyle = theme.ink; ctx.stroke();
  ctx.fillStyle = theme.ink; ctx.textAlign = 'center'; ctx.font = `900 ${36 * scale}px "Arial Rounded MT Bold", "Microsoft YaHei", sans-serif`;
  ctx.fillText(`${rarity} ✦`, rarityX + rarityWidth / 2, metaY + metaHeight / 2);
  // No repository URL or link-shaped box in the exported pixels.
  drawPaw(ctx, cardX + 104 * scale, captionY + 50 * scale, .72 * scale, theme.primary);
  drawPaw(ctx, cardX + cardWidth - 104 * scale, captionY + 50 * scale, .72 * scale, theme.accent);
  ctx.textAlign = 'left';
}
