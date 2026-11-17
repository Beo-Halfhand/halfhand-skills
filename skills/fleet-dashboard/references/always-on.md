# Always on

The dashboard is one process: page and sampler together. Run it under your system's service manager so it starts at login and comes back if it stops. `install.mjs` writes the file for you. It prints first, writes with `--write`, and starts with `--start`.

Install from a **copy** (for example `~/fleet-dashboard`), not from inside the skill folder. The service file points at the copy's `deck.mjs`, so updating the skill doesn't change a running dashboard until you copy it over.

## macOS: launchd

```sh
node install.mjs --launchd --config ~/fleet-dashboard/fleet.json --start
```

This writes `local.fleet-dashboard.plist` into `~/Library/LaunchAgents` (lint-checked with `plutil`) and loads it with `launchctl bootstrap gui/<uid>`. It runs as you, at login, with `KeepAlive` (restarts if it stops) and `ThrottleInterval` 30 (no faster than every 30 s if it keeps crashing).

| Task | Command |
|---|---|
| Is it running? | `launchctl list \| grep local.fleet-dashboard` (a number in the first column is its pid) |
| Restart after editing fleet.json | `launchctl kickstart -k gui/$(id -u)/local.fleet-dashboard` |
| Its output | `<dataDir>/service.out`; the dashboard's own log is `<dataDir>/deck.log` |
| Stop and remove | `node install.mjs --launchd --uninstall` prints the two commands |

A second dashboard on the same Mac: `--name fleet-dashboard-2`, and a different `port` in its config.

## Linux: systemd (user service)

```sh
node install.mjs --systemd --config ~/fleet-dashboard/fleet.json --start
loginctl enable-linger        # keep it running when you're not logged in
```

This writes `~/.config/systemd/user/fleet-dashboard.service` with `Restart=always`, `RestartSec=30`, `NoNewPrivileges=yes` and `PrivateTmp=yes`, then runs `systemctl --user enable --now`.

| Task | Command |
|---|---|
| Is it running? | `systemctl --user status fleet-dashboard` |
| Restart after editing fleet.json | `systemctl --user restart fleet-dashboard` |
| Its output | `journalctl --user -u fleet-dashboard -e`, and `<dataDir>/deck.log` |
| Stop and remove | `node install.mjs --systemd --uninstall` |

## No service manager

In a container, WSL or a minimal VM there's no launchd or systemd user manager (`install.mjs --systemd --start` checks and stops). Run it in the background and log to the data folder:

```sh
cd ~/fleet-dashboard
nohup node deck.mjs --config fleet.json >> fleet-data/service.out 2>&1 &   # use your dataDir
echo $! > fleet-data/deck.pid
curl -s http://localhost:7700/api/health                                 # "ok": true
```

| Task | Command |
|---|---|
| Stop | `kill "$(cat fleet-data/deck.pid)"` |
| Start again after a reboot | `crontab -e`, add `@reboot cd $HOME/fleet-dashboard && node deck.mjs --config fleet.json >> fleet-data/service.out 2>&1` (use the full path to node if cron's PATH lacks it) |
| Its output | `fleet-data/service.out` and `<dataDir>/deck.log` |

## Updating

1. Copy the new `scripts/` over your copy (keep your `fleet.json` and `dataDir`).
2. `node selftest.mjs`, then `node deck.mjs --config fleet.json --check`.
3. Restart the service (tables above). History carries over: the file format is versioned (`"v": 1`).

## Splitting page and sampler

If you'd rather run the sampler on a timer (cron, a launchd `StartInterval`, a systemd timer), run the page with `--no-sampler` and the timer with `node deck.mjs --config fleet.json --once`. Never run two samplers on one `dataDir`.

## Phone

The dashboard listens on 127.0.0.1 only and checks the `Host` of every request. To open it from a phone or another computer:

1. Put it on a **private** network you already trust, such as a mesh VPN you sign in to on both devices. Use that network's own "serve a local port to my devices" proxy, pointed at `http://127.0.0.1:7700`. It must be reachable only inside your private network. **Do not use a public tunnel** or a "share to the internet" mode: the page shows your agents' logs and positions.
2. Find the header your proxy adds with the signed-in user's login (its docs name it), and tell the dashboard to accept that host and only your login:
   ```json
   "access": { "hosts": ["<the host name your phone uses>"], "loginHeader": "<that header, lower case>", "allowLogins": ["you@example.com"] }
   ```
3. Restart. Open `https://<that host>/m` on the phone, then Share → Add to Home Screen.

Any other host gets 421. A request through the proxy without an allowed login gets 403 and a line in `deck.log` (the login is not recorded). Only use a proxy that sets the login header itself and overwrites any copy a client sends: otherwise a client could forge it.
