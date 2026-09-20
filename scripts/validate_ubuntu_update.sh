#!/usr/bin/env bash
# Focused isolated upgrade check. Never opens the source installation's family database.
set -Eeuo pipefail
[[ $# == 2 ]] || { echo '用法：bash scripts/validate_ubuntu_update.sh /便携包目录 /补丁目录'; exit 2; }
SOURCE="$(realpath "$1")"; PATCH="$(realpath "$2")"
[[ -x "$SOURCE/runtime/node" && -f "$PATCH/update.sh" ]] || { echo '运行环境或补丁不存在'; exit 1; }
WORK="$(mktemp -d -t meow-upgrade-check.XXXXXX)"
trap 'rm -rf -- "$WORK"' EXIT
TARGET="$WORK/app"; DATA="$WORK/family"
mkdir -p -- "$TARGET" "$DATA"
cp -a "$SOURCE/." "$TARGET/"
NODE="$TARGET/runtime/node"
# All subsequent operations explicitly target the isolated directory.
MEOW_DATA_DIR="$DATA" "$NODE" --input-type=module - "$TARGET" "$DATA" "$WORK" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [app,data,work]=process.argv.slice(2);
const {createStore}=await import(pathToFileURL(path.join(app,'pet/store.mjs')));
const store=createStore(path.join(data,'pet.sqlite'),JSON.parse(fs.readFileSync(path.join(app,'pet/rewards.json'),'utf8')));
store.profile({childName:'旧孩子',petName:'旧小猫'});
store.points({delta:50,reason:'保留的旧记录',idempotencyKey:'upgrade-check-award-01'});
store.purchase({rewardId:'coat-grey',expectedCost:25,idempotencyKey:'upgrade-check-buy-01'});
const state=store.snapshot(true);
fs.writeFileSync(path.join(work,'before.json'),JSON.stringify({state,ledger:store.exportData().ledger}));
store.close();
fs.writeFileSync(path.join(app,'pet-settings.json'),JSON.stringify({dataDir:data,port:8899,host:'127.0.0.1',customMarker:'keep',openBrowser:false}));
fs.copyFileSync(path.join(app,'pet-settings.json'),path.join(work,'config-before.json'));
fs.writeFileSync(path.join(data,'family-note.txt'),'keep this note');
NODE
MEOW_DATA_DIR="$DATA" bash "$PATCH/update.sh" "$TARGET"
MEOW_DATA_DIR="$DATA" "$NODE" --input-type=module - "$TARGET" "$DATA" "$WORK" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const [app,data,work]=process.argv.slice(2);
const before=JSON.parse(fs.readFileSync(path.join(work,'before.json'),'utf8'));
assert.deepEqual(fs.readFileSync(path.join(app,'pet-settings.json')),fs.readFileSync(path.join(work,'config-before.json')));
assert.equal(fs.readFileSync(path.join(data,'family-note.txt'),'utf8'),'keep this note');
const {createStore}=await import(pathToFileURL(path.join(app,'pet/store.mjs')));
const store=createStore(path.join(data,'pet.sqlite'),JSON.parse(fs.readFileSync(path.join(app,'pet/rewards.json'),'utf8')));
store.installSceneRewards();store.installUpstreamRewards();store.installGrowthReward();
const after=store.snapshot(true),ledger=store.exportData().ledger;
for(const field of ['balance','lifetime','childName','petName'])assert.equal(after[field],before.state[field],field);
for(const owned of before.state.owned)assert.ok(after.owned.includes(owned),owned);
for(const entry of before.ledger)assert.deepEqual(ledger.find(r=>r.id===entry.id),entry);
store.close();
const backups=fs.readdirSync(path.join(app,'update-backups'));
assert.equal(backups.length,1);
assert.ok(fs.existsSync(path.join(app,'update-backups',backups[0],'family-data/pet.sqlite')));
assert.ok(fs.existsSync(path.join(app,'update-backups',backups[0],'program/pet/store.mjs')));
console.log('PASS: isolated upgrade preserves balance, lifetime, ownership, ledger, names, settings and data backup');
NODE
