# Two machines, one workspace

One machine stays on and runs every job. Every other machine is a window into it.

| | Always-on machine | Laptop, phone, any other machine |
|---|---|---|
| Runs | tmux, every tab, the snapper | nothing but a terminal |
| Has | `mw`, the masker, `~/mirrored-workspace/` | an SSH key and the SSH alias |
| Command | `mw new <tab>` | `mosh always-on -- tmux new -A -s <tab>` |

## Why this shape
- Jobs don't stop when the laptop sleeps, changes Wi-Fi or runs out of battery.
- Both machines see the **same** tabs live. Start something at the desk, check it from the couch, finish it on the phone.
- An assistant reads one folder for every job, whichever machine you're on.

## Attach or create: `tmux new -A -s <tab>`
`-A` makes `new-session` attach if the session exists and create it if it doesn't, so one command works every time. If you created it here, the installed hooks start its log (they fire on every new session, window and split). To create through `mw` instead:

```sh
mosh always-on -- ~/.local/bin/mw new build
```

Two clients can attach to the same tab at once. With `set -g window-size latest` the window fits whichever client you typed in last.

## Keep a tab map
Tab name = what the job owns. Keep a short table where your assistant reads it:

| Tab | Owns |
|---|---|
| build | the app's build and test runs |
| chat | the assistant session working on the app |
| deploy | releases; never closed mid-deploy |
| snap | (only with `--snapper loop`) runs `mw snap --loop`; never close it |

Rules that save trouble:
- Check names with `tmux ls` before `new -A`, or a typo creates a second tab.
- One job per tab. A second job gets a new tab and a new row.
- Close tabs whose job is done; the logs stay.

## After a reboot
tmux sessions don't survive a reboot. The snapper does (launchd and systemd start it again). Recreate your tabs with `mw new <tab>` from the map. If a tab needs to come back on its own, start it from your own launchd agent or systemd service that runs `mw new <tab>` with `MW_DETACHED=1` and `MW_NEW_CMD="<the job's command>"`.

## Detach, don't exit
`Ctrl-b d` detaches and leaves the job running. `exit` in the last pane ends the tab.
