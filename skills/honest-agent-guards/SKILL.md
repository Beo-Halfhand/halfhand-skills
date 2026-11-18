---
name: honest-agent-guards
description: Add honesty checks to an AI agent that talks to people, so it stops sending made-up claims. Every line the agent wants to send is checked before it goes out against two things. The first is a banned list in a markdown file you edit while the agent runs: claims no agent may make (invented price swings, queues, stock phrases it keeps repeating) and place names that must be on your map. The second is the agent's own state: a level, a count or a piece of gear it claims must match what it really has, and it may only say it does what it really does (no invented crafting, trading, owning, other skills or weather). A refused line gets one redraft with the reason, then the bad sentences are dropped, else nothing is sent. Zero dependencies, pure functions plus a command line. Built for Midnight City agents and usable for any talking bot. Use for "my agent makes things up", "stop my bot inventing facts", "check replies before they're sent", "my agent keeps repeating the same line", or "audit what my agent said".
---

# honest-agent-guards

**What it is.** [`scripts/guards.mjs`](scripts/guards.mjs) is one file of checks a talking agent runs on every line before it sends it. It has no dependencies and works on Node 20+. Small models on a busy machine say things that sound right but aren't true: "Merchant prices drift about 15% in a few minutes", "I craft cinder axes at the tree stands" (from a woodcutter that crafts nothing), "Still waiting on my own turn", "the weather we've been having". A prompt rule alone doesn't stop this. These checks do: a line that fails is never sent as it is.

| Check | Refuses | From |
|---|---|---|
| **Banned claims** | a sentence that matches a line in your list, such as a percentage on price drift, an invented queue or a stock phrase | your list (markdown, re-read when it changes) |
| **Places** | a capitalized place name that isn't on your map, unless the other side said it first | your list's map |
| **Levels and gear** | a level for itself that isn't its real level, a target level ("up to level 20"), gear it doesn't carry, a wrong count | the agent's state |
| **Invented actions** | "I craft…", "I sell…", "my shop…", "I fish…" when its state says otherwise, and weather | the agent's state |

Around them, one loop, `guard()`:
1. Check the line. If it's clean, send it.
2. If it's refused, ask the model for **one** redraft and give it the reason in plain words. Check the redraft against everything.
3. If the redraft is still bad, or there isn't one, drop the refused sentences.
4. If too little is left (under 25 characters), **skip**: send nothing.

**Not covered:** writing the replies, or choosing who to talk to. Bring your own model and driver; this skill sits between them and "send". It doesn't make a weak model good: it stops what it can recognise, and the misses are listed in [references/limits.md](references/limits.md). Read that before you trust it.

## When to use

- An agent that talks to strangers (a Midnight City agent, a chat bot, a support bot) says things about itself or the world that aren't true.
- It keeps repeating one phrase, often one it copied from your prompt.
- You want to audit what it already sent: `guards.mjs scan` over its log.

## Steps

`<this skill>` means the folder that holds this SKILL.md.

### 1. See it work (no setup)

```sh
node --version                                  # 20 or newer
node <this skill>/scripts/selftest.mjs          # expect: selftest: 73 ok, 0 failed (about a second)
node <this skill>/scripts/demo.mjs              # six made-up drafts through the loop, with a stand-in model
```

The demo shows each outcome: a clean line, a redraft, a trimmed line and a skip.

### 2. Copy it out and make your list

```sh
mkdir -p ~/agent-guards && cp <this skill>/scripts/guards.mjs <this skill>/scripts/example-list.md ~/agent-guards/
cp ~/agent-guards/example-list.md ~/agent-guards/my-list.md
node ~/agent-guards/guards.mjs list --list ~/agent-guards/my-list.md          # every line, ✓ on, – off, ✗ broken
```

The example list holds five claims, one listed place and the Midnight City map, as read on 2026-11-16. All of them came from real replies. Keep what fits your agent, delete what doesn't, and add a line each time you catch a new invention. The format is in [references/list-format.md](references/list-format.md). Not a City agent? Replace the map with yours, or delete the map section to check only the places you list.

### 3. Describe what your agent really is (its state)

The state checks need a small object, fresh before each reply, made from what the agent can actually read about itself:

```json
{ "specialty": "woodcutting", "levels": { "woodcutting": 9 }, "inv": { "cinder_axe": 1, "wood_log": 40 },
  "crafts": [], "trades": ["meme coins", "food"], "ownOk": [], "world": false }
```

Every field and where to get it, for a City agent and for any other bot: [references/state.md](references/state.md). **Read the state, don't type it.** Levels and inventory typed by hand go stale and the checks will refuse true lines. A field you leave out is a field it can't check.

Try lines against it before you wire anything:

```sh
cd ~/agent-guards
node guards.mjs check "I'm level 30 in woodcutting now." --list my-list.md --state state.json
#   refused: state:level:woodcutting 30
#     tell: gives a level for yourself that is not yours (woodcutting 30). Your levels right now: woodcutting 9. …
node guards.mjs check "I cut wood at the tree stands." --list my-list.md --state state.json        # ok
```

Exit code: 0 ok, 1 refused, 2 a usage error.

### 4. Put the loop in front of "send"

```js
import { fileURLToPath } from 'node:url';
import { guard, loadList } from './agent-guards/guards.mjs';   // relative to your driver's file

const list = loadList(fileURLToPath(new URL('./agent-guards/my-list.md', import.meta.url)));   // cached; re-read when the file changes
const r = await guard(draft, { list, self: myState(), them: theirMessage, name: theirName }, {
  redraft: async (reason, line) => askModel(`${prompt}\n\nYour last try was rejected (it ${reason}): "${line}". Write a different reply that answers what they actually said.`),
});
if (r.skip) log(`skipped: ${r.why}`); else send(r.line);   // log r.how and r.why every time
```

- `redraft` is your model call. It gets the reason (written to finish "it …") and the refused line, and returns a new line or `null`. If it throws, that counts as no redraft.
- `extra(line)` (optional) is your own other checks, run on the redraft too, so a redraft can't pass this check by breaking another.
- **Always pass `them` and `name`.** They let the agent answer a subject the other side raised ("is there a queue?"), and they stop names that look like places from being refused.

The whole contract, the log lines to keep and how to wire it into a driver: [references/the-loop.md](references/the-loop.md). For a Midnight City agent, see [references/midnight-city.md](references/midnight-city.md).

### 5. Audit what it already sent

```sh
node guards.mjs scan sent.jsonl --list my-list.md --state state.json
#   12: banned:B01  Merchant prices drift about 15% in a few minutes…
#   scan: 3 of 410 line(s) refused · banned:B01 2, invented:craft 1 · your list · 5 claims · …
```

The file holds one line of text per line, or JSONL with `text` (and `them`, if you have it). Run a scan after every list or prompt change, and once a day on what was really sent. A rise in one reason means the model has found a new habit, so add a line for it.

## Safety rules

- **Never send a line the checks haven't seen.** That includes canned fallbacks and redrafts: `guard()` checks a redraft before accepting it.
- **Skip rather than send a fragment.** A reply that's mostly refused is skipped. Don't lower `minLen` to force something out.
- **The reason goes to the model, never to the other person.** The tells say what was wrong; they never quote a sentence to copy. A quoted example in a prompt gets sent word for word: that's how S01 in the example list started.
- **The state comes from the agent's own reads**, never from what the other side claims about it.
- **Keep the list free of secrets and personal details.** It's a file of patterns and place names. Sources can say *what* was caught; don't paste whole conversations or other people's handles into it if you'll share it.
- **These are checks, not proof.** A passing line can still be wrong. Read [references/limits.md](references/limits.md).

## Report back

When you set this up for someone, tell them:
- the self-test line and what the demo printed;
- which list it reads (path and the `list` tag line), and which state fields you filled and from where;
- where the loop sits (the file and the function), and that every send goes through it;
- the first `scan` of their agent's past lines: how many were refused, by reason;
- what it can't catch for their agent (from limits.md), in one or two lines.

## More

- [references/list-format.md](references/list-format.md): the list file, line by line; regenerating the map
- [references/state.md](references/state.md): every state field, and where a City agent or any bot gets it
- [references/the-loop.md](references/the-loop.md): `guard()`, `checkLine()`, `tell()`, `dropBad()`, `scan()`; what to log
- [references/midnight-city.md](references/midnight-city.md): wiring it into a City agent's reply path
- [references/limits.md](references/limits.md): what it misses and what it gets wrong

## Status

**In development.** Generalised from two libraries in daily use on a fleet of talking Midnight City agents: `banned-claims` v0.1.2 (the list, places, levels and gear, the stock-line catch) and `action-claims` v0.1.0 (invented actions, built from crew samples on 18 November 2026). Fleet-specific parts became settings: the allowed trades, the crew line, the place-name lead words (now taken from your map) and the item catalog. Tested on Node 26, macOS arm64: `selftest.mjs` 73/73, including the 29 crew-sample cases. On 2,034 lines the fleet really sent, it gives the same verdict as the fleet libraries on every line but four. Those four address a player whose name looks like a place ("…, Concord Forge."), and this version lets them through. Porting it found two bugs in the originals, fixed here: "mining" counted as the requirement word "min.", so a false level after "mining" passed, and "My …" at the start of a sentence wasn't first person, so "My mining is level 30" wasn't checked.
