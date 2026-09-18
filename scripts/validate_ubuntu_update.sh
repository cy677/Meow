#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# != 2 ]]; then
  printf '%s\n' '用法：bash scripts/validate_ubuntu_update.sh /完整路径/Meow-V6-Ubuntu24 /完整路径/Meow-V6-Ubuntu-update-20260918' >&2
  exit 2
fi

SOURCE_TARGET="$(realpath "$1")"
SOURCE_PATCH="$(realpath "$2")"
[[ -d "$SOURCE_TARGET" && -d "$SOURCE_PATCH" ]] || { printf '%s\n' '源目录不存在。' >&2; exit 2; }
grep -q '^VERSION_ID="24.04"$' /etc/os-release || { printf '%s\n' '必须在 Ubuntu 24.04 上运行。' >&2; exit 1; }

WORK="$(mktemp -d -t meow-ubuntu-update-validation.XXXXXX)"
SERVER_PID=""
LOCK_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "$LOCK_PID" ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
    kill -TERM "$LOCK_PID" 2>/dev/null || true
    wait "$LOCK_PID" 2>/dev/null || true
  fi
  rm -rf -- "$WORK"
}
trap cleanup EXIT

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
assert_equal() { [[ "$1" == "$2" ]] || fail "$3 (实际：$1；预期：$2)"; }

TARGET="$WORK/target"
PATCH="$WORK/patch"
mkdir -p -- "$TARGET" "$PATCH"
cp -a "$SOURCE_TARGET/." "$TARGET/"
cp -a "$SOURCE_PATCH/." "$PATCH/"

NODE="$TARGET/runtime/node"
[[ -x "$NODE" ]] || fail '便携版 runtime/node 没有执行权限'
[[ -x "$TARGET/Meow" ]] || fail '便携版 Meow 没有执行权限'

BUILD_HASH_BEFORE="$(sha256sum "$TARGET/BUILD.json" | awk '{print $1}')"
STORE_HASH_BEFORE="$(sha256sum "$TARGET/pet/store.mjs" | awk '{print $1}')"
MEOW_HASH_BEFORE="$(sha256sum "$TARGET/Meow" | awk '{print $1}')"
PACKAGE_HASH_BEFORE="$(sha256sum "$TARGET/package.json" | awk '{print $1}')"

DATA="$TARGET/pet/data"
mkdir -p -- "$DATA"

# Seed a realistic old account using the old package before the update.
"$NODE" --input-type=module - "$TARGET" "$DATA" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const app = process.argv[2];
const data = process.argv[3];
const { createStore } = await import(pathToFileURL(path.join(app, 'pet/store.mjs')).href);
const catalog = JSON.parse(fs.readFileSync(path.join(app, 'pet/rewards.json'), 'utf8'));
const store = createStore(path.join(data, 'pet.sqlite'), catalog);
store.profile({ childName: '旧孩子', petName: '旧小猫' });
store.points({ delta: 50, reason: '旧版保留记录', idempotencyKey: 'old-points-00000001' });
store.purchase({ rewardId: 'trick-jump', expectedCost: 15, idempotencyKey: 'old-buy-000000001' });
store.close();
fs.writeFileSync(path.join(data, 'legacy-note.txt'), 'legacy data must survive update\n');
const settings = JSON.parse(fs.readFileSync(path.join(app, 'pet-settings.json'), 'utf8'));
settings.openBrowser = false;
settings.configureFirewall = false;
fs.writeFileSync(path.join(app, 'pet-settings.json'), JSON.stringify(settings, null, 2) + '\n');
NODE

CONFIG_HASH_BEFORE="$(sha256sum "$TARGET/pet-settings.json" | awk '{print $1}')"
DATA_HASH_BEFORE="$(sha256sum "$DATA/pet.sqlite" | awk '{print $1}')"
NOTE_HASH_BEFORE="$(sha256sum "$DATA/legacy-note.txt" | awk '{print $1}')"
pass '旧账户、配置和附加数据已创建'

APPLY_OUTPUT="$(bash "$PATCH/update.sh" "$TARGET" 2>&1)" || {
  printf '%s\n' "$APPLY_OUTPUT" >&2
  fail '更新补丁应用失败'
}
printf '%s\n' "$APPLY_OUTPUT"
BACKUP="$(printf '%s\n' "$APPLY_OUTPUT" | sed -n 's/^程序备份：//p' | tail -n 1)"
[[ -n "$BACKUP" && -d "$BACKUP" ]] || fail '更新后没有生成程序备份'
[[ -f "$BACKUP/UPDATE.json" ]] || fail '程序备份缺少 UPDATE.json'
pass '更新补丁应用成功并生成程序备份'

"$NODE" --input-type=module - "$TARGET" "$DATA" "$DATA_HASH_BEFORE" "$CONFIG_HASH_BEFORE" "$NOTE_HASH_BEFORE" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const app = process.argv[2], data = process.argv[3];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (hash(path.join(data, 'pet.sqlite')) !== process.argv[4]) throw new Error('旧数据库内容发生变化');
if (hash(path.join(app, 'pet-settings.json')) !== process.argv[5]) throw new Error('pet-settings.json 被更新覆盖');
if (hash(path.join(data, 'legacy-note.txt')) !== process.argv[6]) throw new Error('数据目录中的附加文件丢失');
const { createStore } = await import(pathToFileURL(path.join(app, 'pet/store.mjs')).href);
const catalog = JSON.parse(fs.readFileSync(path.join(app, 'pet/rewards.json'), 'utf8'));
const store = createStore(path.join(data, 'pet.sqlite'), catalog);
const before = store.snapshot();
if (before.childName !== '旧孩子' || before.petName !== '旧小猫') throw new Error('旧昵称未保留');
if (before.balance !== 35 || before.lifetime !== 50) throw new Error(`旧余额/累计分值不正确：${before.balance}/${before.lifetime}`);
if (!before.owned.includes('trick-jump') || !before.owned.includes('coat-cream')) throw new Error('旧拥有奖励未保留');
store.close();
NODE
pass '旧数据库、昵称、余额、累计分值、奖励和配置完整保留'

BUILD_RELEASE="$($NODE -e "console.log(JSON.parse(require('fs').readFileSync('$TARGET/BUILD.json','utf8')).release)")"
assert_equal "$BUILD_RELEASE" 'Meow-V6-Ubuntu-update-20260918' 'BUILD.json 未更新到补丁版本'
CONFIG_HASH_AFTER="$(sha256sum "$TARGET/pet-settings.json" | awk '{print $1}')"
MEOW_HASH_AFTER="$(sha256sum "$TARGET/Meow" | awk '{print $1}')"
PACKAGE_HASH_AFTER="$(sha256sum "$TARGET/package.json" | awk '{print $1}')"
assert_equal "$CONFIG_HASH_AFTER" "$CONFIG_HASH_BEFORE" '配置文件哈希变化'
assert_equal "$MEOW_HASH_AFTER" "$MEOW_HASH_BEFORE" '启动器被意外覆盖'
assert_equal "$PACKAGE_HASH_AFTER" "$PACKAGE_HASH_BEFORE" 'package.json 被意外覆盖'
assert_equal "$(sha256sum "$TARGET/pet/store.mjs" | awk '{print $1}')" "$(sha256sum "$PATCH/payload/pet/store.mjs" | awk '{print $1}')" 'store.mjs 与补丁 payload 不一致'
assert_equal "$(sha256sum "$TARGET/pet/growthStore.mjs" | awk '{print $1}')" "$(sha256sum "$PATCH/payload/pet/growthStore.mjs" | awk '{print $1}')" 'growthStore.mjs 与补丁 payload 不一致'
pass '更新范围符合约定，未覆盖启动器、package.json 或配置'

# Exercise the new balance correction path against the migrated persistent database.
"$NODE" --input-type=module - "$TARGET" "$DATA" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const app = process.argv[2], data = process.argv[3];
const { createStore } = await import(pathToFileURL(path.join(app, 'pet/store.mjs')).href);
const catalog = JSON.parse(fs.readFileSync(path.join(app, 'pet/rewards.json'), 'utf8'));
const store = createStore(path.join(data, 'pet.sqlite'), catalog);
store.growth.configure({ age: 6, mode: 'school_basic', timeZone: 'UTC' });
const old = store.snapshot();
store.growth.award({
  category: 'responsibility', title: '核对后的成长记录', delta: 5,
  reason: '按约定完成了整理', occurredAt: new Date().toISOString(),
  basisConfirmed: true, idempotencyKey: randomUUID()
});
const awarded = store.history({ kind: 'earn' }).entries.find(entry => entry.reason === '按约定完成了整理');
if (!awarded) throw new Error('没有找到成长记录');
store.growth.correct({ recordId: awarded.id, points: 3, reason: '复核后应记三分', idempotencyKey: randomUUID() });
const corrected = store.snapshot();
if (corrected.balance !== old.balance + 3) throw new Error(`余额更正错误：${corrected.balance}`);
if (corrected.lifetime !== old.lifetime + 5) throw new Error(`累计成长分被错误回收：${corrected.lifetime}`);
let repeated = false;
try { store.growth.correct({ recordId: awarded.id, points: 4, reason: '重复更正', idempotencyKey: randomUUID() }); }
catch (error) { repeated = error.status === 409; }
if (!repeated) throw new Error('重复更正未被拒绝');
store.close();
NODE
pass '余额分值更正按差额结算，累计成长分不回收，重复更正被拒绝'

# A held operation lock must stop the update before it changes program files.
LOCK_TARGET="$WORK/lock-target"
cp -a "$TARGET/." "$LOCK_TARGET/"
(
  exec 9>"$LOCK_TARGET/pet/data/.meow-operation.lock"
  flock -n 9
  sleep 30
) &
LOCK_PID=$!
sleep 0.3
set +e
LOCK_OUTPUT="$(bash "$PATCH/update.sh" "$LOCK_TARGET" 2>&1)"
LOCK_STATUS=$?
set -e
kill -TERM "$LOCK_PID" 2>/dev/null || true
wait "$LOCK_PID" 2>/dev/null || true
LOCK_PID=""
(( LOCK_STATUS != 0 )) || fail '锁定数据目录时更新意外成功'
grep -q '请先停止此安装目录的 Meow 服务再更新' <<<"$LOCK_OUTPUT" || { printf '%s\n' "$LOCK_OUTPUT" >&2; fail '锁定拒绝信息不正确'; }
pass '数据目录被锁定时更新被拒绝'

# A tampered payload must fail before a backup or program replacement is created.
BAD_PATCH="$WORK/bad-patch"
BAD_TARGET="$WORK/bad-target"
cp -a "$PATCH/." "$BAD_PATCH/"
cp -a "$SOURCE_TARGET/." "$BAD_TARGET/"
BAD_NODE="$BAD_TARGET/runtime/node"
"$BAD_NODE" -e "require('fs').appendFileSync(process.argv[1], '\\n')" "$BAD_PATCH/payload/pet/store.mjs"
BAD_STORE_HASH="$(sha256sum "$BAD_TARGET/pet/store.mjs" | awk '{print $1}')"
BAD_BUILD_HASH="$(sha256sum "$BAD_TARGET/BUILD.json" | awk '{print $1}')"
BAD_BACKUPS_BEFORE="$(find "$BAD_TARGET/update-backups" -mindepth 1 -maxdepth 1 -printf '%f\n' 2>/dev/null | sort || true)"
set +e
BAD_OUTPUT="$(bash "$BAD_PATCH/update.sh" "$BAD_TARGET" 2>&1)"
BAD_STATUS=$?
set -e
(( BAD_STATUS != 0 )) || fail '篡改补丁意外应用成功'
grep -q '补丁校验失败' <<<"$BAD_OUTPUT" || { printf '%s\n' "$BAD_OUTPUT" >&2; fail '篡改补丁没有报告校验失败'; }
assert_equal "$(sha256sum "$BAD_TARGET/pet/store.mjs" | awk '{print $1}')" "$BAD_STORE_HASH" '校验失败后目标程序发生变化'
assert_equal "$(sha256sum "$BAD_TARGET/BUILD.json" | awk '{print $1}')" "$BAD_BUILD_HASH" '校验失败后 BUILD.json 发生变化'
BAD_BACKUPS_AFTER="$(find "$BAD_TARGET/update-backups" -mindepth 1 -maxdepth 1 -printf '%f\n' 2>/dev/null | sort || true)"
assert_equal "$BAD_BACKUPS_AFTER" "$BAD_BACKUPS_BEFORE" '校验失败前意外创建了程序备份'
pass '补丁校验错误被拒绝且目标未被替换'

# Start the shipped launcher, fetch every built resource, then verify a clean shutdown.
PORT="$($NODE -e "const net=require('net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
MEOW_PORT="$PORT" MEOW_DATA_DIR="$DATA" "$TARGET/Meow" --no-browser >"$WORK/server.log" 2>&1 &
SERVER_PID=$!
"$NODE" --input-type=module - "$TARGET" "$PORT" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const app = process.argv[2];
const origin = `http://127.0.0.1:${process.argv[3]}`;
let ready = false;
for (let i = 0; i < 80; i++) {
  try {
    const response = await fetch(origin + '/api/status');
    if (response.status !== 200) throw new Error(`status ${response.status}`);
    const status = await response.json();
    if (status.configured !== false) throw new Error('unexpected configured state');
    ready = true;
    break;
  } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
}
if (!ready) throw new Error('server did not become ready');
const dist = path.join(app, 'pet', 'dist');
const files = fs.readdirSync(dist, { recursive: true }).filter(file => fs.statSync(path.join(dist, file)).isFile());
for (const file of files) {
  const response = await fetch(origin + '/' + file.replaceAll('\\', '/'));
  if (response.status !== 200) throw new Error(`${file}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const expected = fs.statSync(path.join(dist, file)).size;
  if (bytes.byteLength !== expected) throw new Error(`${file}: ${bytes.byteLength} != ${expected}`);
}
console.log(`PASS: production launcher, SQLite API, and ${files.length} built resources.`);
NODE
kill -TERM "$SERVER_PID"
wait "$SERVER_PID"
SERVER_PID=""
if "$NODE" -e "fetch('http://127.0.0.1:$PORT').then(()=>process.exit(1),()=>process.exit(0))"; then
  pass '服务停止后端口已释放'
else
  printf '%s\n' '服务端口仍然开放。' >&2
  cat "$WORK/server.log" >&2 || true
  fail '服务端口释放检查失败'
fi

printf '%s\n' 'Ubuntu 24.04 更新补丁验证全部通过。'
