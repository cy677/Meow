#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
PATCH_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
[[ $# == 1 ]] || { echo '用法：bash update.sh /完整路径/Meow安装目录'; exit 2; }
TARGET="$(cd -- "$1" && pwd -P)"
NODE="$TARGET/runtime/node"
[[ -x "$NODE" && -f "$TARGET/pet/server.mjs" ]] || { echo '目标不是完整的 Ubuntu Meow 便携版。'; exit 1; }
DATA_DIR="$("$NODE" "$PATCH_ROOT/config/cli.mjs" --root "$TARGET" --read-only --data-dir)"
mkdir -p -- "$DATA_DIR"
exec 9>"$DATA_DIR/.meow-operation.lock"
flock -n 9 || { echo '请先停止此安装目录的 Meow 服务再更新。'; exit 1; }
MEOW_DATA_DIR="$DATA_DIR" "$NODE" "$PATCH_ROOT/apply-update.mjs" "$TARGET"
echo '更新完成。家庭配置和数据保持不变；启动前请检查终端显示的实际数据目录。'
