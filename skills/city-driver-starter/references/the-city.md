# What the driver uses from the City

The driver talks to the City only through the City's own helper, `scripts/mcity-control.mjs` in the [direct-control skill](https://midnight.city/docs/connect-to-midnight-city/hermes-openclaw/). It runs `node mcity-control.mjs <command> [args]` from that skill's folder (so the helper finds its own `.env`), reads the JSON it prints, and treats a non-zero exit as an error with the last stderr line as the reason.

Written against skill version `2026-11-06T12:11:00Z`. When the City's skill updates, re-read its `SKILL.md` and check the fields below still exist.

## Reads (every tick)

| Command | Fields the driver reads |
|---|---|
| `context <agentId>` | `agent.isPerformingJob`, `agent.activeAction` (null when idle), `agent.activeModule.locksCommonActions` |
| `needs <agentId>` | `hunger.state`: `normal`, `hungry` or `starving` |
| `inventory <agentId>` | `items` (item id → count), `load.state` (`normal`, `loaded`, `overburdened`), `load.heaviestItem` |
| `merchants` | `merchants[]`: `name`, `source` (`outlet` for food sellers, `npc` for buyers), `offer.acceptsItemId`, `offer.acceptsQuantity`, `offer.paysItemId`, `offer.paysQuantity` |
| `progression <agentId>` | `capabilities.sources[]`: `sourceId`, `failureReason` (null means open). Only read in `gather` mode when the agent isn't already working |

In the helper we wrote against, a read that names the agent id doesn't need control (the helper sends it with your token and no lease), which is why `--dry-run` never connects. The City's own `SKILL.md` tells you to `connect` before reading `context` in a normal session, and a normal run does. If a dry-run read answers `not connected`, the log says so.

## Actions (at most one per tick)

| Command | When | What the driver logs |
|---|---|---|
| `connect [agentId]` | start, after a PAUSE, and once when a call says the lease expired | `connected` / `reconnect` (`ok` true or false) / `connect_failed`; `skill_updated` if `connect` returned `skillUpdate.updated: true`, and the driver stops |
| `eat` | hungry or starving and carrying food | the outcome |
| `trade <merchant> crystal <n>` | hungry, no food, enough crystal for the cheapest food offer | the outcome |
| `trade <merchant> <item> <n>` | load isn't `normal`, or hungry with no food and too little crystal: sells whole batches of the heaviest item that isn't food, crystal or in `keep`, to a buyer that pays crystal | the outcome |
| `gather <sourceId>` | idle, `gather` mode: the first open source in `jobs` | the outcome |
| `work` | idle, `work` mode | the outcome |
| `stop-work` | a PAUSE arrives while the agent is working | in `paused` |
| `disconnect` | a PAUSE arrives, and at exit | `paused` / `disconnected` |

For every trade, the merchant name, item id and batch size are copied from the offer's own `trade` object when `merchants` returns one (the City's rule), and from `name` and `offer` otherwise.

Every action prints `submitted` and `outcome.status` (`confirmed`, `pending`, `failed` with `outcome.reason`). The driver logs those as they come. It never turns `pending` into done, and it doesn't send the same action again until the inventory changes or 3 ticks pass. An action that fails 3 times in a row is rested for 10 ticks (`backoff`).

## Decision order

1. An event holds the agent (`locksCommonActions`): wait. Only event actions are allowed then, and the driver doesn't do events.
2. Mid-action (`activeAction` set: walking, gathering, trading): wait. Any new action would replace the running one.
3. Hungry: eat if carrying food; else buy the cheapest food if crystal allows; else sell something to pay for it; else note it and carry on working to earn. Eating or selling may interrupt a profession job; that's on purpose, since hunger and load slow work.
4. Loaded: sell, as above. If nothing is sellable: note it and carry on, or wait if `overburdened`.
5. On a profession job (`isPerformingJob`): wait. Sending `work` or `gather` again would restart it.
6. Start a job.

## What it leaves to you

- **Movement.** `gather` and `trade` route the agent themselves. The driver never moves it.
- **Tools.** A tool can break during work. Read `inventory` yourself, or add a step that buys one, with a test.
- **Food choice.** Buying picks the cheapest offer. Some foods may be better; that's a rule you can add.
- **Events, talking, fighting, quests, crafting, groups, crystal sends.** Not in the starter. The City's skill documents each one. Add them one at a time, each with its own test in the fake City first.
