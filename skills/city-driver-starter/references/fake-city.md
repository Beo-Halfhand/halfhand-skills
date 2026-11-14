# The fake City

[`scripts/fake-city.mjs`](../scripts/fake-city.mjs) answers the commands the driver uses, with the same JSON fields as the City's helper (see [the-city.md](the-city.md)), from a world file you can edit. It's for testing your decisions before your agent sees them. It has no movement, no time, no other agents.

## Try your own driver.json against it

First set `"agentId": "agent-test-1"` in your `driver.json` (put your real id back afterwards). Then:

```sh
cp <this skill>/scripts/fake-city.mjs .
cat > world.json <<'JSON'
{
  "agent": { "id": "agent-test-1", "profession": "lumberjack", "isPerformingJob": false, "activeAction": null, "activeModule": null },
  "connected": false,
  "hunger": { "state": "hungry", "value": 70 },
  "items": { "crystal": 9, "log": 12 },
  "loadAt": 10,
  "merchants": [
    { "name": "Noodle Cart", "source": "outlet", "offer": { "acceptsItemId": "crystal", "acceptsQuantity": 3, "paysItemId": "noodles", "paysQuantity": 1 } },
    { "name": "Wood Buyer", "source": "npc", "offer": { "acceptsItemId": "log", "acceptsQuantity": 5, "paysItemId": "crystal", "paysQuantity": 2 } }
  ],
  "sources": [
    { "sourceId": "pine_logs", "failureReason": null, "yields": "log" }
  ]
}
JSON
MCITY_HELPER=$PWD/fake-city.mjs FAKE_CITY_STATE=$PWD/world.json node driver.mjs --config driver.json --ticks 4 --fast
cat log.jsonl
```

Give both paths in full (`$PWD/…`): the driver runs the helper from another folder, so a relative `FAKE_CITY_STATE` isn't found.

These item and merchant names are made up. Use ids from your own agent's `merchants` and `progression` reads to make the fake world look like yours.

`--fast` (0.05 s between ticks) is for tests only.

## World fields

| Field | Effect |
|---|---|
| `agent.*` | what `context` returns |
| `hunger` | what `needs` returns; `eat` sets it back to normal |
| `items` | the inventory; trades and gathers change it |
| `loadAt` | carrying this many non-crystal items makes `load.state` `loaded` |
| `merchants` | offers; `source: "outlet"` sells food |
| `sources[].yields` | the item one `gather` adds |
| `next` | force the next outcome of one command, e.g. `{"gather": "pending"}` or `{"trade": "failed:not_enough_items"}`. A forced `pending` leaves the agent mid-action (`activeAction`) for `pendingReads` context reads (default 1) |
| `expireOn` | expire the lease on the next use of that command, e.g. `"gather"` |
| `refuseConnectAfter` | refuse every `connect` after this many (another controller holds the agent) |
| `skillUpdate` | returned once by the next `connect`, e.g. `{"updated": true, "installedVersion": "…"}` |
| `failDisconnect` | `disconnect` fails |

`FAKE_CITY_CALLS=calls.log` writes every command the driver sent, one per line.
