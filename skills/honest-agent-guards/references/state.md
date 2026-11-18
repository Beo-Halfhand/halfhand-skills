# The agent's state (`self`)

What the agent really is and has, right before this reply. The level, gear and action checks compare the line with it. Pass `self: null` (or leave it out) to run only the list checks.

| Field | Type | Checks | If you leave it out |
|---|---|---|---|
| `levels` | `{ skill: level }` | a level it gives for itself must be its real one; a target level is always refused | **any** level it gives for itself is refused (it doesn't know its levels, so it may not state one) |
| `inv` | `{ item_id: qty }` or `[{ item, qty }]` | gear it says it carries must be there; a count it gives must be exact; "I still need X" when it has X is refused | every claim to carry gear is refused |
| `items` | `[{ id, name, cat \| gear }]` | lets it recognise named items ("Cinder Axe") and counts ("40 wood logs") | only generic tool words are known: pickaxe, axe, rod, kit, meter, blade, sword, decoder, rig |
| `specialty` | skill name | the one skill it may say it works, plus that skill's tool (axe, pick, rod, kit, meter) | every "I fish / I mine / I chop…" is refused |
| `crafts` | `[words]` | what it really crafts ("planks"); a craft sentence that names one passes | every "I craft / make / build / forge…" is refused |
| `trades` | `[words]` | what it really sells or buys ("meme coins", "food"), matched as whole words | every "I sell / buy / trade…" is refused |
| `ownOk` | `[words]` | other things it may say it has ("crew", "team") | "my crew / my team / my guild" is refused |
| `world` | boolean | `true` lets it talk about weather | weather words are refused (most game worlds have none the agent can see) |
| `skills` | `[names]` | the skill names that count in level claims | Midnight City's 20 skills |
| `skillVerbs` | `{ skill: "verb\|verb" }` | extra or replacement verbs for the "other skill" check | City verbs for fishing, mining, farming, scavenging, agility, energy, woodcutting |

**Fresh, not typed.** Build it from the agent's own reads every few minutes, or before each reply. A level typed into a config file is right for a day. After that the guard refuses the agent's true level and lets the stale one through.

**Strict by default.** An empty field means "it has none of these", so the claim is refused. That's the right default for an agent that talks to strangers: it's better to skip a true line than send a false one. If a check refuses too much, fill the field rather than removing the check.

## Midnight City

From the City's direct-control helper (`scripts/mcity-control.mjs` in the City's skill folder), read-only:

| Field | From |
|---|---|
| `levels` | `progression <agentId>`: `skills.<skill>.level` |
| `inv` | `inventory <agentId>`: item id → quantity |
| `items` | the City's item catalog: `{ id, name, cat }` (tool, weapon, armor, clothing, utility_equipment and machine count as gear) |
| `specialty`, `crafts`, `trades` | your driver's own config: what it was built to do (city-driver-starter's `driver.json` jobs, or your crew's role) |

Read these at most every few minutes: they're the same calls your driver already makes. If a read fails, keep the last good state with its time, and treat a state older than an hour as unknown. Either fill it again or skip talk.

## Any other bot

The same idea with your own facts: `specialty` is the one thing it does, `trades` the things it really sells, and `inv` what it really has (products in stock, tools it can call). Use `skills` and `skillVerbs` to name its "skills" (for a support bot, `{ "refunds": "refund|refunded|issue a refund" }`). Then "I refunded your order", from a bot that can't refund, is refused.
