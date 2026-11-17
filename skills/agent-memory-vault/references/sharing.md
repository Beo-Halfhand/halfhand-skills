# Several agents, several machines, one vault

## The one rule
**Every file has exactly one writer.** File sync (and git across machines) handles "two people edited two files" well and "two people edited one file" badly: one edit wins silently, or you get a "conflicted copy" next to the note and nobody notices for a week.

## Roles

| Role | How many | Writes |
|---|---|---|
| Owner (human) | 1 | anything; owns `RULES.md` |
| Core writer | exactly 1 | `ROUTER.md`, `CORE.md`, `DECISIONS.md`, `LESSONS.md`, `KEY-INDEX.md`, `HOME.md`, `topics/` (unless a topic names another writer), its day logs; files inbox entries |
| Other agent | any | `agents/<name>/`, its day logs, new files in `files/`, new lines at the bottom of `INBOX.md` |
| One-off session | any | `reports/` only |

Write each agent's row into `RULES.md` when it joins. An agent with no row writes only to `reports/`.

## Adding an agent
1. Pick a name (lowercase, hyphens) and add its row to `RULES.md`.
2. Make `agents/<name>/`.
3. Give it the paste block from `PASTE-INTO-YOUR-ASSISTANT.md` with its name and machine. The block already tells a non-core agent to use the inbox for core facts.
4. If it runs on a new machine, it starts `logs/<machine>/`.

## The inbox
- **Append only.** A new line at the bottom of "## Entries", signed `— <agent> (<machine>) | YYYY-MM-DD`. Never edit or delete a line, your own included; a correction is a new line ("corrects the 02-01 entry: ...").
- **Filing:** the core writer puts each fact where it belongs (CORE, a topic home, DECISIONS), then moves the filed lines, whole and unedited, to `logs/inbox-archive/YYYY-MM.md`.
- `vault-check.pl` fails on an unsigned entry.

Why an inbox and not "everyone edits CORE carefully": careful doesn't survive two sessions running at once. Appending one line at the end is the safest write a synced file can take; rewriting a section is the riskiest.

## Two machines
- Each machine writes its own day log: `logs/laptop/2026-02-01.md`, `logs/desktop/2026-02-01.md`.
- Any other file both machines might write gets the same split.
- With git: commit from one machine only, on a schedule, so a commit never races the sync on the other.
- The core writer can run on either machine, but not both at the same moment. If it does, the second session should only read until the first is done.

## Talking between agents
Agents don't edit each other's notes. To ask another agent for something, add an inbox line that names it ("for helper: ..."). The core writer, or the agent named, picks it up on its next session.

## When something gets overwritten anyway
1. Look for "conflicted copy" files next to the note, and in the sync service's version history.
2. Merge by hand, keeping both sides' lines.
3. Find which rule was broken (usually two writers on one file) and add a LESSONS line.
