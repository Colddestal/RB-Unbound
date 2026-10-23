#!/usr/bin/env bash
set -euo pipefail

release_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$release_dir"
export RB_UNBOUND_RELEASE_SHA
RB_UNBOUND_RELEASE_SHA=$(git rev-parse HEAD)
exec node --import tsx server/src/index.ts
