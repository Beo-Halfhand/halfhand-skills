# After a leak

A key reached a terminal, a log, a synced folder, a CI log or a chat. In this order:

## 1. Rotate

Make a new key, switch your programs to it, check they work, then **revoke the old one**. Do this first, before cleaning anything:

- copies in synced folders live on in the version history and on every device;
- backups, CI logs, chat messages and other people's scrollback can't be recalled;
- once the old key is revoked, every copy is harmless.

While you switch, keep the new value off the screen too. Paste it at a hidden prompt (`read -rs`), write it straight into a mode-600 env file, and check it with a fingerprint, not by printing it:

```sh
printf %s "$NEW_KEY" | shasum -a 256 | cut -c1-8
```

## 2. Count the copies (without printing them)

```sh
node count-copies.mjs --var OLD_KEY --env-file ~/secrets/old.env ~/logs ~/notes ~/project
```

For each file it prints how many **whole** copies and how many copies of the **first 12 characters** it holds. A cut-off or wrapped copy still counts. It never prints the value or a line of the file. It walks folders, skips `.git` and `node_modules`, reads binary files too, and doesn't follow symlinks. Exit 1 means copies were found.

Look in: your logs folder, shell history (`~/.zsh_history`, `~/.bash_history`), terminal mirrors and transcripts, synced notes, the project folder (untracked files too), and `/tmp`. Check git history separately with a secret scanner (`gitleaks git`).

## 3. Clean

```sh
node mask-pipe.mjs --count < old.log > old.log.masked && mv old.log.masked old.log
```

`masked-lines=N` on stderr tells you how many lines changed. Then count again: 0 whole copies.

- **Git history:** rewriting it is a last resort (it breaks every clone). With the key rotated, removing it from history is tidy-up, not safety.
- **Synced folders:** cleaning the current file doesn't clean its old versions. The rotation already made them harmless.

## 4. Stop it happening again

Find which way it got out ([where-leaks-come-from.md](where-leaks-come-from.md)) and close that path:

- an import of `mask-stdio.mjs` first;
- a pipe around the script;
- `safeDestination()` for a direct-writing logger;
- the key in a header instead of a URL;
- a refuse-to-print-to-a-terminal guard;
- no `-x`.

Add the key's variable name to `SAFE_LOGS_SECRET_VARS`, so even a shapeless value is masked exactly.

Write down what happened, where the copies were, and that the old key is revoked. Write the variable **name**, never the value.
