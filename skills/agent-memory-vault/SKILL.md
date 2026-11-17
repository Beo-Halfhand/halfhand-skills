---
name: agent-memory-vault
description: Set up a memory vault for AI assistants, a plain folder of markdown notes that the owner keeps and can move between tools. One router file every session reads first (standing rules, a pointer table, what's in flight), day logs split by machine, a single-writer core file with an append-only inbox other agents sign, a decisions ledger, lessons, a key index that holds names and locations only (never values), and a files layout. Works with any assistant that can read files (paste-in instructions block included), opens in Obsidian (wikilinks and a map-of-content index) and reads fine on GitHub. Includes a one-command setup and a checker that fails on secrets, value-shaped key-index cells, unsigned inbox lines and broken links. Use it when someone wants their assistant to remember across sessions, tools or machines without a vendor's memory feature, wants several agents to share one memory safely, or asks how to keep secrets out of an assistant's notes.
---

# agent-memory-vault

**Why.** An assistant's built-in memory belongs to the tool: you can't read all of it, move it to another tool, or share it between two assistants. A vault is a folder of markdown files you own. Any assistant that can read files can use it, you can read and fix every line yourself, and it moves with you when you change tools. This skill sets one up with the habits that keep it useful after months: one front door, one writer per file, decisions and lessons kept apart from day logs, and no secrets, ever.

## When to use
- Someone wants their assistant to remember things across sessions, tools or machines.
- Someone runs two or more assistants (or a desktop assistant plus a coding agent) and wants them to share what they know without overwriting each other.
- Someone has notes their assistant writes to and wants rules so it stays tidy and free of secrets.
- Before sharing or backing up a vault: run the checker (step 5).

## What's in a vault

| File or folder | Holds | Writer |
|---|---|---|
| `ROUTER.md` | Read first every session: step 0, standing rules (each with where it came from), a table pointing at each topic's home, what's in flight. Under 8 KB | the core writer |
| `RULES.md` | Who writes where, layout, size rules, what never goes in | the owner (human) |
| `CORE.md` | Standing facts about the owner | **one writer only** |
| `INBOX.md` | Other agents' facts and requests for the core writer. Append only, every line signed | anyone appends; core writer files |
| `DECISIONS.md` | Every decision, newest first, with the notes changed to match | the core writer |
| `LESSONS.md` | Mistakes turned into rules | the core writer |
| `KEY-INDEX.md` | Each secret's name, where it's stored, what it unlocks. **Never a value** | the core writer |
| `HOME.md` | Map of content: every note, one line each (plain markdown links, so it works on GitHub too) | the core writer |
| `topics/` | One note per subject: what is true now | its creator |
| `logs/<machine>/YYYY-MM-DD.md` | Day logs: what happened, one file per machine per day | each machine's agent |
| `agents/<name>/` | Other agents' own notes | that agent |
| `reports/` | Finished reports from one-off sessions | the session |
| `files/` | Attachments: documents, images, data, code, archive, `_unsorted` | anyone adds, nobody edits others' |

The template is in [`template/`](template/). [references/layout.md](references/layout.md) explains why each piece exists.

## Steps

**Before you start.** You need bash and perl with its core modules. macOS has both. On Debian or Ubuntu minimal images (containers, small servers) only `perl-base` is installed, which is not enough: run `sudo apt-get install perl`. Check with `perl -MFile::Find -e1` (no output means it's fine). git is needed only for `--git`. Below, `<this skill>` means the folder that holds this SKILL.md.

### 1. Make the vault (one command)

```sh
bash <this skill>/scripts/new-vault.sh ~/vault --agent assistant --machine laptop
```

- `--agent`: the core writer's name (the assistant that owns `CORE.md`). Lowercase, hyphens.
- `--machine`: a short name for this machine. Pick a role (`laptop`, `desktop`, `server`), not the computer's network name: the vault may be read on other machines and the name shows up in every log line.
- `--git`: also start a local git repo for history (needs git; it stops before writing anything if git is missing). Never add a public remote.

It refuses a folder that isn't empty, fills the template, makes today's day log, and prints the instructions block filled in with the path and names (the vault's own `PASTE-INTO-YOUR-ASSISTANT.md` is filled in too).

**No shell?** Copy `template/` to where the vault should live, replace `{{AGENT}}`, `{{MACHINE}}` and `{{DATE}}` in the notes by hand, fill the `<...>` values in `PASTE-INTO-YOUR-ASSISTANT.md`, and create today's day log as `logs/<machine>/YYYY-MM-DD.md`.

### 2. Tell the assistant about it

Paste the block from [`template/PASTE-INTO-YOUR-ASSISTANT.md`](template/PASTE-INTO-YOUR-ASSISTANT.md) (step 1 prints it filled in) into the assistant's custom instructions, system prompt, project instructions or rules file. It works with any assistant that can read and write files. It tells the assistant to read `ROUTER.md` first, where it may write, how to sign, and to never write a secret.

### 3. Fill in CORE and the first topic home
Ask the assistant to interview the owner for `CORE.md` (who, how they like to work, people, projects), then replace `topics/example-project.md` with a real topic and change the two places that point at it (`CORE.md` "Projects" and the `ROUTER.md` "Now" table) to the new name. Step 5 lists any link you missed as "wikilink to a note that does not exist". Keep the router's "Now" table pointing at each home.

### 4. Add a second agent (optional)
See [references/sharing.md](references/sharing.md). In short:
1. Add a row for it in `RULES.md`: its name, its folder `agents/<name>/`, and "appends to INBOX".
2. Give it the same paste block with its own name. It is **not** the core writer.
3. It reads `ROUTER.md` like everyone else, writes its own day log and folder, and puts anything for `CORE.md` in `INBOX.md` as a signed line.

### 5. Check it

```sh
perl <this skill>/scripts/vault-check.pl ~/vault
```

Prints `file:line: rule`, never the matching text. Exit 0 clean, 1 problems. It fails on secret-shaped values anywhere (keys, tokens, private keys, keys inside URLs, seed-phrase lines), files that must never be in a vault (`.env`, key and wallet files), a KEY-INDEX cell that looks like a value, an unsigned inbox line, a missing front-door file, a router over 8 KB, a misnamed day log, and a `[[wikilink]]` to no note. It warns on notes over 50 KB and leftover placeholders. Run it before sharing, backing up or syncing the vault somewhere new, and on a schedule if you like.

`bash <this skill>/scripts/selftest.sh` makes a vault in a temporary folder and plants each problem once (32 checks; 30 when git isn't installed, and it says which it skipped). Expect `selftest: N ok, 0 failed`.

## How several agents share one vault safely

The rule that does the work: **every file has exactly one writer.** In a synced folder, two writers on one file is how a note gets silently overwritten or split into "conflicted copy" files.

| Who | Reads | Writes |
|---|---|---|
| Core writer | everything | top-level notes, `topics/`, its own day logs; files `INBOX.md` entries |
| Another agent | everything | `agents/<name>/`, its own day logs, new files in `files/`, new signed lines at the bottom of `INBOX.md` |
| One-off session (a coding run) | what its prompt says | `reports/` only |
| Owner | everything | anything; owns `RULES.md` |

- **Day logs split by machine** (`logs/laptop/`, `logs/desktop/`), so two machines never write the same file at once.
- **The inbox is append-only.** Nobody edits a line that's there, including their own; a correction is a new line. The core writer moves filed lines, whole, to `logs/inbox-archive/YYYY-MM.md`.
- **Sign everything:** `— <agent> (<machine>) | YYYY-MM-DD` (an em dash; `--` is accepted too, for keyboards without one). A note with no signature has no owner to ask.
- **A fact lives once.** The router and HOME point; they never copy. A decision updates every note that said the old thing, in the same turn.
- **Git, if used, commits from one machine only**, so a commit never races the sync.

## Rules that keep secrets out
1. **Never a value in the vault.** Not a key, token, password, seed phrase, recovery code or session cookie, not partly, not "for a minute". Sync services, backups and search indexes keep copies.
2. **KEY-INDEX holds names and places:** "weather API, read-only · password manager item `Weather — dashboard (prod)`; env var `WEATHER_KEY` on the server". That's enough for an assistant to say which key a job needs and where to find it.
3. **Never paste a config or `.env` file** into a note. Write the setting names and the shape.
4. **Mask before you log.** A day log that copies tool output can copy a key with it (an error message with the key in a URL is the usual way). Copy the conclusion, not the raw output.
5. **The vault's `.gitignore`** keeps `.env`, key, seed and wallet files out of git history even if one is dropped in by mistake. The checker fails on them anyway.
6. **Never share the vault by public link** and never push it to a public repo. Run the checker before any copy leaves your machines.
7. **If a secret got in:** rotate it first (assume it's been copied), then remove it from the note, then from history (git and the sync service's version history), then add a line to `LESSONS.md` saying how it got in.

Details and the reasons: [references/secrets.md](references/secrets.md).

## Obsidian
Open the vault folder as an Obsidian vault. Notes link with `[[wikilinks]]`; `HOME.md` is the map of content (plain links, so it also works on GitHub and in any editor). One tag per note (`#vault`, `#topic`, `#log`) keeps the graph readable. More in [references/obsidian.md](references/obsidian.md).

## Report back
Tell the owner: where the vault is, the core writer's and machine's names, that the paste block is ready (show it), and the checker result. If you set up a second agent, show its row in `RULES.md`.

## Safety rules for the agent running this skill
- Never write a secret into the vault, even if the owner pastes one and asks you to "remember it". Offer a KEY-INDEX line (name and where it's kept) instead.
- Never run `new-vault.sh` on a folder that already has notes; it refuses, and you shouldn't work around it.
- Never push a vault to a remote or create a share link for it.
