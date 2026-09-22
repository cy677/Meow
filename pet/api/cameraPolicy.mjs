/** Both the top-level child page and its same-origin renderer must allow camera. */
export function cameraPermissionsPolicy(pathname) {
  const photoPage = ['/', '/index.html', '/studio.html'].includes(pathname);
  return `camera=${photoPage ? '(self)' : '()'}, microphone=(), geolocation=(), accelerometer=(self), gyroscope=(self), magnetometer=(), web-share=(self)`;
}
