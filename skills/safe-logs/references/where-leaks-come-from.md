# Where leaks come from

In roughly the order you'll meet them. For each: how it happens, and the fix at the source. The mask is the net under all of them.

## 1. A library prints a URL

Websocket clients, RPC providers, HTTP clients and database drivers log their connection URL on connect, disconnect and retry. If the key is in the query string (`wss://rpc.example.com/?project_id=…`), it's in the log line. Your own code never printed it: the library did, through `console.error`, on its own schedule.

- **Fix at the source:** put keys in a header or the request body when the service allows it.
- **Net:** `import './safe-logs/mask-stdio.mjs'` first, so `console.*` from every library is masked. The `url-query` rule keeps the host and path, so the line still says which service dropped.

## 2. A logger skips the stream

Fast loggers write to file descriptors 1 and 2 directly (pino does by default), not through `process.stdout.write`. A wrapper on `process.stdout` never sees those lines. They also land in `$(…)` captures of your stdout.

- **Fix:** give the logger `safeDestination()` (it writes through the masked stream), or point it at stderr through `process.stderr.write`.
- **Net:** run the whole program through `mask-pipe.mjs`. A pipe sees file descriptors, not streams. The self-test shows both: the direct write gets past `mask-stdio`, and the pipe catches it.

## 3. A key split across two writes

`write('…?token=abc')`, then `write('def…')`. A mask that checks each write on its own sees two harmless halves.

- **Net:** `mask-pipe.mjs` holds partial lines and joins them before matching. A line longer than 64 KB is passed on in pieces cut at a space. `mask-stdio` masks each write on its own: rare inside one process, common across a pipe, so pipe output you don't control.

## 4. Tracing: `set -x`, `bash -x`, `sh -x`

Tracing prints every command **after** variables are expanded, keys included, to stderr. CI systems often turn it on for "debug" reruns.

- **Fix:** never trace a script that touches keys. If you must debug, `set +x` before any line that uses a secret, and back after.

## 5. Captures and copies: `$(…)`, `tee`, CI logs, screenshots

`out=$(tool)` keeps the key in a variable that you then echo. `tool | tee run.log` writes the raw stream to disk. CI keeps logs for months. A terminal screenshot is a copy too.

- **Net:** mask **before** the copy: `tool 2>&1 | node mask-pipe.mjs | tee run.log`, or `--log`. For a script whose whole job is to output a secret (writing an env file, exporting variables), make it refuse to print to a terminal (see [shell.md](shell.md)).

## 6. Mirrors and transcripts

Tools that copy a terminal into a notes folder for an AI to read, session transcripts, chat exports: they copy whatever was on screen, including a key a library printed an hour ago. If that folder syncs, the copy is on every device and in the version history.

- **Net:** the mirror writes through the mask and fails closed: no mask, no file. [for-tools.md](for-tools.md) shows the contract.
- **Also:** keep mirrors and transcripts out of folders that sync to other people.

## 7. Old copies

After the fix, the old logs, the snapshots, the backup and the cloud folder's version history still hold the key.

- **Fix:** rotate the key. Then count and clean the copies ([after-a-leak.md](after-a-leak.md)).
