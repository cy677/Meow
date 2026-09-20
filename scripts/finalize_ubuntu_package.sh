#!/usr/bin/env bash
set -Eeuo pipefail
BASE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
[[ $# -ge 1 && $# -le 2 ]] || { echo '用法：bash scripts/finalize_ubuntu_package.sh Exports下的目录名 [--validate]'; exit 2; }
[[ $# == 1 || "$2" == '--validate' ]] || { echo '未知参数'; exit 2; }
bash "$BASE/scripts/package_ubuntu_archives.sh" "$1" portable
if [[ "${2:-}" == '--validate' ]]; then bash "$BASE/scripts/validate_ubuntu_portable.sh" "$BASE/Exports/$1.tar.gz"; fi
