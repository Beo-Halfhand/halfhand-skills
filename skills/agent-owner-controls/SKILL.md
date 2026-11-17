---
name: agent-owner-controls
description: Give an AI agent's owner four controls through plain files, so any driver in any language can honour them. pause-with-expiry (a PAUSE file with an end time, a RELEASED handshake, automatic resume, a stale-pause warning); ask-the-owner (the agent drafts, the owner answers ok, own words or skip, a default fires on silence, every line passes a gate first); handback-memory (whoever held the agent leaves a "while you were away" note for its prompts); owner-limits (one policy file checked before every action: caps in the owner's time zone, persisted spend, floors, allow lists, needs-the-owner actions, on/shadow/off, STOP, expiry, freeze, a rogue test). Node, no dependencies, a one-command demo, a self-test that forces each refusal. Shares fleet-dashboard's asks format and city-driver-starter's PAUSE format. Use for "pause my agent", "take over my bot safely", "ask me before it spends", "human in the loop", "my agent forgot what happened while paused", "spend limits", "kill switch" or "agent guardrails".
---

# agent-owner-controls

**What it is.** An agent that runs on its own needs an owner who can step in: take it for a while, be asked before it does something that matters, tell it what happened while it was away, and set limits it can't talk its way past. This skill is those four controls as **files with one writer each**, a small Node library for the agent's side, and a command line for the owner's side.

| Control | The owner can | The files |
|---|---|---|
| **pause-with-expiry** | take the agent for N minutes; it hands off, confirms, and takes itself back when the time is up | `PAUSE` (owner or a script), `RELEASED` (the driver) |
| **ask-the-owner** | be asked before a reply or an action; answer ok, own words or skip; silence has a default per kind of ask | `<asks>/<id>.json` (agent), `<asks>/answers/<id>.json` (owner side), `<asks>/done/` |
| **handback-memory** | have whoever held the agent leave a one-line note, so the agent knows what it did while paused | `events.jsonl` (append-only) |
| **owner-limits** | cap spend per action, day and week, block actions and counterparties, require the owner for some actions, stop everything | `policy.json`, `STOP` (owner), `spent.json`, `refusals.jsonl` (agent) |

The whole protocol, file by file: [references/protocol.md](references/protocol.md).

**Fits with:** [fleet-dashboard](../fleet-dashboard/) shows the asks inbox and lets the owner answer with a click (the format is fleet-dashboard's; this skill imports its code instead of copying it). [city-driver-starter](../city-driver-starter/)'s driver already speaks the PAUSE/RELEASED half; its `pause.mjs` works against this skill's driver side too (the self-test checks both ways).

**Not covered:** limits that hold against an agent that controls its own machine (see "Enforced outside the agent" below), multi-machine fleets, and chat-app bridges (the owner side here is files, the dashboard or this command line).

## When to use
- Two things can drive the same agent (its loop and a script, or its loop and a person) and they fight.
- A takeover script crashed and left the agent frozen.
- The agent should check with its owner before some replies or spends, and the owner may be asleep.
- The agent talks as if a race, a job or a test it was driven through never happened.
- The agent will spend or send things unattended, or a limit fired and nobody can say why.

## Steps

**Before you start.** `<this skill>` means the folder that holds this SKILL.md. It needs Node 20+ and its sibling skill [fleet-dashboard](../fleet-dashboard/) next to it (`../fleet-dashboard/`): the library imports its asks and masking code. The plugin installs them together. If you copy skills by hand, copy both folders, or every step fails with `ERR_MODULE_NOT_FOUND ... fleet-dashboard/scripts/lib/asks.mjs`. The self-test also uses [city-driver-starter](../city-driver-starter/) when it's there.

### 1. See it work (about 20 seconds, nothing real touched)

```sh
node <this skill>/scripts/demo.mjs
```

A made-up agent, `scout`, in a temporary folder: caps and a floor refuse, three asks (one answered with words that hold a key, so the gate blocks them; one silent friendly ask whose draft goes out; one money ask the owner approves), a script takes the agent and files a note, a hold that files nothing gets an honest placeholder, a PAUSE runs out and the agent takes itself back, STOP, and the rogue test. `--keep` keeps the folder.

### 2. Check the setup

```sh
node --version                                   # 20 or newer
node <this skill>/scripts/selftest.mjs           # expect: selftest: 118 ok, 0 failed
```

The library imports fleet-dashboard's `scripts/lib/asks.mjs` and `mask.mjs`, so keep this skill next to [fleet-dashboard](../fleet-dashboard/) (the plugin installs them together). The self-test also runs city-driver-starter's `pause.mjs`.

### 3. Give the agent a folder and a policy

```sh
mkdir -p ~/agents/scout ~/agents/asks && chmod 700 ~/agents/scout ~/agents/asks   # the agent's folder and the asks inbox
cp <this skill>/scripts/policy.example.json ~/agents/scout/policy.json
node <this skill>/scripts/controls.mjs doctor ~/agents/scout
```

The example starts in `"mode": "shadow"`: it logs what it **would** refuse and blocks nothing, so you can read real would-refuse lines before switching to `"on"`. In shadow mode the rogue action gets through, so `doctor` reports FAIL and exits 1: that's expected until you switch to `"on"`. Set `"expires"` to a date a few months ahead: after it, everything is refused until you renew it (`doctor` warns a week before). Every field: [references/limits.md](references/limits.md).

### 4. Wire the driver (the agent's loop)

Import the library by **absolute path** from your own project, and keep the skill folders where they are (don't copy `lib/` alone: it imports fleet-dashboard). `stopHelpers`, `stopWork`, `waitIdle`, `log`, `doIt` and `say` are yours: your agent's own functions.

```js
const L = '/absolute/path/to/agent-owner-controls/scripts/lib';   // <this skill>/scripts/lib
const { watchPause } = await import(`${L}/pause.mjs`);
const { createLimits } = await import(`${L}/limits.mjs`);
const { makeGate } = await import(`${L}/gate.mjs`);
const { openAsk, openAsks, resolveAsk, closeAsk, outcomeLine, approvalFrom } = await import(`${L}/asks.mjs`);
const { ingestHandbacks, recentSelf, promptBlock } = await import(`${L}/handback.mjs`);

const HOME = process.env.HOME, DIR = `${HOME}/agents/scout`, ASKS = `${HOME}/agents/asks`, EVENTS = `${DIR}/events.jsonl`;
const limits = createLimits(DIR);
const gate = makeGate({ maxChars: 280, banned: ['guaranteed'] });
const pause = watchPause(DIR, {                       // its own 5 s timer, never inside the main loop
  onPause: async (p) => { await stopHelpers(); await stopWork(); return { stoppedWork: true, released: await waitIdle() }; },
  onResume: async ({ by, since }) => { for (const e of ingestHandbacks(EVENTS, { since, by }).events) log(`HANDBACK from ${e.by}: ${e.text}`); },
});

async function act(name, ctx) {                       // every action that changes anything goes through here
  if (pause.paused) return false;
  const c = limits.check(name, ctx);
  if (!c.ok) {
    log(`REFUSED ${name} [${c.rule}] ${c.reason}`);
    if (c.rule === 'human') openAsk(ASKS, { id: `A${Date.now()}`, agent: 'scout', kind: 'money', minutes: 30, onTimeout: 'nothing',
      question: `May I ${name}${ctx?.amount ? ` ${ctx.amount}` : ''}?`, action: { name, ...ctx } });   // an "ok" in time approves exactly this
    return false;
  }
  await doIt(name, ctx); if (ctx?.amount) limits.record(ctx.amount); return true;
}
setInterval(async () => {                            // your loop: resolve asks; say only what the gate passes; act only on an approval
  for (const ask of openAsks(ASKS, 'scout')) {
    const r = resolveAsk(ASKS, ask, { gate });
    if (r.status === 'waiting') continue;
    if (r.say) await say(r.say);
    const ap = approvalFrom(ask, r); if (ap) await act(ap.name, ap.ctx);
    log(outcomeLine(ask, r)); closeAsk(ASKS, ask, outcomeLine(ask, r));
  }
  // … then your agent's own work, every change through act()
}, 5_000);
// prompts: prompt += promptBlock(recentSelf(EVENTS));
```

Each piece, with the reasons behind it: [references/pause.md](references/pause.md), [references/asks.md](references/asks.md), [references/handback.md](references/handback.md), [references/limits.md](references/limits.md).

**Another language?** It's all files: write the same JSON from Python, Go or a shell script. The formats are in [references/protocol.md](references/protocol.md).

### 5. The owner's side

```sh
C="node <this skill>/scripts/controls.mjs"
$C pause ~/agents/scout 30 --by me     # waits for RELEASED (up to PAUSE_WAIT_SECONDS, default 120); exit 0 = yours until the end time, 1 = no answer, 3 = not handed back
$C pause ~/agents/scout off            # give it back
$C status ~/agents/scout --asks ~/agents/asks --events ~/agents/scout/events.jsonl
$C asks ~/agents/asks                  # open asks: thread, draft, deadline, default
$C answer ~/agents/asks A12 own "Sell 5, keep 5."
$C stop ~/agents/scout                 # everything except read-only actions refused; "start" to undo
$C unfreeze ~/agents/scout
$C rogue ~/agents/scout                # schedule this hourly: exit 2 = the limits let a forbidden action through
$C doctor ~/agents/scout
```

With [fleet-dashboard](../fleet-dashboard/), point its `asksDir` at the same asks folder and its `pauseFile` at the agent's `PAUSE`: the owner answers from the page instead.

## The rules that make it hold
1. **One writer per file.** The owner writes PAUSE, STOP and policy.json; the driver writes RELEASED, spent.json and refusals.jsonl (one exception: `controls.mjs unfreeze` clears the freeze latch in spent.json, so unfreeze while the agent is paused or idle); the agent writes asks, the owner's side writes answers. The only shared file, events.jsonl, is append-only. Nobody edits a file they don't own. The two logs (refusals.jsonl, events.jsonl) roll to `<name>.1.jsonl` past 1 MB (`CONTROLS_LOG_MAX_KB`), so they never grow without bound.
2. **Every pause ends.** Scripts always set `until`; a crashed script can't strand the agent. A PAUSE with no end time (a person's `touch PAUSE`) is honoured and flagged once it's an hour old.
3. **Only a release for your own pause counts.** RELEASED.for equals the PAUSE's `at`; a caller never acts on an older release. A holder checks `stillMine()` before each action: at `until` the driver takes the agent back, even mid-task.
4. **The owner's words are data, not commands.** An owner answer becomes speech only after the gate (length, banned words, nothing that looks like a command, a key or a home folder, plus your own checks). Only an in-time "ok" to an ask that named an action approves that exact action, and only when the policy has `"approvals": "asks"`. Every limit still applies.
5. **Silence has a default per kind of ask.** Friendly replies may send their draft; anything with money, items or commitments does nothing. A late answer is logged, never acted on.
6. **No hold leaves no trace.** If a takeover filed no note, the driver files "You were held by X from 21:00 to 21:12; details unknown." It never guesses.
7. **Fail closed.** No valid policy.json refuses everything. An unknown field in it (a typo) refuses everything and says which.
8. **Test the "no".** A guard you've never seen refuse is untested: run `controls.mjs rogue` on a schedule.

## Enforced outside the agent
Files on the agent's own machine stop mistakes and runaway loops. They don't stop an agent that can edit its own files: it could rewrite `policy.json`, delete `STOP` or reset `spent.json`. For anything that spends real money, keep `policy.json` and `STOP` in a folder the agent's user can only read (owned by another user), and put the same rules where the agent can't reach them: a gateway in front of the payment system or a contract that holds the funds. `doctor` warns when the agent's user can write the policy. Details in [references/limits.md](references/limits.md).

## Report back
Tell the owner: the agent folder and asks folder, the policy's mode and caps, the `doctor` result, how to pause (`controls.mjs pause <dir> 30`), how to answer asks (command or dashboard), and that `rogue` should be scheduled.

## Safety rules for the agent running this skill
- Never write or loosen `policy.json` for the owner without their explicit OK, and never switch `mode` to `"on"` or `approvals` to `"asks"` on your own.
- Never delete someone else's PAUSE, STOP or answer file.
- Never put a real key, wallet, account or person into an ask, a handback or a policy example.

## Status
**In development.** Merged from four drafts that were each tested by a fresh agent on a clean folder (2026-10-26, all pass with fixes, fixes done) and run live with a fleet of game agents; rewritten here as one library on shared files. Tested on Node 26, macOS arm64: `selftest.mjs` 118/118 (pause, asks, gate, handback, limits, log rolling with four writers at once, the command line, fleet-dashboard's asks code and city-driver-starter's driver and `pause.mjs`). Also run by a fresh agent following only this file on Node 22, Debian 12 (a container): demo, self-test, a small agent wired to all four controls, and every owner command.
