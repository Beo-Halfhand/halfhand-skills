# safe-logs skill

Teaches an AI agent to keep secrets out of what programs print and what gets saved from it. Three ways in:
- **Inside a Node process:** `import './mask-stdio.mjs'` first, and library log lines are masked too.
- **As a pipe** around any program: `… | node mask-pipe.mjs`.
- **As masked daily log files:** `--log`.

All three use one rule list. It fails closed and has no dependencies. There's also a tool to count a leaked key's copies without printing it, and the after-a-leak checklist: rotate first.

```sh
some-program 2>&1 | node scripts/mask-pipe.mjs                 # masked output
some-program 2>&1 | node scripts/mask-pipe.mjs --log ~/logs job  # masked, daily, owner-only log files
```

| File | For |
|---|---|
| `SKILL.md` | The agent: when to use it, the steps, the safety rules, what to report |
| `scripts/redact.mjs` | The rule list: `redact`, `redactDeep`, `makeRedactor`, `loadExtra`, `stripAnsi` |
| `scripts/mask-stdio.mjs` | Import first: masks this process's stdout and stderr; `safeDestination()` for loggers |
| `scripts/mask-stream.mjs` | The stream wrapper behind it (`maskStream`, `maskChunk`), with no side effects |
| `scripts/mask-pipe.mjs` | The pipe and log writer, as a command or a module (`maskPipe`, `createMaskTransform`, `openDailyLog`) |
| `scripts/options.mjs` | `SAFE_LOGS_*` settings: your own terms, exact secret values, toggles |
| `scripts/count-copies.mjs` | After a leak: counts copies of one secret across folders, never prints it |
| `scripts/selftest.mjs` | 85 checks, no network (about 5 seconds) |
| `references/where-leaks-come-from.md` | The seven ways keys reach output, and the fix at each source |
| `references/rules.md` | Every rule with examples, what it keeps and misses, every option |
| `references/shell.md` | Pipes and exit codes, separate streams, captures, `tee`, TTY refusal, never `-x` |
| `references/for-tools.md` | The contract for a mirror, logger or agent that writes other programs' output |
| `references/after-a-leak.md` | Rotate, count, clean, prevent |

**Needs:** Node 20+.

**Status:** in development. See the table in the [halfhand-skills README](https://github.com/Beo-Halfhand/halfhand-skills#skills).
