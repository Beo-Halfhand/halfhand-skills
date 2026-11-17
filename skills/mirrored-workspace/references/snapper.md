# The snapper

`mw snap` captures every pane of every tab (the last `MW_SNAP_LINES`, default 400, with wrapped lines joined), masks it, and writes `snapshots/<tab>-w<window>p<pane>.txt` atomically (a temporary file, then a rename, so a reader never sees half a snapshot). It also writes `snapshots/INDEX.md` and prunes old logs and snapshots. Each snapshot starts with a header line:

```text
# build-w0p0 · captured 2026-01-15 14:02:00 -0500 · masked
```

## macOS: launchd
`install.sh` writes a LaunchAgent named `local.mirrored-workspace.snap` (change with `--label`) in your LaunchAgents folder from [`templates/launchd-snap.xml`](../templates/launchd-snap.xml): `mw snap` every 60 s, at login too, output to `MW_HOME/snapper.out`. It lints it with `plutil -lint` and loads it with `launchctl bootstrap gui/<your uid>`.

- Status: `launchctl print gui/$(id -u)/local.mirrored-workspace.snap | head -20`
- Stop: `bash install.sh --uninstall` (or `launchctl bootout gui/$(id -u)/local.mirrored-workspace.snap`)
- launchd starts jobs with almost no environment, so the agent sets `PATH` to the folders holding tmux and node, and the config file gives `MW_TMUX` as a full path. The self-test runs `mw snap` under `env -i` to check it works that way.

## Linux: systemd
`install.sh` writes two user units in `~/.config/systemd/user/` from [`templates/`](../templates/): `mirrored-workspace-snap.service` (one `mw snap`) and `mirrored-workspace-snap.timer` (every 60 s), then runs `systemctl --user enable --now mirrored-workspace-snap.timer`.

- Status: `systemctl --user list-timers mirrored-workspace-snap.timer`
- Logs: `journalctl --user -u mirrored-workspace-snap.service -n 20`
- Without a login session, user timers stop. On a server, `loginctl enable-linger "$USER"` keeps them running (it may ask for your password; it's your call).

## Anywhere: a tab that loops

```sh
tmux new -d -s snap 'mw snap --loop'
```

Add `MW_SNAP_SKIP="snap"` to the config so it doesn't snapshot itself. It stops if the tmux server stops, so the scheduler options are better on a machine that reboots.

## Settings
| Setting | Default | |
|---|---|---|
| `MW_SNAP_EVERY` | 60 | seconds (install with `--every`) |
| `MW_SNAP_LINES` | 400 | scrollback per snapshot |
| `MW_SNAP_SKIP` | (none) | tab names not to snapshot |
| `MW_LOG_KEEP_DAYS` | 14 | logs and stale snapshots older than this are deleted |
| `MW_TMUX_SOCKET` | (default server) | for a tmux server started with `-L` |

If tmux uses a non-default socket folder (`TMUX_TMPDIR` set in your shell), set the same `TMUX_TMPDIR` in the launchd agent's or systemd unit's environment, or the snapper won't find the server.
