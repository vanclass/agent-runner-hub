#!/bin/sh
project_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P) || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "[Web App] Runtime failed: install Node.js with npm (20.19+ or 22.12+) and retry." >&2
  exit 1
fi
exec node "$project_root/.runner/web-app-launch/entry.mjs" "$@"
