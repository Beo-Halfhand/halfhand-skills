# The Midnight City adapter

```json
{
  "key": "scout", "name": "Scout", "adapter": "midnight-city",
  "midnight-city": { "skillDir": "~/<your skills folder>/midnight-city-direct-control", "agentId": "<id from claimable>" },
  "log": "~/my-driver/log.jsonl", "pauseFile": "~/my-driver/PAUSE", "staleMinutes": 30
}
```

- `skillDir`: the City's [direct-control skill](https://midnight.city/docs/connect-to-midnight-city/hermes-openclaw/) folder, the one that holds `scripts/mcity-control.mjs` and its `.env`.
- `agentId`: from `node scripts/mcity-control.mjs claimable` in that folder.

## What it does

Once per round, per agent: `node scripts/mcity-control.mjs progression <agentId>`, run **from the skill folder** so the helper finds its own `.env`, with an environment of only `PATH` and `HOME`. Nothing else. No `connect`, no `context`, no actions, no other agents. It reads:

| Field in the answer | Becomes |
|---|---|
| `skills.<skill>.xp` (or `progression.skills`) | `xp` (skills with 0 XP are left out) |
| `agent.activeAction.activity` or `.kind`, and `.phase` | `doing` |
| `activeWork.kind`, `activeWork.source_id` | `doing` when there is no active action (profession work) |
| `agent.isPerformingJob` | `doing` = "working" or "idle" when neither of the above is set |
| `agent.position.spaceId` | `position`. A private room (`agent-room:…`) becomes "a private room"; its id is never stored |

In the helper we wrote against, a read that names the agent doesn't need control, so it never disturbs a driver that holds the agent. If yours answers `not connected`, the read fails and the card says so; nothing else happens.

**Rate:** one call per agent per `sampleMinutes`. The default of 5 minutes is gentle. Don't go below that with many agents on one account.

## The map

A schematic of the City: Forest, Enemy Staging Ground and Volcano City along the top; West Plaza, Central and East Plaza across the middle; Amoeba Wilds, South Plaza and Bison Valley along the bottom; and Miners Cave, Construction Yard and Heartline Tower underneath. Central's buildings are drawn inside Central: Hacker House, Cipher Hacker House, IOG House, Charging House, ADA Arena, Good Times Bar, HoskBrew, NexiFuse and Prison. When the agent is inside one, that building is lit and Central gets a softer outline as the way in: "Here now: Central → Hacker House". A space that isn't on the schematic is shown, lit, under it, by a name made from its id.

## With city-driver-starter

If the agent runs on the [city-driver-starter](../../city-driver-starter/) loop, point the dashboard at the driver's folder:

```json
"log": "~/my-driver/log.jsonl",
"pauseFile": "~/my-driver/PAUSE",
"warnPattern": "\"event\":\"(failed|backoff|giving_up|config_error|skill_updated)\""
```

The starter's log lines are JSON with a `t` time, so the dashboard reads their age directly. The PAUSE file makes a paused driver yellow, not red, until the `until` time in it passes. Warnings catch a driver that keeps failing.

## Skill colours

Seven City skills have fixed colours (hacking, mining, fishing, woodcutting, scavenging, smithing, agility), checked against the dark panels, so a skill keeps its colour on every card. Other skills share the "other" grey unless you pin them with `skillColors`.

## When the City changes

The City is a preview game and its helper updates itself. If readings start failing or a field goes missing, run `node deck.mjs --config fleet.json --check`, read the City skill's `SKILL.md` for the current `progression` fields, and update the table above in `adapters/midnight-city.mjs`.
