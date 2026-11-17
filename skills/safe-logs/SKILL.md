---
name: safe-logs
description: Keep API keys, tokens, passwords and other secrets out of what programs print and what gets saved from it. Covers terminal output, log files, CI logs, terminal mirrors and AI transcripts. It masks stdout and stderr inside a Node process (including what libraries print on their own), masks any program's output as a pipe, and writes masked daily log files. One rule list catches keys in URLs, name=value pairs, auth headers, known key formats, JSON web tokens, private key blocks, seed-phrase-like word runs and home folder names, plus exact values you name and your own terms. It fails closed, has no dependencies and ships a self-test. Also covers what to do after a leak (rotate first, count copies without printing them). Use for "my key showed up in the logs", "mask secrets in output", "redact logs", "a library prints my API key", "keep secrets out of CI logs", "pipe through a redactor", "a key leaked, what now".
---

# safe-logs

**What it is.** Keys leak through output more than through code. A library logs a URL with the key in its query string. A script runs with `-x`. A log file gets synced. A terminal mirror copies everything on screen into a notes folder. Once a key is in a synced folder, its version history keeps it even after you delete the file.

This skill puts one mask in front of every place output goes, using one rule list ([`scripts/redact.mjs`](scripts/redact.mjs)):

| Way in | Use it when | How |
|---|---|---|
| **Inside a Node process** | You own the entry point. Catches `console.log`, `console.error`, `process.stdout.write`, and what libraries print on their own | `import './safe-logs/mask-stdio.mjs'` as the **first** import |
| **As a pipe** | Any program in any language, a shell script, docker, a build, a terminal mirror | `program 2>&1 \| node mask-pipe.mjs` |
| **Into a log file** | You want a log on disk: masked before it is written, daily files, owner-only permissions | `program 2>&1 \| node mask-pipe.mjs --log ~/logs build` |
| **From your own tool** | A logger, a mirror or an agent that writes transcripts | `import { maskPipe, createMaskTransform, openDailyLog } from './mask-pipe.mjs'` |
| **After a leak** | A key already got out | `node count-copies.mjs --var NAME <folders>` counts copies and never prints them. Then rotate the key |

**What gets masked:** keys in URL query strings (and `user:password@`), `NAME=value` and `"name": "value"` where the name means secret, `Bearer` and `Basic` headers, known key formats (AI providers, code hosts, cloud, chat, payments), network-prefixed project ids, JSON web tokens, 64-hex private keys, private key blocks, 12+ different short words in a row (a recovery phrase), home folder names, and a catch-all for long mixed tokens. On top of that come **exact values** you name and **your own terms** (host names, account ids). Host names and paths of URLs are kept, so an error still says which service failed. Every rule, with examples, is in [references/rules.md](references/rules.md).

**Not covered:** secrets you print one character at a time, secrets in images, and a short secret with no shape and no name next to it (`the password is tulip`), unless you name it as an exact value. A mask is a net, not a guarantee: [references/where-leaks-come-from.md](references/where-leaks-come-from.md) shows how to stop each leak at its source.

## When to use

- A key, token or password showed up in a terminal, a log, a CI run or a chat transcript.
- You're adding logging, a log file, a CI job or a terminal mirror, and want it safe from the start.
- A library you depend on prints connection URLs (websocket clients, RPC providers, database drivers).
- Before sharing logs, screenshots of a terminal, or an AI session transcript.

## Steps

### 1. Check it works here

```sh
node --version                          # 20 or newer
node <this skill>/scripts/selftest.mjs  # expect: selftest: 85 ok, 0 failed (about 5 seconds)
```

`<this skill>` is the folder that holds this SKILL.md. Copy the whole `scripts/` folder into your project (the modules import each other), for example to `tools/safe-logs/`, and run `node tools/safe-logs/selftest.mjs` there once. No dependencies. Every path below assumes that `tools/safe-logs/`, and a command is run from your project's root.

### 2. Inside your Node program

Make the mask the **first** import of every entry point (CLI, server, worker):

```js
import '../tools/safe-logs/mask-stdio.mjs';    // first; the path is relative to THIS file (here bin/app.mjs)
import { connect } from 'some-sdk';            // its console.error lines are masked too
```

An import that comes before it can print before the mask is on. That includes a `dotenv` import, so `SAFE_LOGS_SECRET_VARS` (step 5) can't see variables it loads: load env files with `node --env-file=.env bin/app.mjs` (Node 20.6+) instead. One check that catches this:

```sh
for f in bin/*.mjs; do head -20 "$f" | grep -m1 '^import ' | grep -q mask-stdio || echo "mask is not first: $f"; done
```

**Loggers that write to file descriptors 1 or 2 directly** (fast JSON loggers do, by default) skip the wrapper. Give them `safeDestination()`, which writes through the masked stream:

```js
import { safeDestination } from '../tools/safe-logs/mask-stdio.mjs';
const log = pino({}, safeDestination());      // any logger that takes an object with write()
```

### 3. Around everything else: the pipe

```sh
some-program 2>&1 | node tools/safe-logs/mask-pipe.mjs
```

It passes text on line by line, as soon as each line ends (`\n` or `\r`, so progress lines still move). It holds a partial line back, so a key split across two reads is joined before it is matched. A line with nothing to mask comes out byte for byte, colours included.

**To mask a whole script, including everything its tools print,** make it run itself through the pipe and keep its exit code. Put this at the top:

```bash
if [ -z "${SAFE_LOGS_PIPED:-}" ]; then
  export SAFE_LOGS_PIPED=1
  MP="$(cd "$(dirname "$0")" && pwd)/tools/safe-logs/mask-pipe.mjs"   # where you copied scripts/, from THIS script's folder
  [ -f "$MP" ] || { echo "safe-logs: $MP not found; not running unmasked" >&2; exit 2; }
  bash "$0" "$@" 2>&1 | node "$MP"            # bash "$0": works for "bash job.sh" and files that aren't executable
  s=("${PIPESTATUS[@]}"); [ "${s[1]}" = 0 ] || exit "${s[1]}"   # the mask failed: say so
  exit "${s[0]}"                               # otherwise the script's own exit code
fi
```

More shell patterns: keeping stderr separate, `$(…)` captures, `tee`, scripts whose output *is* a secret, and why never to use `-x`. See [references/shell.md](references/shell.md).

### 4. Log files

```sh
some-program 2>&1 | node tools/safe-logs/mask-pipe.mjs --log ~/logs build      # → ~/logs/build-YYYYMMDD.log
```

- Lines are masked **before** they touch the disk.
- Terminal colours are removed, `\r` redraws become lines, and blank lines are dropped.
- The folder is made 700 and every file 600. The name can't leave the folder.
- A day rolls to `.2.log`, `.3.log` … past `--max-mb` (default 20).

Delete old days with your scheduler, for example `find ~/logs -name '*.log' -mtime +14 -delete`.

### 5. Add what only you know

The built-in rules don't know your host names, account ids or the exact value of your keys. Tell them:

```sh
export SAFE_LOGS_SECRET_VARS=MY_API_KEY,DB_PASSWORD     # their VALUES are masked exactly, wherever they appear
export SAFE_LOGS_EXTRA="$HOME/.config/safe-logs/terms"  # one regex per line: your machine names, ids …
```

The values come from the environment when the mask starts, so set them before your program runs (in the shell, a service file or `node --env-file`). Make the terms file first, or every pipe stops with exit 2:

```sh
mkdir -p ~/.config/safe-logs && touch ~/.config/safe-logs/terms && chmod 600 ~/.config/safe-logs/terms
```

Use an absolute path: a `~` inside quotes (as in `.env` and service files) is not expanded. The file's format: [references/rules.md](references/rules.md#your-own-terms-file).

Keep the terms file **outside any repo**. It lists the very things you don't want public. A broken regex in it stops `mask-pipe.mjs` before it writes anything (exit 2). `mask-stdio.mjs` keeps the default rules and says so on stderr instead, because it can't stop your program. Every option and its flag form: [references/rules.md](references/rules.md#options).

### 6. If a key already leaked

1. **Rotate it first.** Copies in synced folders, backups, version history, CI logs and chat can't be recalled. A key that's revoked is safe wherever its copies are.
2. Count where it went, without printing it:
   ```sh
   node tools/safe-logs/count-copies.mjs --var MY_API_KEY --env-file ~/secrets/app.env ~/logs ~/notes
   ```
   It prints per file the whole copies and the cut-off copies (the first 12 characters), never the value or a line.
3. Clean the copies, then fix the source (steps 2 to 4) so it can't happen again. Pass the old key by name, because a key with no known shape isn't masked otherwise:
   ```sh
   set -a; . ~/secrets/old.env; set +a      # makes OLD_KEY visible to the mask, without printing it
   (umask 077; node tools/safe-logs/mask-pipe.mjs --count --secret-vars OLD_KEY < old.log > old.log.masked) && mv old.log.masked old.log
   ```

Full checklist: [references/after-a-leak.md](references/after-a-leak.md).

### 7. From your own tool

```js
import { maskPipe, createMaskTransform, openDailyLog } from './tools/safe-logs/mask-pipe.mjs';
await maskPipe(child.stdout, process.stdout);                                  // → { masked }
child.stderr.pipe(createMaskTransform({ crToNl: true })).pipe(openDailyLog(dir, 'worker'));
```

Importing runs nothing and doesn't touch stdin. A tool in another language runs `node mask-pipe.mjs` as a filter and treats a non-zero exit as "write nothing". That's how a terminal mirror should use it: [references/for-tools.md](references/for-tools.md).

## Safety rules

- **Fail closed.** If the mask can't run, write nothing. `mask-pipe.mjs` exits 2 on bad options before writing and 3 if masking fails mid-stream. Your tool should check that.
- **Rotate, don't just delete.** Masking a file doesn't recall copies already synced, backed up or shared.
- **Never `set -x` / `sh -x` / `bash -x`** in anything that touches keys. Tracing prints every expanded variable, and it goes to stderr, where people least expect it.
- **Keep secrets out of URLs** where you can: a header or a POST body beats a query string. Many libraries log URLs.
- **The terms file and env files stay outside every repo**, mode 600.
- **Never print a secret to check it.** Print its length or a short hash (`sha256sum | cut -c1-8` on Linux, `shasum -a 256 | cut -c1-8` on macOS) instead. `count-copies.mjs` counts; it never shows.
- **Test the mask with fakes built at run time.** A literal fake key in a test file gets flagged by secret scanners. The self-test shows how.

## Report back

When you set this up for someone, tell them:

- the self-test line;
- which way in each entry point uses (import, pipe, log), and that the import is first;
- which loggers got `safeDestination()`;
- the `SAFE_LOGS_SECRET_VARS` names (never values) and whether an extra-terms file is set (where, not what);
- if this followed a leak: rotated or not, and the `count-copies` totals per folder.

## More

- [references/where-leaks-come-from.md](references/where-leaks-come-from.md): the seven ways keys reach output, and the fix for each
- [references/rules.md](references/rules.md): every rule with examples, what it keeps, what it misses, all options
- [references/shell.md](references/shell.md): pipes, exit codes, separate streams, `$(…)`, `tee`, TTY refusal, no `-x`
- [references/for-tools.md](references/for-tools.md): using safe-logs from a mirror, a logger or an agent; the API
- [references/after-a-leak.md](references/after-a-leak.md): rotate, count, clean, prevent

## Status

**In development.** Merged from the output masks of several of our builds and the masking rules of the mirrored-workspace and fleet-dashboard skills, so there is one list instead of four. Tested on Node 26, macOS arm64, and Node 22, Debian 12 (a container, by a fresh agent following only this file): `selftest.mjs` 85/85 (every rule both ways, colours, `\r`, keys split across reads, private key blocks across reads, a line over 64 KB, 5 MB throughput, early-closing readers, the log files and their modes, fail-closed exits, import with no side effects, a library's `console.error` inside a process, the fd-1 limit and its fix, the shell rerun pattern with its exit code and a failing or missing mask, the in-place clean recipe, a symlinked path, count-copies). mirrored-workspace uses it as its masker (its self-test: 51/51).
