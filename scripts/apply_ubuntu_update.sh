#!/usr/bin/env bash
set -Eeuo pipefail
PATCH_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
[[ $# == 1 ]] || { echo '用法：bash update.sh /完整路径/Meow安装目录'; exit 2; }
TARGET="$(cd -- "$1" && pwd -P)"
NODE="$TARGET/runtime/node"
[[ -x "$NODE" && -f "$TARGET/pet/server.mjs" && -f "$TARGET/pet-settings.json" ]] || { echo '目标不是完整的 Ubuntu Meow 便携版。'; exit 1; }
DATA_DIR="$($NODE -e 'const p=require("path"),f=require("fs");const root=process.argv[1],s=JSON.parse(f.readFileSync(p.join(root,"pet-settings.json"),"utf8"));console.log(p.resolve(root,process.env.MEOW_DATA_DIR||s.dataDir||"pet/data"))' "$TARGET")"
mkdir -p -- "$DATA_DIR"
exec 9>"$DATA_DIR/.meow-operation.lock"
flock -n 9 || { echo '请先停止此安装目录的 Meow 服务再更新。'; exit 1; }
"$NODE" "$PATCH_ROOT/apply-update.mjs" "$TARGET"
echo '更新完成。家庭数据、配置和运行环境保持不变。可执行 ./Meow 启动。'
