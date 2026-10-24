#!/bin/sh
project_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P) || exit 1
exec "$project_root/run.sh" "$@"
