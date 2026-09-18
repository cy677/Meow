#!/usr/bin/env bash
set -Eeuo pipefail

BASE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
PACKAGE="$1"
SOURCE="$BASE/Exports/$PACKAGE"
ARCHIVE="$BASE/Exports/$PACKAGE.tar.gz"
TARFILE="$BASE/Exports/$PACKAGE.tar"
test -d "$SOURCE"
rm -f -- "$ARCHIVE" "$TARFILE"
cd -- "$BASE/Exports"
COMMON=(--format=posix --owner=0 --group=0 --numeric-owner --no-recursion)
tar "${COMMON[@]}" --mode=0755 -cf "$TARFILE" "$PACKAGE"
find "$PACKAGE" -mindepth 1 -type d -print0 | tar "${COMMON[@]}" --mode=0755 --null -T - -rf "$TARFILE"
find "$PACKAGE" -type f ! -path "$PACKAGE/Meow" ! -path "$PACKAGE/runtime/node" -print0 | tar "${COMMON[@]}" --mode=0644 --null -T - -rf "$TARFILE"
printf '%s\0' "$PACKAGE/Meow" "$PACKAGE/runtime/node" | tar "${COMMON[@]}" --mode=0755 --null -T - -rf "$TARFILE"
gzip -9 "$TARFILE"
tar -tvzf "$ARCHIVE" | grep -E '(/Meow|/runtime/node)$'
chmod +x "$BASE/scripts/validate_ubuntu_portable.sh"
"$BASE/scripts/validate_ubuntu_portable.sh" "$ARCHIVE"
