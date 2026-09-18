import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import net from 'node:net';

const root = resolve(process.argv[2]);
const temporary = mkdtempSync(join(tmpdir(), 'meow-portable-'));
const probe = net.createServer();
await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise(r => probe.close(r));
const env = { ...process.env, PATH: `${process.env.SystemRoot}\\System32`, MEOW_DATA_DIR: temporary, MEOW_PORT: String(port), MEOW_PUBLIC_IP: '' };
delete env.NODE_PATH;
delete env.NODE_OPTIONS;
delete env.MEOW_ORIGIN;
let output = '';
const child = spawn(join(root, 'Meow.exe'), ['--no-browser', '--skip-firewall'], { cwd: temporary, env, windowsHide: true });
child.stdout.on('data', b => { output += b; });
child.stderr.on('data', b => { output += b; });
let stopped = false;
child.on('exit', () => { stopped = true; });
const origin = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(origin + '/api/status'); assert.deepEqual(await r.json(), { configured: false }); ready = true; break; } catch {}
    if (stopped) throw new Error(output);
    await new Promise(r => setTimeout(r, 250));
  }
  assert(ready, 'Portable launcher did not start: ' + output);
  const files = readdirSync(join(root, 'pet/dist'), { recursive: true }).filter(p => statSync(join(root, 'pet/dist', p)).isFile());
  for (const file of files) {
    const r = await fetch(origin + '/' + file.replaceAll('\\', '/'));
    assert.equal(r.status, 200, file);
    assert.equal((await r.arrayBuffer()).byteLength, statSync(join(root, 'pet/dist', file)).size, file);
  }
  assert(existsSync(join(temporary, 'pet.sqlite')), 'SQLite not created');
  assert(!existsSync(join(root, 'pet/data')), 'Release contains data');
  console.log(`PASS: EXE launches without Node on PATH; SQLite created; ${files.length} built resources served correctly.`);
} finally {
  if (!stopped) execFileSync(join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  for (let i = 0; i < 40 && !stopped; i++) await new Promise(r => setTimeout(r, 100));
  rmSync(temporary, { recursive: true, force: true });
  const socket = net.connect(port, '127.0.0.1');
  await new Promise((ok, fail) => { socket.once('error', ok); socket.once('connect', () => { socket.destroy(); fail(new Error('Test port still listening')); }); });
  console.log('PASS: test process tree stopped and port released.');
}
