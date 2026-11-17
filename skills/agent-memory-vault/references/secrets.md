# Keeping secrets out

A vault is plain text in a folder. Sync services keep version history, backup tools keep copies, desktop search indexes it, and every assistant you point at it reads it. So the only safe amount of secret in a vault is none.

## What counts
Passwords, API keys, access tokens, OAuth refresh tokens, private keys (SSH, TLS, signing, wallet), seed phrases and recovery codes, session cookies, webhook URLs with a token in them, database URLs with a password in them, project ids that work as keys (some services' "project id" is the credential).

## Names and places: the key index
`KEY-INDEX.md` gives an assistant what it needs without the value:

| Name | Where it is stored | Unlocks |
|---|---|---|
| weather API, read-only | password manager item `Weather — dashboard (prod)`; env var `WEATHER_KEY` on the server | reading forecasts |

Give every key a line the day it's made. Use one label pattern in your password manager (`<Service> — <purpose> (<environment>)`) so "where" is exact. `vault-check.pl` fails on a KEY-INDEX cell that looks like a value: a long run of letters and digits with no spaces. Names in backticks (`WEATHER_KEY`) are fine.

## How secrets usually get in
| Way in | Stop it |
|---|---|
| The owner pastes a key and says "remember this" | The assistant refuses and offers a KEY-INDEX line instead |
| A day log copies a command's output, and the output has a key in a URL or an error message | Log the conclusion, not raw output. If you mirror terminal output, mask it first (the mirrored-workspace skill in this repo masks key-shaped strings before anything is written) |
| A config or `.env` file pasted "so the assistant can see the setup" | Paste names and structure only: `WEATHER_KEY=<set>` |
| A screenshot or export dropped into `files/` | Look before filing; `.env`, key and wallet files are refused by the checker and the `.gitignore` |
| A report from a one-off session | The session's prompt says "names only, never values"; check reports with `vault-check.pl` |

## What the checker catches, and what it doesn't
Catches: private key blocks, common key prefixes (cloud, code host, chat, payment, AI providers), network-prefixed project ids, `SECRET=`/`TOKEN=`-style assignments, keys and passwords inside URLs, bearer tokens, JSON web tokens, 64-hex values, seed-phrase lines (12 to 24 short lowercase words, alone or after "seed:"/"mnemonic:").

Misses: a short password in prose ("the wifi password is tulip42"), a key with no recognisable shape, a secret inside an image or PDF. The rules above are what stop those; the checker is the net, not the wall.

## If a secret got in
1. **Rotate it first.** Assume it has been copied: sync history, backups and the assistant's chat all have it.
2. Remove it from the note (replace with a KEY-INDEX pointer).
3. Remove it from history: git (rewrite or start a fresh history) and the sync service's version history for that file.
4. Add a LESSONS line: how it got in, and the rule that stops it next time.
