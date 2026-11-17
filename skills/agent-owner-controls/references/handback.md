# Handback memory

**The problem.** An agent's memory is usually written by one process, its main loop. When a script or a person drives the agent, the loop is paused, so nothing records what the body did. Later someone congratulates the agent on a race it won, and it has no idea what they mean. It isn't a model problem: nothing ever told it.

**The fix.** Every hold files a one-line note before it lets go. The driver reads notes in when the pause ends and keeps a short "recent self" block in its prompts.

## Filing a note (whoever held the agent)

```js
import { fileHandback } from './lib/handback.mjs';
fileHandback(EVENTS, 'race-script', `You ran the harbour race in ${time} and ${won ? 'won' : 'did not place'}.`, { pin: won });
```

or from a shell script:

```sh
node controls.mjs handback ~/agents/scout/events.jsonl --by race-script --pin "You ran the harbour race and won."
```

- **Second person, outcome first.** "You ..." drops straight into a prompt; third-person log lines get paraphrased badly or ignored.
- **One line, at most 300 characters, no ids, paths or keys.** It may be said to strangers. `fileHandback` masks keys and home folders and clamps the length anyway.
- **`pin`** keeps it 72 hours instead of 24 (a win, a milestone).
- **File before you let go**, not after: once PAUSE is gone the loop may already be building its next prompt. File in your Ctrl-C path too, even if it's just "You were interrupted during the race."
- `events.jsonl` is append-only: one whole line per write, nobody edits lines. Past `CONTROLS_LOG_MAX_KB` (default 1024) it rolls to `events.1.jsonl`, replacing the older part, and readers (`recentSelf`, `ingestHandbacks`) read both parts, so a pinned note survives a roll.

## Reading notes in (the driver)

```js
onResume: async ({ by, since }) => {
  const { events, placeholder } = ingestHandbacks(EVENTS, { since, by, timeZone: OWNER_TZ });
  for (const e of events) log(`HANDBACK from ${e.by}: ${e.text}`);
}
// building a prompt:
prompt += '\n' + promptBlock(recentSelf(EVENTS));   // last 24 h (pinned 72 h), newest first, 5 lines at most
```

- **No hold leaves no trace.** If nothing was filed since the pause began, `ingestHandbacks` files an honest placeholder itself: "You were held by test-script from 21:00 to 21:12 UTC; details unknown." Never a guessed story: an invented result is worse than none.
- **Keep "recent self" tight.** A few lines, a day's window. A long list crowds out the conversation and invites the model to bring up old news unprompted.
- The PAUSE carries the holder's name (`by`), so the placeholder can say who.

## Checking it works
The bar used when this ran live: every hold logged, and the first related conversation mentions it. Count holds against `HANDBACK` lines daily; a hold without a line is a bug that day. Roll the helper into every driver and every takeover script: the same gap exists for every agent anything ever holds. Backfill once by hand when you start.
