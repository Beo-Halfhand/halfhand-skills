---
type: inbox
writer: append-only (filed by {{AGENT}})
updated: {{DATE}}
---
# Inbox
#vault

_For any agent that is not the core writer: a fact for [[CORE]], or a request for {{AGENT}}. **Append only.**_

**How to add an entry**
- One line, at the bottom of "Entries". Never edit or delete a line that is already there, yours included. To correct one, add a new line that says what it corrects.
- Start with `- `, end with your signature: `— <agent> (<machine>) | YYYY-MM-DD`.
- No secrets. If a key changed, say which key and where it now lives, never the value.

**How the core writer files entries**
- Put each fact where it belongs ([[CORE]], a topic home or [[DECISIONS]]), then move the filed lines, whole and unedited, to `logs/inbox-archive/YYYY-MM.md`.

Example (this line is outside "Entries", so the checker ignores it):
`- The owner's new laptop is called "laptop-2"; day logs from it go in logs/laptop-2/. — helper (laptop-2) | 2026-01-15`

## Entries
