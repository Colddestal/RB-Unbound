#!/usr/bin/env bash
set -euo pipefail

release_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$release_dir"
if [[ -z ${RB_UNBOUND_ACCOUNT_PATH:-} && -n ${RB_UNBOUND_STATE_PATH:-} ]]; then
  export RB_UNBOUND_ACCOUNT_PATH="$(dirname -- "$RB_UNBOUND_STATE_PATH")/accounts.json"
fi
export RB_UNBOUND_RELEASE_SHA
RB_UNBOUND_RELEASE_SHA=$(git rev-parse HEAD)
exec node --import tsx server/src/index.ts
