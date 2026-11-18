# Pause with expiry

Hand an agent to someone else (a script, a test, a person) without the agent's own loop fighting them, and without a crashed script leaving it frozen.

## The driver side

```js
import { watchPause } from './lib/pause.mjs';
const pause = watchPause(DIR, {
  intervalMs: 5000,
  onPause: async (p) => { await stopHelpers(); await stopWork(); const idle = await waitIdle(60_000); return { stoppedWork: true, released: idle }; },
  onRenew: async (p) => log(`pause renewed by ${p.by}`),
  onResume: async ({ by, expired, since }) => log(expired ? `PAUSE expired (by ${by})` : 'resumed'),
  onStale: async (p) => log(`WARN PAUSE by ${p.by} has no end time and is over an hour old`),
});
// main loop: if (pause.paused) skip every action that changes anything
```

- **Its own timer.** A main loop that is inside a long job can't see a file. The first version checked PAUSE in the loop; a slow startup step held the loop and a whole pause came and went unseen.
- **No re-entry.** `onPause` can take longer than one interval (waiting for idle). The watcher never runs two ticks at once; an early version released twice.
- **Remember which pause you answered.** Back-to-back runs wrote a new PAUSE before the old RELEASED was cleared, and the second caller read the old release as its own. RELEASED.for = the PAUSE's `at`, and a renewed or replaced PAUSE gets a fresh RELEASED (without a second hand-off).
- **Pausing the loop isn't releasing the agent.** Stop helper processes it spawned (they don't see PAUSE), stop the job in the world (it keeps running), and wait for idle. Old drivers noticed PAUSE mid-step and still finished by walking the held agent back to work.
- **The driver never deletes PAUSE.** It isn't its file. An expired PAUSE just stops counting; the owner or the script that wrote it removes it.

## The caller side

```js
import { hold } from './lib/pause.mjs';
const h = await hold(DIR, { minutes: 20, by: 'race-script' });   // always an end time; Ctrl-C / SIGTERM / SIGHUP remove it
if (!h.ok) { console.error(h.reason); process.exit(1); }          // no release in time: fail cleanly, don't act
for (const step of steps) { if (!h.stillMine()) break; await step(); }
fileHandback(EVENTS, 'race-script', 'You ran the harbour race in 3:05 and came second.');
h.done();                                                         // removes PAUSE only if it is still ours
```

- **Always set `until`.** Two takeover loops typed into a remote terminal died when the connection dropped and left two agents held for up to an hour. Run takeovers in the background (a tmux tab, `nohup`), and always with an end time.
- **At `until` the driver takes the agent back, even mid-task.** Ask for enough minutes, or renew (a new PAUSE with a later `until`). `stillMine()` turns false at that moment.
- **Wait for the release, with a bound.** Default 6 minutes (`HOLD_WAIT_SECONDS`). No release: remove your PAUSE and don't act, or you'll fight the driver.

## For a person

```sh
node controls.mjs pause <agent dir> 30 --by me      # or city-driver-starter's pause.mjs: same files
node controls.mjs pause <agent dir> off
```

A bare `touch PAUSE` works too (no end time: paused until deleted). `doctor` and the driver flag it once it's over an hour old (`PAUSE_STALE_MIN`).

## Watchdogs and dashboards
- **Paused is yellow, not red.** A "log silent for N minutes" alarm must allow for paused time and for the longest normal job. When you make a job longer, change the alarm in the same step: a longer work block once set off a false "silent" alarm every block for a morning.
- **Expired is not paused.** Anything that shows "paused" should check `until` (`isPaused()`), not only whether the file exists. fleet-dashboard's page does this, and the self-test checks that it agrees with `isPaused()`.
- **Check the right folder.** One stranded hold was missed for an hour because someone checked the wrong agent's folder. `controls.mjs status` reads the folder you give it and says which pause it found.
