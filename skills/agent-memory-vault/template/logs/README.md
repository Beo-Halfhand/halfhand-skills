# Day logs

What happened, one file per machine per day:

```text
logs/<machine>/YYYY-MM-DD.md
```

- **Split by machine** so two machines never write the same file through the sync.
- Newest line at the bottom. One line per event: a decision, a send, a finished job, a mistake.
- Every line signed: `— <agent> (<machine>) | YYYY-MM-DD`, or put the signature once in a line's prefix: `- 14:05 <agent>: ...`.
- Write as it happens, not only at wrap-up. A lost chat should only cost the chat, never the work.
- Older logs move whole into `logs/<machine>/archive/` when the folder gets long.
- `logs/inbox-archive/YYYY-MM.md` holds [[INBOX]] entries after the core writer has filed them.
