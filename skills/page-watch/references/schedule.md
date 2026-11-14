# Scheduling it

Run `--auto` twice a day, some hours apart. A full run happens when the last one is 20 or more hours old (or ¾ of `staleAfterHours`, if that's less: for an hourly schedule set `staleAfterHours` to about 2); otherwise it's only the self-check.

If you installed the browser with `PLAYWRIGHT_BROWSERS_PATH`, set the same variable in the scheduler's entry (an `EnvironmentVariables` dict in launchd, `Environment=` in systemd, a `VAR=... node ...` prefix in cron). That gives one daily report, a retry if the first run failed or the machine was asleep, and a "has not run since" warning in `latest.md` if the scheduler stops.

Replace `/path/to/page-watch` with the folder you installed into, and the times with yours. Use the absolute path to `node` (`command -v node`): schedulers don't load your shell's `PATH`.

## cron (Linux, macOS)

```cron
40 5  * * *  cd /path/to/page-watch && /usr/local/bin/node watch.mjs --auto >> .page-watch-state/cron.log 2>&1
40 12 * * *  cd /path/to/page-watch && /usr/local/bin/node watch.mjs --auto >> .page-watch-state/cron.log 2>&1
```

cron uses the machine's time zone. On macOS, cron needs Full Disk Access to write into some folders; launchd doesn't.

## launchd (macOS)

Save it as `com.example.page-watch.plist` (use your own reverse-domain label) in the `~/Library/LaunchAgents` folder, then load it: `cd ~/Library/LaunchAgents && launchctl bootstrap gui/$(id -u) com.example.page-watch.plist`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.example.page-watch</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/node</string><string>watch.mjs</string><string>--auto</string>
  </array>
  <key>WorkingDirectory</key><string>/path/to/page-watch</string>
  <key>StartCalendarInterval</key><array>
    <dict><key>Hour</key><integer>5</integer><key>Minute</key><integer>40</integer></dict>
    <dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>40</integer></dict>
  </array>
  <key>StandardOutPath</key><string>/path/to/page-watch/.page-watch-state/launchd.log</string>
  <key>StandardErrorPath</key><string>/path/to/page-watch/.page-watch-state/launchd.log</string>
</dict></plist>
```

A Mac that is asleep at the time runs a missed `StartCalendarInterval` job when it wakes. Check it's loaded: `launchctl list | grep page-watch`. Remove: `launchctl bootout gui/$(id -u)/com.example.page-watch`.

## systemd (Linux)

`~/.config/systemd/user/page-watch.service`:

```ini
[Unit]
Description=page-watch

[Service]
Type=oneshot
WorkingDirectory=/path/to/page-watch
ExecStart=/usr/bin/node watch.mjs --auto
SuccessExitStatus=1
```

`~/.config/systemd/user/page-watch.timer`:

```ini
[Unit]
Description=page-watch twice a day

[Timer]
OnCalendar=*-*-* 05:40:00
OnCalendar=*-*-* 12:40:00
Persistent=true

[Install]
WantedBy=timers.target
```

`systemctl --user enable --now page-watch.timer`. `SuccessExitStatus=1` keeps "problems found" from marking the unit failed; drop it if you want systemd to flag those. On a server, `loginctl enable-linger $USER` keeps user timers running when you're logged out.

## GitHub Actions

Runs in the cloud, so it works when your machine is off. This workflow is a starting point: it was not run as part of this skill's tests (cron, launchd and the commands above were checked by hand or by the self-test's `--auto` and `--self-check` cases). The report goes to the job's artifacts; commit it back or send it on if you want to read it elsewhere. A runner starts clean every time, so keep `since.json` with `actions/cache` or the "since" times reset each run.

```yaml
name: page-watch
on:
  schedule: [{ cron: '40 5 * * *' }]
  workflow_dispatch:
jobs:
  watch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: actions/cache@v4
        with: { path: page-watch/.page-watch-state, key: page-watch-${{ github.run_id }}, restore-keys: page-watch- }
      - run: npm ci || npm install
        working-directory: page-watch
      - run: npx playwright-core install --with-deps chromium-headless-shell
        working-directory: page-watch
      - run: node watch.mjs --now
        working-directory: page-watch
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: page-watch-report, path: page-watch/page-watch-report }
```

Use `--now` here, not `--auto`: the runner has no earlier report to compare with. The job fails (red) when there are problems, which is the alert.
