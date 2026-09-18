#!/usr/bin/env bash
set -Eeuo pipefail

ARCHIVE="$(realpath "$1")"
WORK="$(mktemp -d)"
PID=""
cleanup() {
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then kill -TERM "$PID"; wait "$PID" || true; fi
  rm -rf -- "$WORK"
}
trap cleanup EXIT

grep -q '^VERSION_ID="24.04"$' /etc/os-release
tar -xzf "$ARCHIVE" -C "$WORK"
APP="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d -print -quit)"
test -x "$APP/Meow"
test -x "$APP/runtime/node"
test ! -e "$APP/pet/data"
file "$APP/runtime/node" | grep -q 'ELF 64-bit.*x86-64'
if ldd "$APP/runtime/node" | grep -q 'not found'; then ldd "$APP/runtime/node"; exit 1; fi
[[ "$($APP/runtime/node -p "process.platform + '/' + process.arch")" == 'linux/x64' ]]

PORT="$($APP/runtime/node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
DATA="$WORK/data"
MEOW_PORT="$PORT" MEOW_DATA_DIR="$DATA" "$APP/Meow" --no-browser >"$WORK/server.log" 2>&1 &
PID=$!

"$APP/runtime/node" - "$APP" "$PORT" <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = process.argv[2];
const origin = `http://127.0.0.1:${process.argv[3]}`;
(async () => {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(origin + '/api/status');
      assert.deepEqual(await response.json(), { configured: false });
      ready = true;
      break;
    } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert(ready, 'server did not become ready');
  const dist = path.join(app, 'pet', 'dist');
  const files = fs.readdirSync(dist, { recursive: true }).filter(file => fs.statSync(path.join(dist, file)).isFile());
  for (const file of files) {
    const response = await fetch(origin + '/' + file.replaceAll('\\', '/'));
    assert.equal(response.status, 200, file);
    assert.equal((await response.arrayBuffer()).byteLength, fs.statSync(path.join(dist, file)).size, file);
  }
  console.log(`PASS: Ubuntu 24.04 launch, SQLite API, and ${files.length} built resources.`);
})().catch(error => { console.error(error); process.exit(1); });
NODE

test -f "$DATA/pet.sqlite"
kill -TERM "$PID"
wait "$PID"
PID=""
if "$APP/runtime/node" -e "fetch('http://127.0.0.1:$PORT').then(()=>process.exit(1),()=>process.exit(0))"; then
  printf '%s\n' 'PASS: service stopped and port released.'
else
  printf '%s\n' 'Service port is still open.' >&2
  exit 1
fi
