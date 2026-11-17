#!/usr/bin/env bash
# try.sh: one command to see mirrored-workspace work, without touching your own tmux.
#
#   bash try.sh            two demo tabs, three snapshot rounds 5 s apart, then clean up
#   bash try.sh --keep     leave the demo folder for you to look at
#
# It runs its own tmux server (a separate socket) and writes to a temporary folder. One demo tab
# counts; the other prints a reconnect error with a fake key-shaped id in it, the way a real
# disconnect message can, so you can see the id masked in both the snapshot and the log.
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
keep=0; [ "${1:-}" = "--keep" ] && keep=1
command -v tmux >/dev/null || { echo "try.sh: needs tmux (macOS: brew install tmux; Debian/Ubuntu: apt install tmux)"; exit 1; }
command -v node >/dev/null || { echo "try.sh: needs node 20+ (the masker is the safe-logs skill)"; exit 1; }

demo="$(mktemp -d)"
export MW_HOME="$demo" MW_TMUX_SOCKET="mw-try-$$" MW_SNAP_EVERY=5 XDG_CONFIG_HOME="$demo/.config"
mw="$here/mw"
t() { tmux -L "$MW_TMUX_SOCKET" "$@"; }
cleanup() { t kill-server 2>/dev/null; [ "$keep" = 1 ] || rm -rf "$demo"; }
trap cleanup EXIT

# A fake id with the shape of a network-prefixed project id. Built here, never real.
fake="pre""prod$(printf 'Zq7%.0s' 1 2 3 4 5 6 7 8 9 10)Ab"

echo "== 1. Two demo tabs on a private tmux server (your sessions aren't touched)"
t -f /dev/null start-server \; set -g exit-empty off
MW_DETACHED=1 MW_NEW_CMD="i=0; while :; do i=\$((i+1)); echo \"build step \$i done at \$(date +%T)\"; sleep 2; done" "$mw" new demo-build
MW_DETACHED=1 MW_NEW_CMD="while :; do echo \"\$(date +%T) ws closed: wss://api.example.com/v0?project_id=$fake (reconnecting)\"; echo \"\$(date +%T) header project_id: $fake\"; sleep 3; done" "$mw" new demo-chat
"$mw" ls

for round in 1 2 3; do
  sleep 5
  "$mw" snap
  echo
  echo "== 2.$round Snapshot round $round ($(date +%T))"
  echo "-- snapshots/demo-build-w0p0.txt (last 2 lines):"; grep -v "^\s*$" "$demo/snapshots/demo-build-w0p0.txt" | tail -n 2 | sed 's/^/   /'
  echo "-- snapshots/demo-chat-w0p0.txt (last 2 lines):"; grep -v '^\s*$' "$demo/snapshots/demo-chat-w0p0.txt" | tail -n 2 | sed 's/^/   /'
done

echo
echo "== 3. Did the fake id reach disk anywhere?"
hits="$(grep -rF "$fake" "$demo" 2>/dev/null | wc -l | tr -d ' ')"
masked="$(grep -rhoF '<masked>' "$demo/logs" "$demo/snapshots" 2>/dev/null | wc -l | tr -d ' ')"
echo "   copies of the fake id on disk: $hits  (should be 0)"
echo "   <masked> markers written instead: $masked"
echo "   files: $(cd "$demo" && find logs snapshots -type f | sort | tr '\n' ' ')"
echo
echo "== 4. snapshots/INDEX.md (what an AI reads first)"
sed 's/^/   /' "$demo/snapshots/INDEX.md"
[ "$keep" = 1 ] && echo && echo "Demo folder kept: $demo  (tmux server stopped)"
snaps="$(find "$demo/snapshots" -name 'demo-*.txt' | wc -l | tr -d ' ')"
if [ "$hits" = 0 ] && [ "$masked" -gt 0 ] && [ "$snaps" -ge 2 ]; then echo; echo "try: ok (2 tabs, $snaps snapshots, fake id masked everywhere)"; exit 0; fi
echo; echo "try: FAILED (snapshots: $snaps, masked: $masked, raw copies: $hits)"; exit 1
