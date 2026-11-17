# Using safe-logs from your own tool

For anything that writes other programs' output somewhere: a terminal mirror, a log shipper, an agent that saves transcripts, a CI step.

## The contract

1. **Every byte you write passes the mask first.** There is no "raw" path, not even a debug one.
2. **Fail closed.** If the mask can't start (node missing, the script missing, a bad option), write nothing and say so on stderr. A tool that falls back to writing unmasked output has no mask.
3. **Check the exit code.** `mask-pipe.mjs` exits 0 when done, 2 when its options are bad (nothing was written), and 3 when masking failed mid-stream (it stopped writing). Write to a temp file, then rename only on 0.
4. **Find node by absolute path.** Schedulers (launchd, cron, systemd timers) start with a bare `PATH`, often without the folder node lives in. Resolve it when you install, or look in the usual places.

## From a shell tool

```bash
MASK_PIPE="$HERE/safe-logs/mask-pipe.mjs"
: "${NODE:=$(command -v node || true)}"
[ -n "$NODE" ] || for n in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do [ -x "$n" ] && { NODE="$n"; break; }; done
mask() { [ -x "$NODE" ] && [ -f "$MASK_PIPE" ] || { echo "masker missing; writing nothing" >&2; return 1; }; "$NODE" "$MASK_PIPE" "$@"; }

# a snapshot: temp file, rename only when the mask succeeded
if capture_screen | mask --cr-to-nl --strip-ansi >"$out.tmp"; then mv -f "$out.tmp" "$out"; else rm -f "$out.tmp"; fi

# a running log
some-stream | mask --log "$LOGS" "$name" --max-mb 20

# masking an old file in place, with a count (never values)
n="$(mask --count <"$f" 2>&1 >"$f.tmp" | sed -n 's/^masked-lines=//p')" && mv -f "$f.tmp" "$f"
```

Map your tool's own settings onto the flags: an extra-terms file → `--extra`, "no catch-all" → `--no-generic`, a size → `--max-mb`. The bash `${a[@]+"${a[@]}"}` form passes an empty flag list safely under `set -u`, including on bash 3.2.

Ship the three files together: `mask-pipe.mjs`, `redact.mjs`, `options.mjs`.

## From Node

```js
import { maskPipe, createMaskTransform, openDailyLog } from './safe-logs/mask-pipe.mjs';
import { redact, redactDeep, makeRedactor } from './safe-logs/redact.mjs';

await maskPipe(child.stdout, fs.createWriteStream(file, { mode: 0o600 }));     // rejects on failure: delete the file then
child.stderr.pipe(createMaskTransform({ crToNl: true, stripAnsi: true })).pipe(openDailyLog(dir, 'worker', { maxMb: 20 }));
const safeError = redact(String(err.message));                                  // one string
const safeJson = redactDeep(responseBody);                                      // every string in an object
const r = makeRedactor({ secrets: [process.env.MY_KEY] });                      // stateful: a private key block across lines
for (const line of lines) out.push(r.line(line));
```

Importing `mask-pipe.mjs` runs nothing: no stdin, no side effects. Importing `mask-stdio.mjs` installs the mask on the current process's stdout and stderr; that is its whole purpose.

## From another language

Run it as a filter: start `node mask-pipe.mjs` as a child process, write your text to its stdin, read the masked text from its stdout, and wait for exit 0 before using the result. Don't re-implement the rules: one list is the point.
