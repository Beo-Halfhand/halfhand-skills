# The masker

The masker is the [safe-logs](../../safe-logs/SKILL.md) skill's `mask-pipe.mjs`, the same rule list your other tools can use, so there is one list instead of two that drift. It is the only thing that writes logs and snapshots. It reads text, strips terminal escape codes, masks anything key-shaped with `<masked>`, and writes. It never prints what it masked. `mw` finds it next to itself (`safe-logs/`, copied there by `install.sh`) or as the sibling skill in this repo; without it, or without node, nothing is written.

## Order
1. **Strip escape codes:** colours, cursor moves, titles, hyperlinks, other control bytes. A key printed in bold, or with a colour reset in the middle, joins back into one string *before* matching.
2. **Split on CR and LF:** a status line redrawn with `\r` becomes separate lines, so each redraw is matched whole.
3. **Mask**, rule by rule.

## Rules
Every rule, with fake examples, and what it misses: [safe-logs/references/rules.md](../../safe-logs/references/rules.md).

The `mw` settings map onto its flags: `MW_MASK_EXTRA` → `--extra`, `MW_MASK_GENERIC=0` → `--no-generic` (no catch-all), `MW_LOG_MAX_MB` → `--max-mb`. Its `SAFE_LOGS_*` settings (for example `SAFE_LOGS_SECRET_VARS`, exact values by variable name) apply too.

## Your own terms
Put things that aren't secrets but are still yours in a file outside any repo, one regex per line, and point `MW_MASK_EXTRA` at it (in `~/.config/mirrored-workspace/config`):

```text
# machine and network names
always-on
your-tailnet
# an internal service name
billing-internal
```

A bad regex stops the masker, so nothing is written until you fix it. `mw doctor` shows the failure.

## What it misses
The full list is in [safe-logs/references/rules.md](../../safe-logs/references/rules.md#what-it-misses). One case matters most here: a secret printed one character at a time with cursor moves between characters. The snapshot (`capture-pane`) shows the finished screen and is masked whole; the raw log can hold fragments too short to match.

The catch-all makes the misses rarer, at the cost of masking some harmless long tokens (some IDs, some base64). Turn it off with `MW_MASK_GENERIC=0` if it masks too much; then add your own terms instead.

## Old logs
`mw scrub <file or folder>` runs the masker over existing `.log`, `.txt` and `.md` files in place and prints how many lines changed per file. Then **rotate any key that was ever in them**: masking a file doesn't recall copies already synced, backed up or shared.
