---
name: prepublish-leak-check
description: Check anything for secrets and setup details before it leaves the machine, whether a git push, a repo going public, a post, a pasted log or a screenshot. It finds API keys, private keys, tokens in URLs, seeds, home paths, private hostnames and IPs, scheduler labels, personal emails and real names in commit metadata, in the files and in git history. Use it for "is this safe to push/post", "scan for secrets", "redact this log", before flipping a repo public, or to add a leak gate to CI. Runs a small Node scanner plus gitleaks.
---

# prepublish-leak-check

**What it does.** One pass for everything outbound. A secret scanner finds keys. This check also finds the quieter leaks that map your setup for a stranger: home paths, machine names, private IPs and tailnet hosts, scheduler labels, personal emails, and your real name in commit metadata. The goal isn't "no secrets in the repo". It's "nothing outbound that someone could use to find, copy or attack your setup".

Two tools, run together:

| Tool | Finds |
|---|---|
| [`scripts/leak-check.mjs`](scripts/leak-check.mjs) | 13 rules for keys **and** setup details, files that must never ship (`.env*`, `*.pem`, seed and wallet files, `*.plist`), commit authors that aren't a noreply address, and your own private terms. Prints `file:line: rule`, **never the matching text** |
| [gitleaks](https://github.com/gitleaks/gitleaks) | Several hundred known key formats, with entropy checks, in files and history |

The rules are listed with what they catch and miss in [references/patterns.md](references/patterns.md).

**Not covered:** rotating a secret after it leaked (do it; see step 6), who can access the repo, and images: a scanner can't read a screenshot.

## When to use

- Before `git push`, and always before a repo goes from private to public.
- Before pasting a log, an error, a config snippet or terminal output anywhere: an issue, a chat, a forum, a model.
- Before posting about something you built.
- When making a public copy of a private tool.

## Steps

### 1. Set up

```sh
node --version        # 20 or newer
gitleaks version      # 8.x; install from its releases page or your package manager
```

The scanner is `scripts/leak-check.mjs` in this skill's folder. It has no dependencies; run it from where it is, or copy it somewhere **outside** the folder you're checking. Below, `<skill>` means this skill's folder. Run the self-test once: `node <skill>/scripts/selftest.mjs` plants fakes in a temporary repo and expects `selftest: 31 ok, 0 failed`.

### 2. Write your private terms file (once)

The generic rules can't know your name, your hostnames or your project codenames. Put them in a file **outside every repo**, one case-insensitive regex per line, **no blank lines** (an empty line matches everything):

```sh
touch ~/.leakterms && chmod 600 ~/.leakterms
```

What to put in it, and how to check it loads: [references/leakterms.md](references/leakterms.md).

### 3. Run all three checks

From the folder you're about to publish:

```sh
LEAK_TERMS=~/.leakterms node <skill>/scripts/leak-check.mjs . --history; echo "exit=$?"
gitleaks git . --redact --no-banner; echo "exit=$?"     # every commit
gitleaks dir . --redact --no-banner; echo "exit=$?"     # files as they are now, committed or not
```

`leak-check.mjs` without `--history` checks the files git would publish (tracked, plus untracked files that aren't ignored). With `--history` it also checks every line ever added on any branch, and every file name ever committed. A key deleted in the last commit is still in the repo.

A real run always ends with a `leak-check:` summary line. Exit 0 is clean, 1 is findings, 2 is a usage error. No summary line means the script didn't run (a wrong path also exits 1), so check for it.

In a git repo, files git **ignores** are skipped, the same way they'd be skipped by a push. That's right for a push but wrong for a zip or a paste. Not a git repo, or packaging the folder some other way? Run it on a copy without `.git` (`rsync -a --exclude .git <folder>/ /tmp/out/`): then it walks every file, ignored ones included, and `gitleaks dir` does the same.

### 4. Read every hit

Each line is `where: rule`. Open the line and decide. A count tells you nothing: in one sweep of about 9,500 files, nearly every hit was a public token address or a transaction hash, and three were live keys. The only way to tell them apart is to read each one.

| It's a real secret or setup detail | It's harmless |
|---|---|
| Remove it. Read it from the environment instead, with a neutral default. If it was ever committed, go to step 6 | Change the text so it no longer matches (a placeholder like `<your key>`, a shorter example), so the next run is clean. Don't add an allow-list entry for a whole file |

### 5. Check the bits a scanner can't

- **Commit metadata:** `git log --all --format='%an <%ae>' | sort -u`. Every line should be your public handle with the host's noreply address. `leak-check.mjs` flags any other address, but only you can tell whether a *name* is your real one.
- **Screenshots and images:** prompt, hostname, path, tab titles, a second window, a notification. Crop to the one thing and look at every row of pixels, or post text you've read instead.
- **Logs and errors:** connection errors print full URLs, keys included. Redact at the logger, not when you copy: [references/redact.md](references/redact.md).
- **The bytes you publish are the bytes you checked:** after any copy or sync step, compare checksums (`shasum -a 256 <file>` on both sides).

### 6. If something real leaked

1. **Rotate it first.** Make a new key, switch to it, revoke the old one. Removing the text does not un-leak it: history, forks, caches, sync-service version history and search engines may hold the old value.
2. Then remove it from the files and, if the repo isn't public yet, rewrite history (or publish a fresh snapshot with a clean history instead).
3. Run all three checks again.

### 7. Make it automatic

Add the same checks to CI so a push can't skip them: [references/ci.md](references/ci.md). The [halfhand-skills](https://github.com/Beo-Halfhand/halfhand-skills) repo this skill comes from runs exactly these rules on every push.

## Safety rules

1. **Never print a secret to check it.** Check that a variable is set, not what it holds: [references/redact.md](references/redact.md) has a name-only printer. Never paste a key into a chat or a model to ask whether it's valid.
2. **Never weaken the check to get a pass.** No deleting a rule, no skipping a folder, no "allow" for a whole file. Change the matching text, or remove it.
3. **Keep `~/.leakterms` out of every repo.** It's a list of exactly what you don't want published. `leak-check.mjs` warns if the file is inside the folder it's checking.
4. **A clean run isn't permission.** It means these patterns didn't match. Read the diff of what you're publishing anyway.
5. **Redaction isn't rotation.** Anything that was ever written in plain text somewhere you don't control needs a new value.

## Report back

Tell the user:
- what was checked (folder, history or not, private terms or not) and the exit code of each of the three checks;
- every hit as `file:line: rule` with your decision (removed, rewritten, harmless and why). Never the matching text;
- the commit authors found;
- anything that needs rotating, said plainly at the top.

Tested on Node 26 and gitleaks 8.30.1, macOS arm64.
