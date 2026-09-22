#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
[[ $# == 2 && "$1" =~ ^[A-Za-z0-9_.-]+$ && "$1" != '.' && "$1" != '..' && ( "$2" == 'update' || "$2" == 'portable' ) ]] || { echo '用法：bash scripts/package_ubuntu_archives.sh Exports下的目录名 update|portable'; exit 2; }
cd -- "$ROOT/Exports"
SOURCE="$1"; ARCHIVE="$SOURCE.tar.gz"; TEMP="$ARCHIVE.tmp-$$.tar"
[[ -d "$SOURCE" && ! -L "$SOURCE" && ! -e "$ARCHIVE" ]] || { echo '源目录无效，或同名压缩包已存在'; exit 1; }
[[ -z "$(find "$SOURCE" -type l -print -quit)" ]] || { echo '发行目录不能包含符号链接'; exit 1; }
# Never archive a previously used installation or household configuration.
[[ -z "$(find "$SOURCE" \( -name pet-settings.json -o -name '*.sqlite*' -o -name '*.pem' -o -name '*.key' -o -name update-backups \) -print -quit)" ]] || { echo '发行目录包含家庭数据、实际配置或私钥'; exit 1; }
trap 'rm -f -- "$TEMP"' EXIT
COMMON=(--format=posix --owner=0 --group=0 --numeric-owner --no-recursion)
if [[ "$2" == 'portable' ]]; then EXE=("$SOURCE/Meow" "$SOURCE/runtime/node"); else EXE=("$SOURCE/update.sh" "$SOURCE/payload/Meow"); fi
for file in "${EXE[@]}"; do [[ -f "$file" ]] || { echo "缺少执行入口：$file"; exit 1; }; chmod 0755 "$file"; done
find "$SOURCE" -type d -print0 | tar "${COMMON[@]}" --mode=0755 --null -T - -cf "$TEMP"
find "$SOURCE" -type f ! -perm /111 -print0 | tar "${COMMON[@]}" --mode=0644 --null -T - -rf "$TEMP"
find "$SOURCE" -type f -perm /111 -print0 | tar "${COMMON[@]}" --mode=0755 --null -T - -rf "$TEMP"
gzip -c "$TEMP" > "$ARCHIVE"
sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"
echo "已生成：$ARCHIVE"
