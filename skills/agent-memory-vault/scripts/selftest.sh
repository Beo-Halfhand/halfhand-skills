#!/usr/bin/env bash
# selftest.sh: make a vault in a temporary folder, check it is clean, then plant one
# problem at a time and check vault-check.pl catches each one without printing the value.
#
#   bash selftest.sh        expect: "selftest: N ok, 0 failed"
#
# Every fake secret is built here at run time from repeated filler, so this file
# itself holds nothing a secret scanner should flag.
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
ok=0 bad=0
pass() { ok=$((ok + 1)); echo "ok    $1"; }
flop() { bad=$((bad + 1)); echo "FAIL  $1"; }
rep() { local s="" i; for ((i = 0; i < $2; i++)); do s+="$1"; done; printf '%s' "$s"; }

# Fakes (never real, never written to this file literally)
FAKE_PID="$(printf 'pre%s' 'prod')$(rep 'Ab3d' 8)"                 # network-prefixed project id shape
FAKE_GH="$(printf 'gh%s_' 'p')$(rep 'Zx9' 12)"                   # personal-access-token shape
FAKE_HEX="$(rep 'a1b2c3d4' 8)"                                     # 64 hex chars
FAKE_WORDS="$(rep 'apple ' 11)apple"                               # 12 lowercase words
FAKE_VAL="$(rep 'Qw7e' 6)"                                         # 24-char mixed value

new() { rm -rf "$tmp/v"; bash "$here/new-vault.sh" "$tmp/v" --agent helper --machine laptop >"$tmp/new.out" 2>&1; }
check() { perl "$here/vault-check.pl" "$tmp/v" >"$tmp/check.out" 2>&1; }
leaked() { grep -qF -e "$FAKE_PID" -e "$FAKE_GH" -e "$FAKE_HEX" -e "$FAKE_VAL" "$tmp/check.out"; }

# expect_fail <label> <rule text expected in output>
expect_fail() {
  if check; then flop "$1 (vault-check passed)"
  elif ! grep -qF "$2" "$tmp/check.out"; then flop "$1 (no '$2' in output)"; sed 's/^/      /' "$tmp/check.out"
  elif leaked; then flop "$1 (output printed the value)"
  else pass "$1"; fi
}

# 1. setup works and the fresh vault is clean
if new; then pass "new-vault.sh makes a vault"; else flop "new-vault.sh failed"; cat "$tmp/new.out"; fi
for f in ROUTER.md RULES.md CORE.md INBOX.md DECISIONS.md LESSONS.md KEY-INDEX.md HOME.md PASTE-INTO-YOUR-ASSISTANT.md \
         topics/README.md logs/README.md agents/README.md reports/README.md files/README.md files/_unsorted/.gitkeep .gitignore; do
  [ -e "$tmp/v/$f" ] || flop "missing $f"
done
[ -f "$tmp/v/logs/laptop/$(date +%Y-%m-%d).md" ] && pass "today's day log is in logs/<machine>/" || flop "no day log for today"
grep -rqF '{{' "$tmp/v" && flop "placeholders left after setup" || pass "every placeholder filled"
grep -qF "Your name in it is helper" "$tmp/new.out" && pass "prints the filled-in paste block" || flop "paste block not printed"
grep -qF "Your name in it is helper" "$tmp/v/PASTE-INTO-YOUR-ASSISTANT.md" && ! grep -qF '<VAULT PATH>' "$tmp/v/PASTE-INTO-YOUR-ASSISTANT.md" && pass "the vault's own paste file is filled in" || flop "vault paste file still has placeholders"
if check; then pass "fresh vault is clean"; else flop "fresh vault not clean"; cat "$tmp/check.out"; fi
size=$(wc -c <"$tmp/v/ROUTER.md" | tr -d " "); [ "$size" -lt 8192 ] && pass "router under 8 KB ($size bytes)" || flop "router is $size bytes"

# 2. setup refuses a non-empty folder
mkdir -p "$tmp/full" && echo x >"$tmp/full/note.md"
if bash "$here/new-vault.sh" "$tmp/full" >/dev/null 2>&1; then flop "wrote into a non-empty folder"; else pass "refuses a non-empty folder"; fi
[ "$(cat "$tmp/full/note.md")" = x ] && pass "left the existing note alone" || flop "changed the existing note"
if bash "$here/new-vault.sh" "$tmp/x" --machine "My Laptop" >/dev/null 2>&1; then flop "accepted a machine name with spaces"; else pass "rejects a machine name with spaces"; fi

# 3. secrets anywhere in the vault
new; echo "- project id for the dashboard: $FAKE_PID" >>"$tmp/v/topics/example-project.md"
expect_fail "project id pasted into a topic" "network-prefixed project id"
new; echo "Fetched https://api.example.com/v1?project_id=$FAKE_VAL and it failed" >>"$tmp/v/logs/laptop/$(date +%Y-%m-%d).md"
expect_fail "key inside a URL in a day log" "key in url"
new; printf '%s\n' "- deploy token $FAKE_GH" >>"$tmp/v/reports/README.md"
expect_fail "access token in a report" "api key"
new; printf 'test wallet private key: %s\n' "$FAKE_HEX" >>"$tmp/v/CORE.md"
expect_fail "64-hex private key in CORE" "64-hex value"
new; printf 'seed phrase: %s\n' "$FAKE_WORDS" >>"$tmp/v/topics/example-project.md"
expect_fail "seed phrase in a note" "seed phrase"
new; printf '%s\n' "$FAKE_WORDS" >>"$tmp/v/files/code/notes.txt"
expect_fail "bare 12-word line in a text file" "seed phrase"
new; n="$(printf 'API_%s' 'KEY')"; printf '%s=%s\n' "$n" "$FAKE_VAL" >>"$tmp/v/files/code/snippet.txt"
expect_fail "key assignment pasted from an env file" "secret assignment"

# 4. files that must never be in a vault
new; : >"$tmp/v/files/data/.env.local"
expect_fail ".env file dropped into files/" "file that must never be in a vault"
new; : >"$tmp/v/files/_unsorted/server.pem"
expect_fail "key file dropped into _unsorted/" "file that must never be in a vault"

# 5. KEY-INDEX holds names and places only
new; perl -0pi -e "s/_password manager: \"Weather — dashboard \(prod\)\"; env var \`WEATHER_KEY\` on the server_/$FAKE_VAL/" "$tmp/v/KEY-INDEX.md"
expect_fail "a value in a KEY-INDEX cell" "KEY-INDEX cell looks like a value"
new; perl -0pi -e 's/WEATHER_KEY/WEATHER_API_KEY_PROD/' "$tmp/v/KEY-INDEX.md"
if check; then pass "an env var name in backticks is fine in KEY-INDEX"; else flop "flagged an env var name"; cat "$tmp/check.out"; fi

# 6. inbox: append-only, signed
new; echo "- the owner moved to a new time zone" >>"$tmp/v/INBOX.md"
expect_fail "unsigned inbox entry" "inbox entry not signed"
new; echo "- the owner moved to UTC+1 — helper (laptop) | 2026-02-01" >>"$tmp/v/INBOX.md"
if check; then pass "signed inbox entry passes"; else flop "signed entry flagged"; cat "$tmp/check.out"; fi
new; echo "- the owner moved to UTC+1 -- helper (laptop) | 2026-02-01" >>"$tmp/v/INBOX.md"
if check; then pass "a signature typed with -- passes"; else flop "-- signature flagged"; cat "$tmp/check.out"; fi
new; rm "$tmp/v/topics/example-project.md"; sed -i.bak 's/example-project/kitchen-remodel/g' "$tmp/v/CORE.md" "$tmp/v/ROUTER.md"; rm -f "$tmp/v/"*.bak; printf '# Kitchen remodel\n' >"$tmp/v/topics/kitchen-remodel.md"
if check; then pass "step 3 as written (replace the example topic, fix CORE and ROUTER) checks clean"; else flop "step 3 leaves broken links"; cat "$tmp/check.out"; fi

# 7. structure
new; rm "$tmp/v/KEY-INDEX.md"
expect_fail "missing KEY-INDEX" "missing front-door file"
new; rep 'x' 9000 >>"$tmp/v/ROUTER.md"
expect_fail "router over 8 KB" "max 8192"
new; echo "- see [[no-such-note]]" >>"$tmp/v/topics/example-project.md"
expect_fail "broken wikilink" "wikilink to a note that does not exist"
new; echo "- see [[example-project|the example]] and [[topics/example-project#Now]]" >>"$tmp/v/HOME.md"
if check; then pass "aliased and path wikilinks resolve"; else flop "good wikilinks flagged"; cat "$tmp/check.out"; fi
new; mkdir -p "$tmp/v/logs/laptop" && : >"$tmp/v/logs/laptop/today notes.md"
expect_fail "badly named day log" "day log must be"

# 8. git option
if ! command -v git >/dev/null; then echo "skip  --git checks (git not installed)"; else
rm -rf "$tmp/g"; if bash "$here/new-vault.sh" "$tmp/g" --git >/dev/null 2>&1 && [ -d "$tmp/g/.git" ] && [ -z "$(git -C "$tmp/g" remote)" ]; then
  pass "--git makes a local repo with no remote"
  (cd "$tmp/g" && : >.env && : >wallet-1.json && git status --porcelain --ignored | grep -q '!! .env' && git status --porcelain --ignored | grep -q '!! wallet-1.json') \
    && pass ".gitignore keeps .env and wallet files out of history" || flop ".gitignore let a secret-shaped file through"
else flop "--git"; fi
fi

echo "selftest: $ok ok, $bad failed"
[ "$bad" -eq 0 ]
