#!/usr/bin/env bash
# Run as the unprivileged user that owns the server's systemd --user units.
set -euo pipefail

root=${RB_UNBOUND_ROOT:-"$HOME/rb-unbound"}
repo_url=${RB_UNBOUND_REPO_URL:-https://github.com/Colddestal/RB-Unbound.git}
branch=${RB_UNBOUND_BRANCH:-main}
state_path=${RB_UNBOUND_STATE_PATH:-"$root/state/server-state.json"}
source_dir="$root/source"
releases_dir="$root/releases"
current="$root/current"

mkdir -p "$root" "$releases_dir" "$(dirname -- "$state_path")"
exec 9>"$root/update.lock"
flock -n 9 || exit 0

if [[ ! -d "$source_dir/.git" ]]; then
  git clone --no-checkout "$repo_url" "$source_dir"
fi
git -C "$source_dir" fetch --no-tags origin "refs/heads/$branch"
target=$(git -C "$source_dir" rev-parse 'FETCH_HEAD^{commit}')
release="$releases_dir/$target"
previous=$(readlink -f -- "$current" 2>/dev/null || true)
if [[ "$previous" == "$release" ]]; then
  echo "Already running $target"
  exit 0
fi

# A failed earlier build can leave a worktree; rebuild it from scratch.
if [[ -e "$release" ]]; then
  git -C "$source_dir" worktree remove --force "$release"
fi
git -C "$source_dir" worktree add --detach "$release" "$target"
if ! (cd "$release" && npm ci --no-audit --no-fund && npm run check && npm test && npm run test:match && npm run build); then
  git -C "$source_dir" worktree remove --force "$release"
  echo "Candidate $target failed validation; current release was not changed." >&2
  exit 1
fi

# Used only during the one-time installation before the user service exists.
if [[ ${RB_UNBOUND_SKIP_RESTART:-0} == 1 ]]; then
  rm -f -- "$root/current.next"
  ln -s "releases/$target" "$root/current.next"
  mv -Tf -- "$root/current.next" "$current"
  echo "Prepared $target; start rb-unbound.service to activate it."
  exit 0
fi

# Stop the old process first so its final snapshot is included in the backup.
if [[ -n "$previous" ]]; then systemctl --user stop rb-unbound.service; fi
backup="$root/state/pre-update.json"
if [[ -f "$state_path" ]]; then cp -p -- "$state_path" "$backup"; fi
rm -f -- "$root/current.next"
ln -s "releases/$target" "$root/current.next"
mv -Tf -- "$root/current.next" "$current"

healthy=0
if systemctl --user restart rb-unbound.service; then
  for _ in {1..15}; do
    if node -e '
      const expected = process.argv[1];
      fetch("http://127.0.0.1:3001/healthz", { signal: AbortSignal.timeout(1000) })
        .then(response => response.ok ? response.json() : null)
        .then(body => process.exit(body?.status === "ok" && body.commit === expected ? 0 : 1))
        .catch(() => process.exit(1));
    ' "$target"; then
      healthy=1
      break
    fi
    sleep 1
  done
fi

if [[ "$healthy" == 1 ]]; then
  echo "Updated RB Unbound server to $target"
  # Retain the active and immediately previous versions, plus two recent releases.
  kept=0
  while IFS= read -r -d '' item; do
    old_release=${item#* }
    if [[ "$old_release" == "$release" || "$old_release" == "$previous" ]]; then continue; fi
    kept=$((kept + 1))
    if (( kept > 2 )); then
      git -C "$source_dir" worktree remove --force "$old_release" || true
    fi
  done < <(find "$releases_dir" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\0' | sort -zrn)
  exit 0
fi

echo "Release $target did not become healthy; restoring the previous release." >&2
if [[ -n "$previous" ]]; then
  ln -s "$previous" "$root/current.next"
  mv -Tf -- "$root/current.next" "$current"
  systemctl --user stop rb-unbound.service || true
  if [[ -f "$backup" ]]; then cp -p -- "$backup" "$state_path"; fi
  systemctl --user restart rb-unbound.service || true
fi
exit 1
