---
type: rules
writer: owner
updated: {{DATE}}
---
# Vault rules
#vault

_**The owner (the human) owns this file.** Agents may propose changes; the owner makes them. These rules are what let several agents and several machines share one folder without overwriting each other._

## Who lives here

| Writer | Front door | Writes | Writes [[CORE]]? |
|---|---|---|---|
| **{{AGENT}}** (the core writer) | [[ROUTER]] | everything at the top level, `topics/`, its own day logs | **Yes, the only one** |
| **Any other agent** (another assistant, another tool) | [[ROUTER]] | its own folder `agents/<name>/`, its own day logs, new files in `files/`, new lines at the bottom of [[INBOX]] | No: it appends to [[INBOX]] |
| **One-off sessions** (a coding tool run, a script) | the prompt it was given | `reports/` only | No |
| **The owner** | anywhere | anything; owns this file | Yes, by hand |

Add one row per agent when you add one. An agent with no row writes nowhere except `reports/`.

## Ownership rules
1. **Every file has exactly one writer.** In a synced folder, two writers on one file is how notes get silently overwritten or forked into "conflicted copy" files.
2. **[[CORE]] has one writer: {{AGENT}}.** Everyone else adds a signed line to the bottom of [[INBOX]]. They never edit an earlier line. The core writer files each entry into CORE (or a topic home) and then moves the filed lines, whole and unedited, to `logs/inbox-archive/YYYY-MM.md`.
3. **Nobody edits another agent's router, folder or day log.** To ask another agent for something, use [[INBOX]].
4. **A fact lives in exactly one note.** [[ROUTER]] and [[HOME]] point; they never copy. When a decision changes a fact, every note that states the old answer is fixed in the same turn and the decision goes into [[DECISIONS]].
5. **Sign what you write:** `— <agent> (<machine>) | YYYY-MM-DD` on log lines, inbox entries and reports.
6. **Split by machine.** Any file that two machines might write at the same time gets one copy per machine: day logs live in `logs/<machine>/`. Pick a short machine name (`laptop`, `desktop`, `server`) that says nothing about where the machine is or who owns it.

## Layout

```text
ROUTER.md      front door: step 0, standing rules, where each topic lives, what's in flight
HOME.md        map of content: every note and folder, one line each
RULES.md       this file (the owner's)
CORE.md        standing facts about the owner (one writer)
INBOX.md       append-only: other agents' signed facts and requests for the core writer
DECISIONS.md   every decision, newest first
LESSONS.md     mistakes turned into rules
KEY-INDEX.md   every secret's name and where it is stored, never the value
topics/        topic homes: what is true now about one subject
logs/<machine>/YYYY-MM-DD.md   day logs: what happened
agents/<name>/ other agents' own notes
reports/       finished reports from one-off sessions
files/         attachments: documents, images, data, code, archive, _unsorted
```

- `files/` is shared: any agent may **add** a new file there. Nobody edits a file someone else added. Name files `YYYY-MM-DD-what-it-is.ext`. Not sure where it goes: `files/_unsorted/`, and the core writer files it.
- Logs say what happened. Topic homes say what is true now. Never the other way round.
- **Third time gets a home:** a subject that shows up in the day logs on a third separate day gets its own note in `topics/`, linked from [[ROUTER]] and [[HOME]].

## Size
- [[ROUTER]] stays under 8 KB. If it grows, move detail into a topic home and leave a pointer.
- Any other note past 50 KB gets split, or its older part moved whole into an `archive/` folder beside it, the day it's noticed.
- No spaces in file names. Lowercase with hyphens for notes; capitals only for the ledgers and front doors above.

## What never goes here
- Passwords, API keys, tokens, private keys, seed phrases, recovery codes, session cookies. **Ever, in any file.** Their names and where they are kept go in [[KEY-INDEX]].
- The contents of `.env` or config files that hold secrets. Names of the settings only.
- Anything you'd be unhappy to see in the sync provider's breach notice. The vault is plain text in a folder; treat it like one.

## Sync and git
- Sync the folder with any file sync you trust, or keep it in a private git repo. **Never** put it in a public repo or behind a "anyone with the link" share.
- With git: commit from one machine only, so a commit never races the sync on another machine. The `.gitignore` keeps secret-shaped files and binaries out of history.
- Before any copy of the vault leaves your machines (a share, a backup service, a support ticket), run `scripts/vault-check.pl` from the agent-memory-vault skill on it.

— set up by {{AGENT}} ({{MACHINE}}) | {{DATE}} · owner to sign: ____
