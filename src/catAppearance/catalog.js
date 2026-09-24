/** Appearance is a decoration of buildCat, never a model/pose/rig replacement. */
export const CAT_APPEARANCES = Object.freeze([
  { id: 'native', name: '原版小猫' },
  { id: 'leaf', name: '叶猫外观（原版身体与动作）' },
]);
// Read compatibility only. These values never control animation or appear in forms.
export const LEGACY_MOUTH_VALUES = Object.freeze(['auto', 'closed', 'open', 'meow']);
export const LEAF_PALETTE = Object.freeze({
  body: '#d3e9bc', under: '#e5f2d3', green: '#569e3b', inner: '#cce5ad',
  eye: '#d572a0', nose: '#bd638c', mouth: '#573556', tongue: '#b886c7',
});
export const LEAF_COAT = Object.freeze({
  id: 'leaf', kind: 'solid', base: LEAF_PALETTE.body, under: LEAF_PALETTE.under,
  soft: { pattern: 'solid', base: LEAF_PALETTE.body, colorA: LEAF_PALETTE.body,
    colorB: LEAF_PALETTE.under, count: 1, scale: 1, softness: 0, irregularity: 0 },
});
export const isLeafCat = params => params.catAppearance === 'leaf';
