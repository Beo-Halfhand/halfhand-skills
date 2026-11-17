#!/usr/bin/env bash
# install.sh: set up mirrored-workspace on the always-on machine.
#
#   bash install.sh --dry-run          show every file and command, change nothing (start here)
#   bash install.sh                    install
#   bash install.sh --uninstall        remove what install.sh added (logs and snapshots are kept)
#
# Options:
#   --home DIR            where logs/ and snapshots/ go (default ~/mirrored-workspace)
#   --snapper KIND        launchd (macOS default), systemd (Linux default), loop (a tmux tab runs it), none
#   --every SECONDS       snapshot interval (default 60)
#   --label LABEL         launchd label (default local.mirrored-workspace.snap)
#   --no-tmux-conf        don't add the logging hooks to ~/.tmux.conf
#
# What it does:
#   1. copies mw and its masker (the safe-logs skill, as safe-logs/) to ~/.local/bin (MW_BIN_DIR to change)
#   2. writes ~/.config/mirrored-workspace/config and makes MW_HOME with mode 700
#   3. writes ~/.config/mirrored-workspace/tmux.conf (logging hooks) and one source-file line in ~/.tmux.conf
#   4. installs the snapper: a launchd agent or a systemd user timer that runs "mw snap" every 60 s
# It never touches existing tmux sessions; run "mw pipe-all" yourself to start logging panes that already exist.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
tpl="$here/../templates"
dry=0 uninstall=0 tmuxconf=1 every=60 label="local.mirrored-workspace.snap" snapper="" home=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1; shift ;;
    --uninstall) uninstall=1; shift ;;
    --home) home="${2:?}"; shift 2 ;;
    --snapper) snapper="${2:?}"; shift 2 ;;
    --every) every="${2:?}"; shift 2 ;;
    --label) label="${2:?}"; shift 2 ;;
    --no-tmux-conf) tmuxconf=0; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "install.sh: unknown option $1" >&2; exit 2 ;;
  esac
done

os="$(uname -s)"
[ -n "$snapper" ] || { [ "$os" = Darwin ] && snapper=launchd || snapper=systemd; }
case "$snapper" in launchd|systemd|loop|none) ;; *) echo "install.sh: --snapper is launchd, systemd, loop or none" >&2; exit 2 ;; esac
printf '%s' "$every" | grep -Eq '^[0-9]+$' && [ "$every" -ge 10 ] || { echo "install.sh: --every is a whole number of seconds, 10 or more" >&2; exit 2; }

bin_dir="${MW_BIN_DIR:-$HOME/.local/bin}"
cfg_dir="${XDG_CONFIG_HOME:-$HOME/.config}/mirrored-workspace"
mw_home="${home:-${MW_HOME:-$HOME/mirrored-workspace}}"
mw="$bin_dir/mw"
la_dir="$HOME/Library/LaunchAgents"
plist="$la_dir/$label.plist"
sd_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mark_begin="# >>> mirrored-workspace >>>" mark_end="# <<< mirrored-workspace <<<"

case "$mw$mw_home" in *" "*) echo "install.sh: paths with spaces aren't supported (tmux hooks run them through sh)" >&2; exit 2 ;; esac

run() { if [ "$dry" = 1 ]; then echo "would run: $*"; else "$@"; fi; }
put() { # put <file> <mode>; content on stdin
  local f="$1" m="$2" content; content="$(cat)"
  if [ "$dry" = 1 ]; then printf '\n----- would write %s (mode %s) -----\n%s\n-----\n' "$f" "$m" "$content"; return; fi
  mkdir -p "$(dirname "$f")"; printf '%s\n' "$content" >"$f.tmp" && chmod "$m" "$f.tmp" && mv -f "$f.tmp" "$f"; echo "wrote $f"
}
fill() { sed -e "s|@MW@|$mw|g" -e "s|@MW_HOME@|$mw_home|g" -e "s|@EVERY@|$every|g" -e "s|@LABEL@|$label|g" -e "s|@PATH@|$path_for_jobs|g" "$1"; }

tmux_bin="$(command -v tmux || true)"; node_bin="$(command -v node || true)"
path_for_jobs="$( { [ -n "$tmux_bin" ] && dirname "$tmux_bin"; [ -n "$node_bin" ] && dirname "$node_bin"; echo /usr/local/bin; echo /usr/bin; echo /bin; } | awk '!seen[$0]++' | paste -sd: -)"

# ------------------------------------------------------------------------------------------------
if [ "$uninstall" = 1 ]; then
  if [ "$snapper" = launchd ] && [ -f "$plist" ]; then run launchctl bootout "gui/$(id -u)/$label" || true; run rm -f "$plist"; fi
  if [ "$snapper" = systemd ] && [ -f "$sd_dir/mirrored-workspace-snap.timer" ]; then
    run systemctl --user disable --now mirrored-workspace-snap.timer || true
    run rm -f "$sd_dir/mirrored-workspace-snap.timer" "$sd_dir/mirrored-workspace-snap.service"
  fi
  if [ -f "$HOME/.tmux.conf" ] && grep -qF "$mark_begin" "$HOME/.tmux.conf"; then
    if [ "$dry" = 1 ]; then echo "would remove the mirrored-workspace block from ~/.tmux.conf"
    else awk -v b="$mark_begin" -v e="$mark_end" '$0==b{skip=1;next} $0==e{skip=0;next} !skip' "$HOME/.tmux.conf" >"$HOME/.tmux.conf.tmp" && mv "$HOME/.tmux.conf.tmp" "$HOME/.tmux.conf"; echo "removed the block from ~/.tmux.conf"; fi
  fi
  run rm -f "$cfg_dir/tmux.conf" "$mw" "$bin_dir/mw-mask.pl"; run rm -rf "$bin_dir/safe-logs"
  echo "Uninstalled. Kept: $cfg_dir/config and $mw_home (your logs and snapshots). Running tmux servers keep their hooks until restarted."
  exit 0
fi

# ------------------------------------------------------------------------------------------------
[ -n "$tmux_bin" ] || { echo "install.sh: tmux not found. Install it first (macOS: brew install tmux; Debian/Ubuntu: apt install tmux)" >&2; exit 1; }
[ -n "$node_bin" ] || { echo "install.sh: node not found; the masker (safe-logs) needs it, and nothing is logged without the masker" >&2; exit 1; }
sl="$here/../../safe-logs/scripts"
[ -f "$sl/mask-pipe.mjs" ] || { echo "install.sh: the safe-logs skill is not next to this one (skills/safe-logs); nothing is logged without it" >&2; exit 1; }
[ "$dry" = 1 ] && echo "DRY RUN: nothing will change."

# 1. the command
if [ "$dry" = 1 ]; then echo "would copy mw and safe-logs (the masker) to $bin_dir (mode 755)"
else
  mkdir -p "$bin_dir"
  mkdir -p "$bin_dir/safe-logs"
  for f in mask-pipe.mjs redact.mjs options.mjs; do cp "$sl/$f" "$bin_dir/safe-logs/$f.tmp" && chmod 644 "$bin_dir/safe-logs/$f.tmp" && mv -f "$bin_dir/safe-logs/$f.tmp" "$bin_dir/safe-logs/$f"; done
  cp "$here/mw" "$bin_dir/mw.tmp" && chmod 755 "$bin_dir/mw.tmp" && mv -f "$bin_dir/mw.tmp" "$bin_dir/mw"
  rm -f "$bin_dir/mw-mask.pl"
  echo "installed $mw (and safe-logs/ next to it)"
fi

# 2. config and the private folder
if [ -f "$cfg_dir/config" ]; then echo "kept existing $cfg_dir/config"
else put "$cfg_dir/config" 600 <<EOF
# mirrored-workspace settings. Environment variables override these.
: "\${MW_HOME:=$mw_home}"
: "\${MW_TMUX:=$tmux_bin}"
: "\${MW_SNAP_EVERY:=$every}"
: "\${MW_LOG_KEEP_DAYS:=14}"
: "\${MW_LOG_MAX_MB:=20}"
# : "\${MW_MASK_EXTRA:=$cfg_dir/mask-extra}"   # your own hostnames or ids to mask, one regex per line
EOF
fi
run mkdir -p "$mw_home/logs" "$mw_home/snapshots"
run chmod 700 "$mw_home" "$mw_home/logs" "$mw_home/snapshots"

# 3. tmux hooks
if [ "$tmuxconf" = 1 ]; then
  fill "$tpl/tmux.conf" | put "$cfg_dir/tmux.conf" 644
  if [ -f "$HOME/.tmux.conf" ] && grep -qF "$mark_begin" "$HOME/.tmux.conf"; then echo "~/.tmux.conf already sources it"
  elif [ "$dry" = 1 ]; then echo "would add to ~/.tmux.conf:"; printf '  %s\n' "$mark_begin" "source-file $cfg_dir/tmux.conf" "$mark_end"
  else printf '\n%s\nsource-file %s\n%s\n' "$mark_begin" "$cfg_dir/tmux.conf" "$mark_end" >>"$HOME/.tmux.conf"; echo "added a source-file line to ~/.tmux.conf"; fi
fi

# 4. the snapper
case "$snapper" in
  launchd)
    fill "$tpl/launchd-snap.xml" | put "$plist" 644
    if [ "$dry" = 0 ]; then plutil -lint "$plist" >/dev/null || { echo "install.sh: the generated plist doesn't lint" >&2; exit 1; }; fi
    run launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    run launchctl bootstrap "gui/$(id -u)" "$plist"
    ;;
  systemd)
    fill "$tpl/mirrored-workspace-snap.service" | put "$sd_dir/mirrored-workspace-snap.service" 644
    fill "$tpl/mirrored-workspace-snap.timer" | put "$sd_dir/mirrored-workspace-snap.timer" 644
    run systemctl --user daemon-reload
    run systemctl --user enable --now mirrored-workspace-snap.timer
    echo "note: to keep snapshots running while you're logged out: loginctl enable-linger \"\$USER\" (needs your OK; may ask for a password)"
    ;;
  loop) echo "snapper: start it in its own tab and leave it running:  tmux new -d -s snap '$mw snap --loop'  (and add MW_SNAP_SKIP=snap to the config)" ;;
  none) echo "snapper: none installed. Run '$mw snap' from your own scheduler." ;;
esac

cat <<EOF

Done$([ "$dry" = 1 ] && echo " (dry run)").
  New tab:            mw new <tab>          (attach if it exists, else create with logging on)
  Existing panes:     mw pipe-all           (turn logging on for panes started before this)
  Check:              mw doctor
  Logs:               $mw_home/logs/<tab>-YYYYMMDD.log
  Snapshots:          $mw_home/snapshots/<tab>-w0p0.txt  (index: snapshots/INDEX.md)
Make sure $bin_dir is on your PATH.
EOF
