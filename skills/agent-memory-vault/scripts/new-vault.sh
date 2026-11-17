#!/usr/bin/env bash
# new-vault.sh: make an empty agent memory vault from the template.
#
#   bash new-vault.sh <folder> [--agent NAME] [--machine NAME] [--git]
#
#   <folder>    where the vault goes. Must not exist, or be empty.
#   --agent     the core writer's name (default: assistant)
#   --machine   a short name for this machine (default: main). Pick one that says
#               nothing about where it is or who owns it: laptop, desktop, server.
#   --git       also run `git init` in the vault (local history; never push it anywhere public)
#
# Prints the "paste this into your assistant" block, filled in, at the end.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
template="$here/../template"
agent="assistant" machine="main" use_git=0 dest=""

while [ $# -gt 0 ]; do
  case "$1" in
    --agent) agent="${2:?--agent needs a name}"; shift 2 ;;
    --machine) machine="${2:?--machine needs a name}"; shift 2 ;;
    --git) use_git=1; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    -*) echo "new-vault: unknown option $1" >&2; exit 2 ;;
    *) [ -z "$dest" ] || { echo "new-vault: one folder only" >&2; exit 2; }; dest="$1"; shift ;;
  esac
done
[ -n "$dest" ] || { sed -n '2,13p' "$0" >&2; exit 2; }

name_ok() { printf '%s' "$1" | grep -Eq '^[a-z0-9][a-z0-9-]{0,31}$'; }
name_ok "$agent" || { echo "new-vault: --agent must be lowercase letters, digits and hyphens (got '$agent')" >&2; exit 2; }
name_ok "$machine" || { echo "new-vault: --machine must be lowercase letters, digits and hyphens (got '$machine')" >&2; exit 2; }

if [ -e "$dest" ] && [ -n "$(ls -A "$dest" 2>/dev/null)" ]; then
  echo "new-vault: $dest is not empty. Refusing to write into it." >&2; exit 1
fi
[ -d "$template" ] || { echo "new-vault: template folder not found next to this script" >&2; exit 1; }

mkdir -p "$dest"
cp -R "$template"/. "$dest"/
today="$(date +%Y-%m-%d)"

# Fill the placeholders in every note.
find "$dest" -type f -name '*.md' | while IFS= read -r f; do
  sed -e "s/{{AGENT}}/$agent/g" -e "s/{{MACHINE}}/$machine/g" -e "s/{{DATE}}/$today/g" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done

# Today's day log for this machine.
mkdir -p "$dest/logs/$machine"
cat > "$dest/logs/$machine/$today.md" <<EOF
# $today · $machine
#log

- Vault created from the agent-memory-vault template. — $agent ($machine) | $today
EOF

if [ "$use_git" = 1 ]; then
  git -C "$dest" init -q && echo "git: initialised (local only; no remote added)"
fi

abs="$(cd "$dest" && pwd)"
cat <<EOF
Vault ready: $abs
  core writer: $agent    this machine: $machine

Next:
  1. Paste the block below into your assistant's instructions.
  2. Fill in CORE.md (or ask your assistant to interview you for it).
  3. Check it any time:  perl $here/vault-check.pl "$abs"

----- paste into your assistant's instructions -----
EOF
# The block from PASTE-INTO-YOUR-ASSISTANT.md, filled in.
awk '/^```text$/{on=1;next} /^```$/{on=0} on' "$template/PASTE-INTO-YOUR-ASSISTANT.md" |
  sed -e "s|<VAULT PATH>|$abs|g" -e "s|<AGENT NAME>|$agent|g" -e "s|<MACHINE NAME>|$machine|g"
echo "----------------------------------------------------"
