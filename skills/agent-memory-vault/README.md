# agent-memory-vault skill

Teaches an AI agent to set up a memory vault: a folder of markdown notes the owner keeps, which any assistant that can read files uses as its long-term memory. One router read first every session, day logs per machine, a single-writer core file with an append-only signed inbox, decisions, lessons, a key index with names and locations only, and a files layout. Obsidian-friendly; reads fine on GitHub.

| File | For |
|---|---|
| `SKILL.md` | The agent: why, the steps, how several agents share one vault, the secrets rules |
| `template/` | The empty vault: `ROUTER.md`, `RULES.md`, `CORE.md`, `INBOX.md`, `DECISIONS.md`, `LESSONS.md`, `KEY-INDEX.md`, `HOME.md`, `topics/`, `logs/`, `agents/`, `reports/`, `files/`, `.gitignore` |
| `template/PASTE-INTO-YOUR-ASSISTANT.md` | The instructions block for any assistant |
| `scripts/new-vault.sh` | One-command setup: copies the template, fills names and date, makes today's day log, prints the paste block |
| `scripts/vault-check.pl` | Fails on secrets, forbidden files, value-shaped key-index cells, unsigned inbox lines, broken wikilinks, a router over 8 KB. Prints `file:line: rule`, never the match |
| `scripts/selftest.sh` | Makes a vault in a temporary folder and plants each problem once (29 checks) |
| `references/layout.md` | Why each piece exists |
| `references/sharing.md` | Several agents and machines on one vault |
| `references/secrets.md` | Keeping secrets out, and what to do when one gets in |
| `references/obsidian.md` | Opening the vault in Obsidian |

**Needs:** bash and perl (both ship with macOS and most Linux). git only for `--git`. No account, no network.

**Status:** in development. See the table in the [halfhand-skills README](https://github.com/Beo-Halfhand/halfhand-skills#skills).
