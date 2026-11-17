# Adapters

The dashboard knows nothing about any game or agent framework. An adapter does: it reads one agent and returns a **Sample**. Everything else (history, graphs, lights, the map) is the same for every adapter.

## The Sample

Every field is optional. Return what you have.

```json
{
  "xp":       { "fishing": 182340, "smithing": 90211 },
  "doing":    { "label": "fishing", "detail": "harbour mackerel" },
  "position": { "space": "docks", "name": "Docks", "area": "the north pier" },
  "counters": { "coins": 412 }
}
```

| Field | Meaning |
|---|---|
| `xp` | A **running total** per skill (or any "work done" number that only goes up: tasks closed, pages read, tokens processed). The graphs show the gain between readings, spread evenly over the time between them. A total that drops (a reset) adds nothing |
| `doing` | Two short phrases: what, and on what. Up to 40 and 60 characters |
| `position` | `space` is a stable id (letters, digits, `- _ :`); `name` is what to show. If the adapter has a map and `space` is on it, that place is lit |
| `counters` | Up to 12 numbers shown on Details |

Before anything is stored, every Sample is cleaned: unknown fields dropped, sizes capped, text masked, odd characters refused. So an adapter can't put HTML, paths or long tokens on the page by mistake.

## Built in

### `command`: any program

```json
"adapter": "command",
"command": { "run": ["node", "status.mjs", "--json"], "cwd": "~/agents/helper", "env": ["HELPER_HOME"] }
```

Runs `run` (a list: program, then arguments; **no shell**) from `cwd` and parses one JSON Sample from stdout. Only `PATH`, `HOME` and the variable names in `env` are passed. Non-zero exit, no JSON, or no answer in 24 seconds is a failed read: the light goes yellow and Details shows the reason (masked). Keep it quick and read-only. It runs every `sampleMinutes`.

A status script can be four lines:

```js
// status.mjs
import fs from 'node:fs';
const s = JSON.parse(fs.readFileSync('state.json', 'utf8'));
console.log(JSON.stringify({ xp: { tasks: s.tasksDone }, doing: { label: s.current ?? 'idle' } }));
```

### `file`: the agent writes its status

```json
"adapter": "file",
"file": { "path": "~/agents/notes/status.json", "maxAgeMinutes": 20 }
```

The agent rewrites the file whenever it likes (write to a temp file and rename, so the dashboard never reads half a file). A file older than `maxAgeMinutes` counts as a failed read, so an agent that stopped writing doesn't look fine.

### `midnight-city`

See [midnight-city.md](midnight-city.md).

### `fake`

Simulated agents for the demo and the self-test: `{ "skills": ["fishing", "smithing"], "pace": 1, "offlineSince": <ms> }`. Numbers come from the key and the clock, so they are repeatable. It can't be mixed with real agents in one config.

## Writing your own

Add a module to `scripts/adapters/` and register it in `scripts/adapters/index.mjs` (`ADAPTERS`):

```js
// scripts/adapters/my-game.mjs
export const name = 'my-game';                       // "adapter": "my-game" in fleet.json
export const skillColors = { farming: '#008300' };   // optional: one colour per skill everywhere

export function check(agent) {                       // agent.opts = the agent's "my-game" object
  return typeof agent.opts.playerId === 'string' ? [] : ['"my-game".playerId is required'];
}

export async function sample(agent, ctx) {           // ctx.now (ms), ctx.timeoutMs
  const r = await fetch(`http://127.0.0.1:9000/players/${agent.opts.playerId}`, { signal: AbortSignal.timeout(ctx.timeoutMs - 1000) });
  if (!r.ok) throw new Error(`game API ${r.status}`); // thrown errors become the yellow light's reason (masked)
  const p = await r.json();
  return { xp: p.skills, doing: { label: p.activity }, position: { space: p.zone } };
}

export function map(agent) {                         // optional
  return {
    title: 'My Game',
    tiles: [ { id: 'farm', pos: 'nw', label: 'Farm' }, { id: 'town', pos: 'c', label: 'Town' } /* … */ ],
    rooms: { in: 'town', list: [ { id: 'shop', label: 'Shop' }, { id: 'inn', label: 'Inn', also: ['inn-upstairs'] } ] },
  };
}
```

Rules for every adapter:

- **Read only.** Never act, never connect a control session, never take a lease.
- **Never return or log** keys, tokens, account ids or home paths. If the source gives a private id (a room id, a session id), replace it with a generic `space` before returning, as the Midnight City adapter does for private rooms.
- **Time out.** `sampleOne` gives up after 25 seconds anyway, but a hung child process should be killed by you.
- **Be gentle.** The sampler reads agents one after another with a 0.3 s pause, every `sampleMinutes`. Don't add your own timers.

### The map

A schematic, not to scale. `pos` places a tile on a 3×3 compass (`nw n ne w c e sw s se`) or on a row of three underneath (`x1 x2 x3`). Use fewer tiles if you like. `rooms` are places inside one tile (buildings, rooms, sub-zones), drawn inside it. A room with `onlyIfHere: true` shows only when the agent is in it. A `space` that isn't on the map still shows, lit, as its own row under the map, by its `name`. The tile shows only the one agent, has no links or buttons, and lights nothing when the position is older than 20 minutes.
