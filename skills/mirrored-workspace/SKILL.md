---
name: mirrored-workspace
description: Set up a terminal workspace an AI can see. One tmux session per job ("tab") on an always-on machine, each logged to a private folder, plus a masked snapshot of every pane refreshed every 60 seconds by launchd (macOS) or a systemd timer (Linux), with an INDEX the AI reads first. Any other machine (laptop, phone) attaches over a private mesh network with mosh and `tmux new -A -s <tab>`, so it is a window into the same live tabs. Everything passes through a masker before it reaches disk (API keys, tokens, keys in URLs, project ids, private keys, your own terms), and if the masker can't run, nothing is written. Logs rotate by day and size and are pruned. Includes a one-command demo, an installer with a dry run, a doctor check and a scrubber for old logs. Use it when someone wants an assistant to read what their terminals are doing, wants to reach long-running jobs from another machine or a phone, or has had a secret show up in a terminal log.
---

# mirrored-workspace

**What it is.** Long jobs run in tmux sessions on one machine that stays on. Each session ("tab") is one job. Every pane is logged to a folder, and a snapshot of each pane's screen is rewritten every minute. An assistant that can read files reads `snapshots/INDEX.md` and the snapshots to see where every job stands, without screenshots or copy-paste. From a laptop or phone you attach to the same tabs over a private network: one workspace, seen from anywhere, by you and your assistant.

**Why the masker.** A terminal log keeps everything that crosses the screen, including things you never typed. A real case: a client lost its connection and printed its reconnect URL, with the service's project id in the query string, on every retry, more than a hundred times in one day's log. Here nothing reaches disk without passing through the masker, [safe-logs](../safe-logs/SKILL.md)' `mask-pipe.mjs`, and if the masker can't start, nothing is written at all.

```text
always-on machine                               laptop / phone
┌─────────────────────────────────────┐          ┌──────────────────────────────┐
│ tmux: build │ chat │ deploy │ ...   │◀─ mosh ──│ mosh always-on --            │
│   │ pipe-pane      │ capture (60 s) │  private │   tmux new -A -s build       │
│   ▼                ▼                │  network └──────────────────────────────┘
│ safe-logs (masks keys, or nothing   │
│   is written)                       │          assistant (any machine with the folder)
│   ▼                ▼                │          reads snapshots/INDEX.md first,
│ logs/<tab>-YYYYMMDD.log             │─────────▶ then snapshots/<tab>-w0p0.txt
│ snapshots/<tab>-w0p0.txt, INDEX.md  │
└─────────────────────────────────────┘
```

## When to use
- Someone runs several long jobs (agents, builds, servers) and wants an assistant to see their state.
- Someone wants to reach those jobs from a laptop or phone, and have them survive Wi-Fi drops and a closed lid.
- A secret showed up in a terminal log or a screenshot, and they want it to be impossible next time (step 6 cleans the old logs).

## Steps

### 1. Try it (one command, touches nothing of yours)

```sh
bash <this skill>/scripts/try.sh
```

It starts its own tmux server on a separate socket, writes to a temporary folder, makes two demo tabs (one counting, one printing a reconnect error with a fake key-shaped id), takes three rounds of snapshots 5 seconds apart, shows them changing, and checks the fake id reached disk 0 times. `--keep` leaves the folder to look at.

### 2. Check the setup on the always-on machine

```sh
tmux -V            # 3.2 or newer
node --version     # 20 or newer (the masker)
```

macOS: `brew install tmux mosh`. Debian/Ubuntu: `sudo apt install tmux mosh`. Keep the machine from sleeping (macOS: System Settings → Energy, "prevent automatic sleeping"; Linux servers usually don't sleep).

### 3. Install (dry run first)

```sh
bash <this skill>/scripts/install.sh --dry-run    # shows every file and command; changes nothing
bash <this skill>/scripts/install.sh
```

It copies `mw` and `safe-logs/` (the masker) to `~/.local/bin`, writes `~/.config/mirrored-workspace/config`, makes `~/mirrored-workspace/` (mode 700), adds one `source-file` line to `~/.tmux.conf` (hooks that log every new session, window and split), and installs the snapper: a launchd agent on macOS or a systemd user timer on Linux, running `mw snap` every 60 s. Options: `--home DIR`, `--every SECONDS`, `--snapper launchd|systemd|loop|none`, `--uninstall`. Details: [references/snapper.md](references/snapper.md).

It doesn't touch sessions that are already running. To log them too: `mw pipe-all` (it only turns logging **on**; it never toggles a pipe off).

### 4. Make tabs

```sh
mw new build       # attach if "build" exists, else create it with logging on
mw ls              # tabs, panes, logging on/off, snapshot age
mw doctor          # tools, folder safety, panes not logging, snapshot freshness, masker test
```

Name each tab after the one job it owns (`build`, `chat`, `deploy`), and keep a short map of tab → job where your assistant reads it (a `TABS` note in your notes; the agent-memory-vault skill in this repo has a place for it). Tab names are letters, digits, `_` and `-`.

### 5. Attach from another machine
See [references/two-machines.md](references/two-machines.md). The whole idea:

```sh
mosh always-on -- tmux new -A -s build     # attach to "build", or create it
```

`always-on` is an SSH alias for the always-on machine's private network name (next section). `new -A` attaches if the tab exists and creates it if not, so the same command works every time. Both machines see the same tabs live; `set -g window-size latest` (in the installed tmux config) fits the window to whichever screen you used last. Detach with `Ctrl-b d`; the job keeps running.

### 6. Clean up logs that may already hold secrets

```sh
mw scrub ~/old-terminal-logs      # masks .log, .txt and .md files in place; prints counts, never values
```

Then rotate any key that was ever in a log. Masking the file doesn't un-leak a key that was synced, backed up or shared.

## The private network (reach it from anywhere, no ports open)

Put the always-on machine and every client (laptop, phone) on one private mesh network. Each device gets a private address and a **name**; you connect by name, and nothing listens on the public internet: no router port forwarding, no public IP.

Step by step, with a worked example (Tailscale), device approval, key-only SSH, access rules and the phone: [references/private-network.md](references/private-network.md). WireGuard on its own, Headscale, ZeroTier and Nebula work the same way: private addresses plus a name you connect to. The machine's network name is a setup detail: keep your real one out of anything public, and use a placeholder in examples.

Then one SSH alias on each client (`~/.ssh/config`):

```text
Host always-on
  HostName <always-on's name on your private network>
  User you
  IdentityFile ~/.ssh/id_ed25519
```

## Phone access
- **Reading:** if the logs or your notes sync to a folder you own, read them in the sync provider's phone app or a markdown app. Read-only is enough to check a job.
- **Attaching (optional):** an SSH client on the phone (one that speaks mosh is best), joined to the same private network, with its **own** key. Then `mosh always-on -- tmux new -A -s build`.

| Exposed | Not exposed |
|---|---|
| SSH (port 22) and mosh (UDP 60000–61000) on the always-on machine, **only to devices you approved on your private network** | Nothing on the public internet: no open ports, no port forwarding, no public IP needed |
| Device names and keys, to the mesh network's coordination service (traffic itself is encrypted end to end) | The tabs themselves: reachable only after SSH key login over the private network |
| Whatever you put in a synced folder, to that sync provider | Logs and snapshots, unless you choose to sync them. Nothing serves them |
| | Passwords: SSH is key-only, so there is no password to guess |

## Safety built in
- **Mask before disk.** The masker (the [safe-logs](../safe-logs/SKILL.md) skill, one rule list shared with your other tools) strips terminal escape codes first (a key split by colour codes is still a key), then masks: keys inside URLs (`?project_id=`, `?token=`, `?key=` ...), `name: value` and `"name": "value"` pairs for secret-sounding names, `NAME=value` env lines, bearer and basic auth headers, known key prefixes (cloud, code host, chat, payment, AI providers), network-prefixed project ids, JSON web tokens, 64-hex keys, private key blocks, seed phrases, home folder names, `user:password@` in URLs, **your own terms** (`MW_MASK_EXTRA`: hostnames, ids, one regex per line), and a catch-all for any 24+ character token mixing upper case, lower case and digits. [references/masking.md](references/masking.md) points to the full list and what it misses.
- **Fail closed.** Logs and snapshots are written only by the masker. Masker missing, a bad regex in your terms file, or node not installed: no log line and no snapshot is written (the self-test checks all three).
- **Private by default.** `MW_HOME` is mode 700; logs and snapshots are 600.
- **Rotation.** One log per tab per day (`<tab>-YYYYMMDD.log`); past `MW_LOG_MAX_MB` (20) a day rolls to `.2.log`, `.3.log`; every snapshot run deletes logs and stale snapshots older than `MW_LOG_KEEP_DAYS` (14).
- **Keep the folder out of public places.** [references/keeping-logs-private.md](references/keeping-logs-private.md). Never in a git repo that gets pushed, never in a shared or team folder, never behind an "anyone with the link" share. A log folder holds everything that crossed your terminal: commands, paths, machine names, and whatever slipped past the masker. `mw doctor` warns if `MW_HOME` sits in a synced folder or a git repo that doesn't ignore it.

## For the assistant reading the tabs
- Start at `snapshots/INDEX.md`: every pane, what it's running, whether it's logging, when it was captured.
- Read a tab's snapshot before saying a job is ready or done. The header line says when it was captured; older than 3 minutes means the snapper has stopped.
- Text on an AI coding tool's input line may be the tool's own suggestion (ghost text), not something the person typed.
- `<masked>` means the masker replaced something. Never ask for the value; ask which key, and where it's stored.

## Check it
`bash scripts/selftest.sh` runs 51 checks: 15 on the masker, 7 on the logger (rotation, pruning, modes, scrub), fail-closed cases, hooks and snapshots on a private tmux server (including a scheduler's bare environment), the doctor's synced-folder warning, and the installer in a fake home folder (dry run, idempotent, uninstall, plist and systemd units). It never touches your own tmux server, `~/.tmux.conf` or scheduler.

## Report back
Tell the person: where `MW_HOME` is, which snapper was installed (`mw doctor` output), the tabs and whether each is logging (`mw ls`), and the SSH alias line for their other machines. Never paste a log or snapshot line that contains `<masked>` context they didn't ask for.

## Safety rules for the agent running this skill
- Run `install.sh --dry-run` and show it before installing. Installing adds a scheduler job and changes `~/.tmux.conf`; get the person's OK.
- Never kill, rename or attach to the person's existing tmux sessions to test. `try.sh` and `selftest.sh` use their own tmux server.
- Never write a real hostname, private network name, IP address or key into an example, test or screenshot. Use `always-on` and the placeholders in references/private-network.md.
- Never move `MW_HOME` into a shared folder or a repo, and never make a share link to it.
