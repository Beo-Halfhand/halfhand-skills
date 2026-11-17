---
type: ledger
writer: {{AGENT}}
summary: "Every decision the owner makes, one line each, newest first: time, topic, decision, why, and which notes were changed to match."
updated: {{DATE}}
---
# Decisions
#vault

Rule: one line per decision, newest day first. "Applied in" lists every note changed to match. **A decision isn't logged until those notes are fixed.** A decision that replaces an older one says so ("replaces 01-10").

Format:
`- HH:MM · topic · **the decision** · why · Applied in: [[note]], [[note]]`

## {{DATE}}
- 00:00 · vault · **Use this vault as the shared memory for every assistant** · memory the owner keeps and can move between tools · Applied in: [[ROUTER]], [[RULES]]
