# Private server automatic updates

The multiplayer server already exists. These scripts prepare a **private Linux test server** to follow the repository's `main` branch without manual pulls or restarts. They do not expose the server to the internet or configure a public URL.

Every 15 minutes the user timer runs `deploy/update.sh`. It fetches the newest `main` commit, checks out an isolated release, runs `npm ci`, type checks, tests and the production build, then stops the old process and switches an atomic `current` symlink. The new process must answer `/healthz` with the expected commit. If it does not, the updater restores the previous release and its pre-update match snapshot. A failed build never switches the active release.

## One-time setup on the future host

Use a dedicated **unprivileged** Linux account with Node.js 22, npm, Git, `flock` (util-linux), and a systemd user manager. Run these commands while logged in as that account:

```bash
git clone https://github.com/Colddestal/RB-Unbound.git "$HOME/rb-unbound/source"
RB_UNBOUND_SKIP_RESTART=1 "$HOME/rb-unbound/source/deploy/update.sh"
mkdir -p "$HOME/.config/systemd/user"
cp "$HOME/rb-unbound/current/deploy/systemd/rb-unbound.service" \
  "$HOME/rb-unbound/current/deploy/systemd/rb-unbound-update.service" \
  "$HOME/rb-unbound/current/deploy/systemd/rb-unbound-update.timer" \
  "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now rb-unbound.service rb-unbound-update.timer
```

If the server must stay online after this user logs out, an administrator runs `sudo loginctl enable-linger <server-user>` once. Keep the machine's clock and outbound GitHub access working. The service binds to `127.0.0.1:3001`; add an HTTPS reverse proxy and configurable site/server URLs before inviting remote players.

## Check status

```bash
systemctl --user status rb-unbound.service rb-unbound-update.timer
systemctl --user start rb-unbound-update.service
journalctl --user -u rb-unbound-update.service -n 80 --no-pager
curl -fsS http://127.0.0.1:3001/healthz
```

The active revision is `readlink -f "$HOME/rb-unbound/current"`. Match snapshots stay at `$HOME/rb-unbound/state/server-state.json`, outside the versioned releases. A copy from immediately before the latest update is at `$HOME/rb-unbound/state/pre-update.json` when a snapshot existed. The updater retains the current and previous releases plus two other recent versions.

The update timer deploys merged `main` commits automatically. Use protected branch checks and review before merging changes. A later incompatible state schema needs a migration and backup plan before it reaches `main`.
