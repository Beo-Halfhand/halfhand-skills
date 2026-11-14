# prepublish-leak-check skill

Teaches an AI agent to check anything for secrets **and** setup details before it leaves the machine: keys and tokens, but also home paths, hostnames, private IPs, scheduler labels, personal emails and real names in commit metadata, in the files and in git history.

| File | For |
|---|---|
| `SKILL.md` | The agent: when to use it, the steps, safety rules, what to report |
| `scripts/leak-check.mjs` | The scanner: 13 rules, forbidden file names, commit identities, your private terms. No dependencies. Prints `file:line: rule`, never the match |
| `scripts/selftest.mjs` | Plants fakes in a temporary repo and checks each is found (31 checks) |
| `references/patterns.md` | Each rule: what it catches, false positives, what it misses |
| `references/leakterms.md` | Your private terms file: what goes in it and how to check it loads |
| `references/redact.md` | Printing names not values; masking a process's output |
| `references/ci.md` | GitHub Actions job, pre-push hook, the fresh-clone check before going public |

**Needs:** Node 20+ and [gitleaks](https://github.com/gitleaks/gitleaks) 8.x. Nothing leaves your machine.

The [halfhand-skills](https://github.com/Beo-Halfhand/halfhand-skills) repo's own CI runs the same rules (its checker imports them from `scripts/leak-check.mjs`).

**Status:** in development. See the table in the [halfhand-skills README](https://github.com/Beo-Halfhand/halfhand-skills#skills).
