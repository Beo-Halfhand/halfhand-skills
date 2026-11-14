# Your private terms file

The generic rules can't know what's private to *you*. Keep a list in a file outside every repo and pass it with `LEAK_TERMS=<file>`.

## What goes in it

One case-insensitive regex per line. Typical entries (placeholders here; put your real values in your file):

```text
your-real-first-name\s+your-real-last-name
your-handle-elsewhere
your-hostname(\.local)?
your-second-machine
your-agent-name-1|your-agent-name-2
your-project-codename
com\.your-label-prefix\.
your-employer
your-city
```

Good candidates: your real name and its variants, other handles, every hostname you own, internal service and agent names, project codenames, your scheduler label prefix, an employer or city you don't want tied to the public identity, and identifiers like wallet addresses or account ids that belong to your private setup.

## Rules for the file

- **No blank lines.** An empty regex matches every line, and the check drowns.
- **Escape dots** (`\.`) and other regex characters you mean literally.
- `chmod 600` it, and keep it out of every repo and synced folder you publish from. It's a list of exactly what you don't want published.
- The terms are reported as `private term N` (the line number in your file), so the output never shows them either.

## Check it loads

```sh
grep -c . ~/.leakterms                                    # non-empty lines
grep -c '^$' ~/.leakterms                                 # must print 0 (grep then exits 1; that's fine)
mkdir -p /tmp/lt-probe && echo "test your-hostname here" > /tmp/lt-probe/probe.txt   # use one of your real terms
LEAK_TERMS=~/.leakterms node <skill>/scripts/leak-check.mjs /tmp/lt-probe
```

The run should report `probe.txt:1: private term N`. Delete `/tmp/lt-probe` afterwards.
