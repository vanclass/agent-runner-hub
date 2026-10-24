#!/bin/sh
project_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Environment Preparation Required: install compatible Node.js (20.19+ or 22.12+) with npm."
  exit 1
fi
exec node "$project_root/tools/web_app_build_system/src/entry.mjs" "$@"
