# mirrored-workspace skill

Teaches an AI agent to set up a terminal workspace it can see: one tmux session per job on an always-on machine, each logged to a private folder, plus a masked snapshot of every pane every 60 seconds and an index to read first. Other machines (laptop, phone) attach to the same live tabs with mosh over a private mesh network. Nothing reaches disk without passing the masker, and if the masker can't run, nothing is written.

| File | For |
|---|---|
| `SKILL.md` | The agent: what it is, the steps, the private network, phone access, safety, what to report |
| `scripts/mw` | The command: `new`, `ls`, `snap`, `log`, `pipe-all`, `mask`, `scrub`, `prune`, `doctor` |
| `../safe-logs/scripts/mask-pipe.mjs` | The masker (the safe-logs skill): strips escape codes, masks key-shaped text, writes logs with rotation |
| `scripts/install.sh` | Installs `mw`, the tmux hooks and the snapper (launchd or systemd). `--dry-run`, `--uninstall` |
| `scripts/try.sh` | One-command demo on its own tmux server: two tabs, snapshots updating, a fake id masked |
| `scripts/selftest.sh` | 56 checks: masker, logger, fail-closed, hooks and snapshots, `mw new` with no terminal, doctor, installer (with and without systemd) |
| `templates/tmux.conf` | The logging hooks and window settings |
| `templates/launchd-snap.xml` | The macOS LaunchAgent (install.sh fills it in) |
| `templates/mirrored-workspace-snap.service`, `.timer` | The Linux systemd user units |
| `references/two-machines.md` | The always-on machine and the windows into it |
| `references/private-network.md` | A mesh network (worked example), device approval, key-only SSH, mosh, the phone |
| `references/masking.md` | Every rule, your own terms, what it misses, cleaning old logs |
| `references/keeping-logs-private.md` | Where the logs folder must never be |
| `references/snapper.md` | launchd, systemd, a looping tab, settings |

**Needs:** tmux 3.2+, node 20+, bash, and the [safe-logs](../safe-logs) skill next to this one. mosh and a mesh VPN client for attaching from other machines. macOS or Linux.

**Status:** in development. See the table in the [halfhand-skills README](https://github.com/Beo-Halfhand/halfhand-skills#skills).
