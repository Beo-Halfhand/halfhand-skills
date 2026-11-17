# Shell patterns

`MP` below is the path to `mask-pipe.mjs`, for example `MP=tools/safe-logs/mask-pipe.mjs`.

## A command

```sh
some-program 2>&1 | node "$MP"
```

The exit status of a pipeline is the last command's, here the mask's (0). To keep the program's:

```bash
set -o pipefail                       # bash, zsh: the pipeline fails if any part fails
some-program 2>&1 | node "$MP"        # or read ${PIPESTATUS[0]} in bash, ${pipestatus[1]} in zsh
```

## A whole script, including everything it calls

```bash
#!/usr/bin/env bash
if [ -z "${SAFE_LOGS_PIPED:-}" ]; then
  export SAFE_LOGS_PIPED=1
  MP="$(cd "$(dirname "$0")" && pwd)/tools/safe-logs/mask-pipe.mjs"   # where you copied scripts/, from THIS script's folder
  [ -f "$MP" ] || { echo "safe-logs: $MP not found; not running unmasked" >&2; exit 2; }
  bash "$0" "$@" 2>&1 | node "$MP"            # bash "$0": works for "bash job.sh" and files that aren't executable
  s=("${PIPESTATUS[@]}"); [ "${s[1]}" = 0 ] || exit "${s[1]}"   # the mask failed: say so
  exit "${s[0]}"                               # otherwise the script's own exit code
fi
# … the rest of the script: docker, curl, sh errors, every tool's output is masked
```

The self-test runs exactly this (started as `bash job.sh`, not executable) and checks that the exit code survives, that a failing mask is an error, and that a missing `mask-pipe.mjs` runs nothing.

## Keeping stderr separate

```bash
some-program 2> >(node "$MP" >&2) | node "$MP"
```

Each stream gets its own mask. Order between the two isn't guaranteed, the same as without the mask.

## Captures

```bash
out="$(some-program 2>&1 | node "$MP")"     # mask inside the capture, not after
```

## A copy on disk

```bash
some-program 2>&1 | node "$MP" | tee run.log                 # masked before tee
some-program 2>&1 | node "$MP" --log ~/logs run              # or a daily, owner-only log
```

## A script whose output is a secret

Some scripts exist to emit secrets: writing an env file, `eval "$(export-endpoints)"`. Make them refuse a terminal, so nobody runs one by hand and gets the secret on screen (and in the scrollback, a recording, a screenshot):

```js
if (process.stdout.isTTY) { console.error('refusing to print secrets to a terminal; use eval "$(…)" or redirect to a file'); process.exit(2); }
```

```bash
[ -t 1 ] && { echo "refusing to print secrets to a terminal" >&2; exit 2; }
```

## Prompts for a secret

Read it without echo, and never as a command-line argument (arguments show in `ps` and in shell history):

```bash
read -rs -p "API key: " KEY; echo
```

## Never trace

`set -x`, `bash -x`, `sh -x`, `zsh -x` and `PS4` tricks print every expanded line, keys included, to stderr. CI "debug mode" often turns it on. If you must trace part of a script:

```bash
set +x            # before any line that touches a secret
use_the_key
set -x            # after
```

## Checking a file has no copy, without printing it

```bash
node tools/safe-logs/count-copies.mjs --var MY_API_KEY some.log     # counts only
```

Never `grep "$KEY" file` without `-c` or `-q`: a match prints the line.
