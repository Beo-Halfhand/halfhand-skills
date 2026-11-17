---
type: router
writer: {{AGENT}}
updated: {{DATE}}
---
# Router
#vault

_Every session reads this file first, then opens only what the task needs. It stays under 8 KB because it points to notes instead of copying them. If a line here disagrees with the note it points to, the note wins, and the line here gets fixed in the same turn._

## Step 0: every session
1. Read this file to the end.
2. Read [[CORE]] (standing facts about the owner) and [[LESSONS]] (mistakes already made once).
3. Read today's day log for the machine you are on: `logs/<machine>/YYYY-MM-DD.md`. If today's is empty, read yesterday's.
4. If you are the core writer, read [[INBOX]] and file what's waiting.

## Standing rules
_Each rule names where it came from: who set it and when. Add yours the same way; delete the examples you don't want._

**Secrets**
- Never write a password, key, token, seed phrase or recovery code into any file here, not even once and not "for a minute". [[KEY-INDEX]] holds the name of each secret and **where** it is stored, never the value. (Template rule.)
- Never paste the contents of a config or `.env` file. Write the names of the settings and the shape, never the values. (Template rule.)

**Writing**
- Write only where [[RULES]] says you may. Never edit another agent's folder or this router unless you are its writer. (Template rule.)
- Sign every log line, inbox entry and report: `— <agent> (<machine>) | YYYY-MM-DD`. (Template rule.)
- A fact lives in exactly one note. Everything else links to it. (Template rule.)
- A decision goes into [[DECISIONS]] in the same turn it is made, and every note that still states the old answer is fixed in that same turn. (Template rule.)

**Truth**
- Check before you claim: read the note, the log or the live source, then say it. A result that looks too clean is a measurement problem until shown otherwise. (Template rule.)
- When the owner proposes something, give your own view next to theirs before acting on it. (Template rule.)

## Now: where each topic lives
_One line per topic. The "Home" note holds what is true now. Update "As of" when you bring a home up to date._

| Topic | Home | As of |
|---|---|---|
| Every decision, newest first | [[DECISIONS]] | live |
| Mistakes turned into rules | [[LESSONS]] | live |
| Who writes where | [[RULES]] | {{DATE}} |
| Keys (names and locations only) | [[KEY-INDEX]] | {{DATE}} |
| Map of every note | [[HOME]] | {{DATE}} |
| _Example: a project you are working on_ | `topics/example-project.md` | |

## In flight
_What is happening now. Remove a row when the job is done (the day log keeps the history)._

| What | Who | Since | Next step |
|---|---|---|---|
| _Example: set up this vault_ | {{AGENT}} | {{DATE}} | _fill in CORE and the first topic home_ |

## Day log and wrap-up
- One file per machine per day: `logs/<machine>/YYYY-MM-DD.md`. Newest line at the bottom, each line signed. Log decisions, sends and finished jobs as they happen, not only at the end.
- **Wrap-up** (when the owner says "wrap it up"): (1) bring every topic home you touched today up to date; (2) check [[DECISIONS]] has every decision from today; (3) close the day log with any mistakes worth not repeating, and add a line to [[LESSONS]] for each one the owner caught; (4) update "In flight" above.

— {{AGENT}} ({{MACHINE}}) | {{DATE}}
