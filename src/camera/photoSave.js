export function isIOSPhotoDevice(nav = globalThis.navigator) {
  return /iPad|iPhone|iPod/.test(nav?.userAgent || '')
    || (nav?.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

export function photoShareFile(blob, filename, nav = globalThis.navigator) {
  if (typeof File !== 'function' || typeof nav?.share !== 'function') return null;
  const file = new File([blob], filename, {type: 'image/png'});
  try { return nav.canShare?.({files: [file]}) ? file : null; }
  catch { return null; }
}
