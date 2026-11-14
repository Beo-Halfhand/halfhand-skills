# PAUSE and RELEASED

Two small files in the driver's folder let a person or another script take the agent without fighting the driver.

**PAUSE** (written by you or `pause.mjs`): JSON, all fields optional.

```json
{"by": "me", "at": "2026-11-14T18:00:00.000Z", "until": "2026-11-14T18:30:00.000Z"}
```

- `until`: when it passes, the driver resumes on its own. **Scripts must always set it**, so a crashed script can't leave the agent frozen. `pause.mjs` always does.
- No `until` (or an empty file from `touch PAUSE`): paused until someone deletes the file.
- `at`: identifies this pause. Missing, the file's modified time is used.

**RELEASED** (written by the driver): `{"at", "for", "by", "stoppedWork", "released"}`, plus `"dryRun": true` from a dry run. `for` is the PAUSE's `at`, so a caller knows the answer is for its own pause, not an older one. `released: true` means the driver disconnected and the agent is free to connect to. `released: false` means its disconnect failed: don't connect (`pause.mjs` exits 3). A dry run holds no control, so there's nothing to release (`released: null`).

## What the driver does

1. It looks for PAUSE at the start of every tick and every 5 seconds while it waits. So it answers within about 5 seconds once its current call returns; a slow helper call, or a slow model (`words.timeoutSeconds`), can make that longer.
2. On a PAUSE: reads `context`; if the agent is working, sends `stop-work`; sends `disconnect`; writes RELEASED; logs `paused` once. It never reconnects during this hand-off.
3. While paused it sends nothing at all. A new or extended PAUSE (a second `pause.mjs`, a re-`touch`) is answered with a fresh RELEASED and a `pause_renewed` line; still nothing is sent, so it never stops your own work.
4. When PAUSE is gone or past `until`: logs `resumed` or `pause_expired`, deletes RELEASED, connects again, and goes on. **At `until` that happens even if you're mid-play.**

## When a person takes over

After RELEASED, connect and play with the City's helper as usual. Before you give the agent back, `disconnect` (from the City's skill folder), then `node pause.mjs <driver folder> off`. If you forget, the driver's connect takes control from your session anyway: control is exclusive.

## For a script that takes the agent

```js
// write PAUSE with an end time, then wait for RELEASED.for === your at
const at = new Date().toISOString(), until = new Date(Date.now() + 20 * 60e3).toISOString();
fs.writeFileSync('my-driver/PAUSE', JSON.stringify({ by: 'my-script', at, until }));
// … poll my-driver/RELEASED until JSON.parse(...).for === at, give up after a few minutes …
// … connect, do your thing, disconnect …
fs.rmSync('my-driver/PAUSE');            // and on SIGINT/SIGTERM too
```

`pause.mjs` does exactly this for a person at a terminal.

**Tell the agent's memory what happened.** If your own bot keeps notes about its day, the time it was paused is a gap it knows nothing about. Have the script that took it write a short note it can read back.
