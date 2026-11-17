# Keeping the logs folder private

`MW_HOME` (default `~/mirrored-workspace/`) holds a record of everything that crossed your terminals: commands, file paths, machine and network names, error messages, and whatever the masker didn't recognise. Treat it as private even when the masker is doing its job.

## Never
- **In a public repo, or any repo that gets pushed.** If `MW_HOME` is inside a git work tree, ignore it (`logs/` and `snapshots/` in `.gitignore`). `mw doctor` fails if it isn't ignored.
- **Behind a public link.** "Anyone with the link" shares get forwarded, pasted into chats that fetch previews, and indexed, and they keep working long after you forget them. There is no safe public link to a log folder.
- **In a shared or team folder.** Everyone with access gets your terminal history, and so do their devices and backups.

## Synced, carefully
Syncing the folder to your own cloud storage lets an assistant on another machine read it. That's fine only if:
- the synced folder is yours alone (not shared with anyone),
- you're comfortable with that provider holding your terminal history,
- your own terms are in `MW_MASK_EXTRA` (machine names, network names, internal hostnames),
- you never create a share link to it.

`mw doctor` warns when `MW_HOME` is inside a known synced folder, so the choice is deliberate.

## Retention
Logs older than `MW_LOG_KEEP_DAYS` (14) are deleted on every snapshot run. Shorter is safer: keep only what you'd actually go back to read.

## Before sharing a log line
To show someone an error, copy the few lines you need, read them, and check for names you don't want out. Run anything longer through `mw mask` and read it again before it leaves your machine.

## If something leaked anyway
1. Rotate the key. Assume every copy (sync history, backups, anyone who saw it) has it.
2. `mw scrub` the folder.
3. Delete old versions in the sync provider's version history.
4. Add the shape to `MW_MASK_EXTRA` if the masker missed it, and check: `printf '%s\n' '<a fake with the same shape>' | mw mask`.
