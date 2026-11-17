#!/usr/bin/env bash
# selftest.sh: checks the masker, the logger (rotation, pruning, file modes), fail-closed behaviour,
# the tmux hooks and snapshots on a private tmux server, and the installer in a fake home folder.
#
#   bash selftest.sh        expect: "selftest: N ok, 0 failed"
#
# Never touches your own tmux server, ~/.tmux.conf or scheduler. tmux tests are skipped if tmux is
# missing. Every fake secret is built at run time, so this file holds nothing a scanner should flag.
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
sock="mw-selftest-$$"
cleanup() { tmux -L "$sock" kill-server 2>/dev/null; rm -rf "$tmp"; }
trap cleanup EXIT
export MW_HOME="$tmp/mwhome" XDG_CONFIG_HOME="$tmp/config" MW_TMUX_SOCKET="$sock"
unset MW_MASK_EXTRA MW_MASK_GENERIC MW_LOG_MAX_MB MW_SNAP_SKIP
mw="$here/mw"
ok=0 bad=0 skip=0
pass() { ok=$((ok + 1)); echo "ok    $1"; }
flop() { bad=$((bad + 1)); echo "FAIL  $1"; }
skp() { skip=$((skip + 1)); echo "skip  $1"; }
rep() { local s="" i; for ((i = 0; i < $2; i++)); do s+="$1"; done; printf '%s' "$s"; }
mask() { "$mw" mask; }
fmode() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }

# Fakes, built here (never real)
PID="$(printf 'pre%s' prod)$(rep 'Zq7' 10)Ab"           # network-prefixed project id
GH="$(printf 'gh%s_' p)$(rep 'Zx9' 12)"                 # code host token
HEX="$(rep 'a1b2c3d4' 8)"                                # 64 hex
GEN="$(rep 'Kp4m' 7)"                                    # 28 chars, upper+lower+digit, no known prefix
NM="$(printf 'API_%s' KEY)"                              # a secret-looking variable name
values=("$PID" "$GH" "$HEX" "$GEN" "hunter22x9")
leaks() { local f="$1" v; for v in "${values[@]}"; do grep -qF -- "$v" "$f" && return 0; done; return 1; }

# expect_mask <label> <input> <expected output>
expect_mask() { local got; got="$(printf '%b\n' "$2" | mask)"; [ "$got" = "$3" ] && pass "$1" || { flop "$1"; echo "      want: $3"; echo "      got:  $(printf '%s' "$got" | sed -E 's/[A-Za-z0-9]{12,}/<long>/g')"; }; }

echo "--- masker"
expect_mask "disconnect message: key in a URL" "ws closed: wss://api.example.com/v0?project_id=$PID (retry 3)" "ws closed: wss://api.example.com/v0?project_id=<masked> (retry 3)"
expect_mask "header form: \"project_id\": \"...\"" "{\"project_id\": \"$PID\", \"ok\": false}" "{\"project_id\": \"<masked>\", \"ok\": false}"
expect_mask "bare network-prefixed id in an error" "Error: invalid project token $PID" "Error: invalid project token <masked>"
expect_mask "id split by colour codes" "id=\033[1mpre\033[0mprod$(rep 'Zq7' 10)Ab" "id=<masked>"
expect_mask "carriage-return redraw" "connecting...\rfailed ?key=$PID" "connecting...
failed ?key=<masked>"
expect_mask "bearer header" "Authorization: Bearer $GH" "Authorization: <masked>"
expect_mask "token by prefix alone" "pushed with $GH ok" "pushed with <masked> ok"
expect_mask "NAME=value from an env file" "$NM=$GEN" "$NM=<masked>"
expect_mask "64-hex private key" "key 0x$HEX loaded" "key <masked> loaded"
pw="hunter22x9"; expect_mask "password in a URL" "https://deploy:${pw}@git.example.com/repo" "https://deploy:<masked>@git.example.com/repo"
expect_mask "unknown key-shaped token (catch-all)" "using $GEN for this run" "using <masked> for this run"
got="$(printf 'using %s\n' "$GEN" | MW_MASK_GENERIC=0 "$mw" mask)"; [ "$got" = "using $GEN" ] && pass "MW_MASK_GENERIC=0 turns the catch-all off" || flop "MW_MASK_GENERIC=0"
got="$(printf -- '-----BEGIN OPENSSH %s KEY-----\nAAAAB3Nza\nmore\n-----END OPENSSH %s KEY-----\nafter\n' PRIVATE PRIVATE | mask)"
[ "$(printf '%s' "$got" | grep -c '<masked> (private key)')" = 4 ] && printf '%s' "$got" | tail -1 | grep -qx after && pass "private key block masked line by line, text after it kept" || flop "private key block"
for line in "commit 3f2a9c1e5b7d4f6a8c0e2b4d6f8a0c2e4b6d8f0a done" "pip install requests==2.31.0" "Password: " "GET https://example.com/a/b?page=2&sort=asc 200" "13:05:55 build step 41 done" "~/projects/app/src/index.ts:42:7"; do
  got="$(printf '%s\n' "$line" | mask)"; [ "$got" = "$line" ] || { flop "ordinary line changed: $line"; continue; }
done; pass "ordinary lines unchanged (git sha, package, prompt, plain URL, time, path)"
printf 'my-desk-box\nbuild-\\d+\\.corp\n' >"$tmp/extra"
got="$(printf 'ssh my-desk-box and build-7.corp\n' | MW_MASK_EXTRA="$tmp/extra" "$mw" mask)"; [ "$got" = "ssh <masked> and <masked>" ] && pass "your own terms (MW_MASK_EXTRA)" || flop "MW_MASK_EXTRA: $got"
printf '(unclosed\n' >"$tmp/badextra"
printf 'x\n' | MW_MASK_EXTRA="$tmp/badextra" "$mw" mask >/dev/null 2>&1 && flop "bad regex in MW_MASK_EXTRA accepted" || pass "a bad MW_MASK_EXTRA regex stops the masker"

echo "--- logger"
printf 'one ?token=''%s\n\033[31mtwo\033[0m\n\n' "$PID" | "$mw" log tabA
f="$MW_HOME/logs/tabA-$(date +%Y%m%d).log"
[ -f "$f" ] && pass "log file is logs/<tab>-YYYYMMDD.log" || flop "no log file"
[ "$(cat "$f" 2>/dev/null)" = "one ?token=<masked>
two" ] && pass "log is masked, escape codes and blank lines dropped" || flop "log content"
[ "$(fmode "$f")" = 600 ] && [ "$(fmode "$MW_HOME/logs")" = 700 ] && pass "log 600, folder 700" || flop "modes: file $(fmode "$f"), folder $(fmode "$MW_HOME/logs")"
printf 'x\n' | "$mw" log 'we/ird name' && [ -f "$MW_HOME/logs/we_ird_name-$(date +%Y%m%d).log" ] && pass "odd tab names can't escape the logs folder" || flop "tab name sanitising"
yes "$(rep 'line of build output ' 4)" | head -n 3000 | MW_LOG_MAX_MB=0.05 "$mw" log big
parts="$(ls "$MW_HOME/logs" | grep -c "^big-$(date +%Y%m%d)")"
[ "$parts" -ge 2 ] && pass "rotation: a day past MW_LOG_MAX_MB rolls into $parts parts" || flop "rotation (parts: $parts)"
old="$MW_HOME/logs/old-20200101.log"; : >"$old"; touch -t 202001010000 "$old"
"$mw" prune >/dev/null; [ ! -e "$old" ] && [ -f "$f" ] && pass "prune: old logs deleted, today's kept" || flop "prune"
cp "$f" "$tmp/leaky.log"; printf 'later: GET /v0?project_id=%s\n' "$PID" >>"$tmp/leaky.log"
out="$("$mw" scrub "$tmp/leaky.log")"
! leaks "$tmp/leaky.log" && printf '%s' "$out" | grep -q '1 line(s) masked' && ! printf '%s' "$out" | grep -qF "$PID" && pass "scrub masks an old log in place and prints a count, not the value" || flop "scrub: $out"

echo "--- fail closed"
mkdir -p "$tmp/lonely" && cp "$mw" "$tmp/lonely/mw"
printf 'x ?token=%s\n' "$PID" | MW_HOME="$tmp/lonely-home" "$tmp/lonely/mw" log t1 2>/dev/null
[ -z "$(find "$tmp/lonely-home" -type f 2>/dev/null)" ] && pass "masker missing: logger writes nothing" || flop "masker missing: something was written"

if command -v tmux >/dev/null; then
  echo "--- tmux (private server, no config)"
  t() { tmux -L "$sock" "$@"; }
  t -f /dev/null start-server \; set -g exit-empty off
  sed -e "s|@MW@|$mw|g" "$here/../templates/tmux.conf" >"$tmp/hooks.conf"
  t source-file "$tmp/hooks.conf" && pass "rendered tmux.conf loads" || flop "tmux.conf did not load"
  t new-session -d -s hooked "printf 'hello from hooked ?key=%s\n' '$PID'; sleep 30"
  sleep 1.5
  [ "$(t display -p -t '=hooked:' '#{pane_pipe}')" = 1 ] && pass "hook: a new session is logged" || flop "hook did not pipe"
  t split-window -d -t '=hooked:' "sleep 30"; sleep 0.5
  [ "$(t list-panes -t '=hooked:' -F '#{pane_pipe}' | sort -u | tr -d '\n')" = 1 ] && pass "hook: a split pane is logged too" || flop "split not piped"
  MW_DETACHED=1 MW_NEW_CMD="printf 'chat up ?project_id=%s\n' '$PID'; sleep 30" "$mw" new chat; sleep 1.5
  [ "$(t display -p -t '=chat:' '#{pane_pipe}')" = 1 ] && pass "mw new: tab created with logging on" || flop "mw new"
  "$mw" new 'bad name' >/dev/null 2>&1 && flop "mw new accepted a bad tab name" || pass "mw new refuses a bad tab name"
  "$mw" pipe-all >/dev/null; "$mw" pipe-all >/dev/null
  [ "$(t list-panes -a -F '#{pane_pipe}' | sort -u | tr -d '\n')" = 1 ] && pass "pipe-all twice never toggles logging off" || flop "pipe-all toggled a pipe"
  MW_SNAP_SKIP="chat" "$mw" snap
  s="$MW_HOME/snapshots/hooked-w0p0.txt"
  [ -f "$s" ] && head -1 "$s" | grep -q '^# hooked-w0p0 · captured .* · masked$' && pass "snapshot written with a header line" || flop "snapshot"
  grep -q 'hello from hooked ?key=<masked>' "$s" 2>/dev/null && pass "snapshot is masked" || flop "snapshot not masked"
  [ ! -e "$MW_HOME/snapshots/chat-w0p0.txt" ] && pass "MW_SNAP_SKIP leaves a tab out" || flop "MW_SNAP_SKIP"
  grep -q '| hooked | w0p0 |' "$MW_HOME/snapshots/INDEX.md" && pass "INDEX.md lists the panes" || flop "INDEX.md"
  [ "$(fmode "$s")" = 600 ] && pass "snapshot is 600" || flop "snapshot mode $(fmode "$s")"
  before="$(sed -n 1p "$s")"; sleep 1.1; "$mw" snap; [ "$(sed -n 1p "$s")" != "$before" ] && pass "next round replaces the snapshot" || flop "snapshot not refreshed"
  env -i HOME="$tmp" PATH="/usr/bin:/bin" MW_HOME="$tmp/launchd-home" MW_TMUX="$(command -v tmux)" MW_TMUX_SOCKET="$sock" XDG_CONFIG_HOME="$tmp/none" "$mw" snap
  [ -f "$tmp/launchd-home/snapshots/hooked-w0p0.txt" ] && pass "snap works with a scheduler's bare environment" || flop "snap under env -i"
  MW_HOME="$tmp/lonely-home2" MW_TMUX_SOCKET="$sock" "$tmp/lonely/mw" snap 2>/dev/null
  [ -z "$(find "$tmp/lonely-home2" -type f 2>/dev/null)" ] && pass "masker missing: no snapshot written" || flop "masker missing: snapshot written"
  printf '(bad\n' >"$tmp/bad2"; MW_HOME="$tmp/badre-home" MW_MASK_EXTRA="$tmp/bad2" "$mw" snap 2>/dev/null
  [ -z "$(find "$tmp/badre-home/snapshots" -name '*.txt' 2>/dev/null)" ] && pass "masker fails to start: no snapshot written" || flop "bad masker still wrote snapshots"
  sleep 1
  for f in "$MW_HOME"/logs/*.log "$MW_HOME"/snapshots/* "$tmp"/launchd-home/snapshots/*; do leaks "$f" && { flop "a fake value reached $f"; break; }; done && pass "no fake value anywhere on disk"
  t kill-server
else
  skp "tmux tests (tmux not installed)"
fi

echo "--- doctor"
sync="$tmp/$(printf 'Drop%s' box)/ws"; mkdir -p "$sync" && chmod 700 "$sync"
out="$(MW_HOME="$sync" "$mw" doctor 2>/dev/null)"; printf '%s\n' "$out" | grep -q 'inside a synced folder' && pass "doctor warns when MW_HOME is in a synced folder" || flop "doctor synced-folder warning"
mkdir -p "$tmp/plain-ws" && chmod 700 "$tmp/plain-ws"
out="$(MW_HOME="$tmp/plain-ws" "$mw" doctor 2>/dev/null)"; printf '%s\n' "$out" | grep -q 'not in a known synced folder' && pass "doctor: a plain folder is not flagged" || flop "doctor flagged a plain folder"

echo "--- installer (fake home)"
H="$tmp/home"; mkdir -p "$H"
run_install() { HOME="$H" XDG_CONFIG_HOME="$H/.config" MW_BIN_DIR="$H/bin" MW_HOME= bash "$here/install.sh" "$@"; }
out="$(run_install --dry-run --snapper launchd 2>&1)"
[ -z "$(find "$H" -mindepth 1 2>/dev/null)" ] && pass "--dry-run changes nothing" || flop "--dry-run wrote files"
plist="$(printf '%s\n' "$out" | awk '/^----- would write .*\.plist/{on=1;next} /^-----$/{on=0} on')"
printf '%s\n' "$plist" >"$tmp/snap.plist"
grep -q '@' "$tmp/snap.plist" && flop "plist has unfilled values" || pass "plist fully filled"
if command -v plutil >/dev/null; then plutil -lint "$tmp/snap.plist" >/dev/null && pass "plist lints (plutil)" || flop "plist lint"
elif command -v xmllint >/dev/null; then xmllint --noout "$tmp/snap.plist" && pass "plist is well-formed XML" || flop "plist XML"
else skp "plist lint (no plutil or xmllint)"; fi
out="$(run_install --dry-run --snapper systemd 2>&1)"
for u in service timer; do
  printf '%s\n' "$out" | awk -v u="$u" '$0 ~ "^----- would write .*snap\\." u {on=1;next} /^-----$/{on=0} on' >"$tmp/mw.$u"
  [ -s "$tmp/mw.$u" ] && ! grep -q '@[A-Z_]*@' "$tmp/mw.$u" && pass "systemd $u rendered" || flop "systemd $u"
done
if command -v systemd-analyze >/dev/null; then
  cp "$tmp/mw.service" "$tmp/mirrored-workspace-snap.service"; cp "$tmp/mw.timer" "$tmp/mirrored-workspace-snap.timer"
  systemd-analyze verify --user "$tmp/mirrored-workspace-snap.timer" >/dev/null 2>&1 && pass "systemd-analyze verify" || skp "systemd-analyze verify (needs a user manager)"
fi
run_install --snapper none >/dev/null 2>&1
[ -x "$H/bin/mw" ] && [ -f "$H/bin/safe-logs/mask-pipe.mjs" ] && pass "install: mw and its masker installed together" || flop "install: binaries"
[ "$(grep -c 'mirrored-workspace >>>' "$H/.tmux.conf" 2>/dev/null)" = 1 ] && pass "install: one source-file block in ~/.tmux.conf" || flop "install: tmux.conf block"
[ "$(fmode "$H/mirrored-workspace")" = 700 ] && pass "install: MW_HOME is 700" || flop "install: MW_HOME mode"
run_install --snapper none >/dev/null 2>&1
[ "$(grep -c 'mirrored-workspace >>>' "$H/.tmux.conf")" = 1 ] && pass "install twice: still one block" || flop "install twice duplicated the block"
echo "keep me" >"$H/mirrored-workspace/logs/x.log"
run_install --uninstall --snapper none >/dev/null 2>&1
! grep -q 'mirrored-workspace' "$H/.tmux.conf" && [ ! -e "$H/bin/mw" ] && [ -f "$H/mirrored-workspace/logs/x.log" ] && pass "uninstall: block and binaries gone, logs kept" || flop "uninstall"
grep -rqF "$H" "$here/../templates" && flop "a test path leaked into templates" || true

echo "selftest: $ok ok, $bad failed, $skip skipped"
[ "$bad" -eq 0 ]
