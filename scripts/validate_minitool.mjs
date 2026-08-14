import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const packageRoot = path.join(projectRoot, 'Exports', 'xhs-minitool');
const reportPath = path.join(projectRoot, 'Exports', 'minitool-validation.json');
const allowedExtensions = new Set([
  '.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.woff', '.woff2', '.json',
]);
const failures = [];

function fail(message) {
  failures.push(message);
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return [fullPath];
  });
}

if (!existsSync(packageRoot) || !lstatSync(packageRoot).isDirectory()) {
  throw new Error(`Missing minitool build directory: ${packageRoot}`);
}

const files = walk(packageRoot);
const relativeFiles = files.map((file) => path.relative(packageRoot, file).replaceAll('\\', '/'));
const indexPath = path.join(packageRoot, 'index.html');
if (!existsSync(indexPath)) fail('index.html is missing from the package root');
if (relativeFiles.filter((file) => file.endsWith('.html')).join(',') !== 'index.html') {
  fail('The package must contain exactly one root index.html');
}

for (const relativeFile of relativeFiles) {
  const extension = path.extname(relativeFile).toLowerCase();
  if (!allowedExtensions.has(extension)) fail(`Unsupported file type: ${relativeFile}`);
  if (/(^|\/)(node_modules|\.git)(\/|$)|\.map$|(^|\/)vite\.config\./i.test(relativeFile)) {
    fail(`Development file leaked into package: ${relativeFile}`);
  }
}

const html = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
const htmlChecks = [
  [/^<!doctype html>/i, 'index.html is missing <!DOCTYPE html>'],
  [/<html\b[^>]*\blang="zh-CN"/i, 'index.html lang must be zh-CN'],
  [/<meta\b[^>]*charset="?UTF-8"?/i, 'index.html charset must be UTF-8'],
  [/<meta\b[^>]*name="viewport"[^>]*content="[^"]*width=device-width[^"]*initial-scale=1\.0[^"]*viewport-fit=cover/i, 'viewport is missing required values'],
];
for (const [pattern, message] of htmlChecks) {
  if (!pattern.test(html)) fail(message);
}

const forbiddenHtml = [
  [/<script\b(?![^>]*\bsrc=)[^>]*>/i, 'inline script is forbidden'],
  [/<script\b[^>]*\btype="module"/i, 'module scripts are forbidden'],
  [/\son[a-z]+\s*=/i, 'inline event handlers are forbidden'],
  [/javascript\s*:/i, 'javascript: URLs are forbidden'],
  [/<base\b/i, '<base> is forbidden'],
  [/<(?:iframe|object)\b/i, 'iframe/object is forbidden'],
  [/Content-Security-Policy/i, 'custom CSP is forbidden'],
  [/(?:src|href)="https?:\/\//i, 'external resources are forbidden'],
  [/(?:src|href)="\//i, 'absolute resource paths are forbidden'],
  [/target="_blank"/i, 'new-window links are forbidden'],
  [/<a\b[^>]*\bdownload\b/i, 'browser downloads are forbidden'],
];
for (const [pattern, message] of forbiddenHtml) {
  if (pattern.test(html)) fail(message);
}

const referencedFiles = new Set();
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/gi)) {
  const reference = match[1].split(/[?#]/, 1)[0];
  if (!reference || /^(?:data:|blob:|#)/i.test(reference)) continue;
  referencedFiles.add(reference);
}
for (const reference of referencedFiles) {
  const resolved = path.resolve(packageRoot, reference);
  if (!resolved.startsWith(packageRoot + path.sep) || !existsSync(resolved)) {
    fail(`Missing or unsafe referenced asset: ${reference}`);
  }
}

const scriptFiles = files.filter((file) => path.extname(file).toLowerCase() === '.js');
for (const scriptFile of scriptFiles) {
  try {
    execFileSync(process.execPath, ['--check', scriptFile], { stdio: 'pipe' });
  } catch (error) {
    fail(`JavaScript syntax check failed: ${path.relative(packageRoot, scriptFile)} (${error.message})`);
  }
}

const scannable = files
  .filter((file) => ['.html', '.css', '.js'].includes(path.extname(file).toLowerCase()))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
const forbiddenCode = [
  [/\bfetch\s*\(/, 'fetch'],
  [/XMLHttpRequest/, 'XMLHttpRequest'],
  [/\bnew\s+(?:WebSocket|EventSource|RTCPeerConnection|Worker|SharedWorker)\s*\(/, 'network/worker constructor'],
  [/navigator\.(?:geolocation|clipboard|bluetooth|usb|hid|serial|getBattery|connection|credentials|locks|serviceWorker)/, 'forbidden navigator API'],
  [/document\.execCommand\s*\(/, 'document.execCommand'],
  [/(?:DeviceMotionEvent|DeviceOrientationEvent|requestFullscreen|webkitRequestFullscreen)/, 'sensor/fullscreen API'],
  [/\beval\s*\(|\bnew\s+Function\s*\(|WebAssembly\./, 'dynamic code or WebAssembly'],
  [/window\.(?:open|prompt)\s*\(/, 'window.open/window.prompt'],
  [/\.download\s*=/, 'browser download assignment'],
  [/\bimport\s*(?:\(|["'{*])|\bexport\s+(?:default|const|let|var|function|class|\{|\*)/, 'module import/export'],
];
for (const [pattern, label] of forbiddenCode) {
  if (pattern.test(scannable)) fail(`Forbidden capability remains in build: ${label}`);
}

for (const cssFile of files.filter((file) => path.extname(file).toLowerCase() === '.css')) {
  const css = readFileSync(cssFile, 'utf8');
  for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
    const reference = match[1].split(/[?#]/, 1)[0];
    if (!reference || /^(?:data:|blob:|#)/i.test(reference)) continue;
    if (/^https?:\/\//i.test(reference)) {
      fail(`External CSS asset: ${reference}`);
      continue;
    }
    const resolved = path.resolve(path.dirname(cssFile), reference);
    if (!resolved.startsWith(packageRoot + path.sep) || !existsSync(resolved)) {
      fail(`Missing CSS asset: ${reference}`);
    }
  }
}

const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
const report = {
  status: failures.length ? 'fail' : 'pass',
  packageRoot,
  fileCount: files.length,
  totalBytes,
  indexAtRoot: existsSync(indexPath),
  classicScripts: !/<script\b[^>]*\btype="module"/i.test(html),
  externalResources: false,
  forbiddenCapabilityMatches: failures.filter((item) => item.startsWith('Forbidden capability')).length,
  failures,
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
