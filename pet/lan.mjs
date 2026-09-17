import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';

/** Keep loopback as the safe default; --lan explicitly makes the service available to the LAN. */
export function launchOptions(args = [], env = process.env) {
  const lan = args.includes('--lan');
  const useTls = args.includes('--https') || !!env.MEOW_TLS_CERT || !!env.MEOW_TLS_KEY;
  const dev = args.includes('--dev');
  if (useTls && dev) throw new Error('HTTPS 请使用构建后的页面：先 pet:build，再 pet:lan:https。');
  if (useTls && (!env.MEOW_TLS_CERT || !env.MEOW_TLS_KEY)) {
    throw new Error('HTTPS 需要同时设置 MEOW_TLS_CERT 和 MEOW_TLS_KEY；不会降级为 HTTP。详见 pet/PAD.md。');
  }
  const port = Number(env.MEOW_PORT || (useTls ? 8793 : 8792));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MEOW_PORT 必须是 1–65535 的整数');
  return { host: env.MEOW_HOST || (lan ? '0.0.0.0' : '127.0.0.1'), port, dev, useTls,
    certPath: useTls ? resolve(env.MEOW_TLS_CERT) : null,
    keyPath: useTls ? resolve(env.MEOW_TLS_KEY) : null };
}
export function lanAddresses(interfaces = networkInterfaces()) {
  return [...new Set(Object.values(interfaces).flatMap(items => (items || [])
    .filter(item => !item.internal && (item.family === 'IPv4' || item.family === 4))
    .map(item => item.address)))];
}
export function accessUrls({ host, port, useTls, addresses = lanAddresses() }) {
  const protocol = useTls ? 'https' : 'http';
  const hosts = host === '0.0.0.0' || host === '::' ? ['localhost', ...addresses] : [host];
  return [...new Set(hosts)].map(address => `${protocol}://${address.includes(':') ? `[${address}]` : address}:${port}`);
}
/** Host and Origin remain checked on LAN; changing to 0.0.0.0 must not enable DNS rebinding. */
export function requestOrigin(rawHost, { protocol, port, knownHosts, publicOrigin = '' }) {
  if (typeof rawHost !== 'string' || !rawHost || /[\/\\?#@\s]/.test(rawHost)) throw new Error('Host 不在允许列表');
  const scheme = publicOrigin ? new URL(publicOrigin).protocol : protocol;
  const url = new URL(`${scheme}//${rawHost}`);
  if (publicOrigin) {
    if (url.origin !== new URL(publicOrigin).origin) throw new Error('Host 不在允许列表');
    return publicOrigin;
  }
  const actualPort = Number(url.port || (scheme === 'https:' ? 443 : 80));
  if (!knownHosts.has(url.hostname.toLowerCase()) || actualPort !== port) throw new Error('Host 不在允许列表');
  return url.origin;
}
