#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd -- "$ROOT/Exports"
package() {
  local source="$1" archive="$2" temporary="$2.tmp-$$.tar"
  shift 2
  local common=(--format=posix --owner=0 --group=0 --numeric-owner --no-recursion)
  tar "${common[@]}" --mode=0755 -cf "$temporary" "$source"
  find "$source" \( -path "$source/pet/data" -o -path "$source/update-backups" \) -prune -o -mindepth 1 -type d -print0 | tar "${common[@]}" --mode=0755 --null -T - -rf "$temporary"
  find "$source" \( -path "$source/pet/data" -o -path "$source/update-backups" \) -prune -o -type f ! -path "$source/Meow" ! -path "$source/runtime/node" ! -path "$source/update.sh" -print0 | tar "${common[@]}" --mode=0644 --null -T - -rf "$temporary"
  for executable in "$@"; do tar "${common[@]}" --mode=0755 -rf "$temporary" "$source/$executable"; done
  gzip -c "$temporary" > "$archive"
  rm -- "$temporary"
  sha256sum "$archive" > "$archive.sha256"
  echo "已生成：$archive"
}
package Meow-V6-Ubuntu-update-20260918 Meow-V6-Ubuntu-update-20260918.tar.gz update.sh
package Meow-V6-Ubuntu24 Meow-V6-Ubuntu24-updated-20260918.tar.gz Meow runtime/node
