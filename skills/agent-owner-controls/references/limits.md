# Owner limits

One policy file the owner writes, one `check()` the driver calls before every action that changes anything, and a log of every "no".

## policy.json

```json
{
  "mode": "on",
  "tz": "America/New_York",
  "expires": "2027-01-01T00:00:00Z",
  "spend": { "perAction": 200, "perDay": 2000, "perWeek": 8000 },
  "allow": ["work", "buy_tool", "sell", "eat", "speak", "take_contract"],
  "readOnly": ["look", "status"],
  "needsHuman": ["send_coins", "join_group", "fight"],
  "approvals": "off",
  "neverTo": ["my-other-agent"],
  "floors": { "food": 2 },
  "rate": { "speak": { "perHour": 30 } },
  "perMinute": 12,
  "onBreach": "refuse"
}
```

| Field | Meaning |
|---|---|
| `mode` | `on` (refuse), `shadow` (log would-refuse, allow everything), `off` (refuse everything but read-only). Required |
| `tz` | the owner's time zone for "today" and "this week" (weeks start Monday). Default UTC |
| `expires` | after this, everything is refused until the owner writes a new date |
| `spend` | caps per action, per day and per week, in whatever unit `amount` is |
| `allow` | actions the agent may take. Required. Anything not listed is refused |
| `readOnly` | actions that always pass, even with STOP, frozen or expired |
| `needsHuman` | actions the owner must do or approve. Refused unless `approvals` is `"asks"` and the driver passes an approval from an ask |
| `approvals` | `"off"` (default) or `"asks"`: see [asks.md](asks.md) |
| `neverTo` | counterparties never to deal with (`ctx.to`), e.g. your own other agents |
| `floors` | minimums: `check('sell', { after: { food: 1 } })` is refused below the floor |
| `rate` | per-action limit per hour |
| `perMinute` | all allowed non-read actions together, per minute: a chatty loop can't spam even when each action is under its own rate |
| `onBreach` | `"refuse"` (default: block that action) or `"freeze"`: any refusal stops everything until the owner runs `controls.mjs unfreeze` |
| `note` | free text for yourself |

**Any other field refuses everything** and `doctor` names it: a typo like `"spnd"` would otherwise silently turn the caps off. No readable policy.json also refuses everything.

## The driver

```js
const limits = createLimits(DIR);
const c = limits.check('buy_tool', { amount: 16 });
if (!c.ok) return log(`REFUSED buy_tool [${c.rule}] ${c.reason}`);
await buyTool(); limits.record(16);
```

Pass what the rules need: `amount`, `to`, `after` (state after the action, for floors). Order: read-only passes; then STOP, mode off, expired, frozen; then needsHuman, allow, neverTo, floors, caps, rates. The policy is re-read on every call, so the owner tightens a cap without a restart. Spend persists in `spent.json` (it survives restarts and resets at the owner's midnight and Monday). Rate windows are per process.

## Lessons
1. **Caps that block normal play aren't "safe".** A tool budget of 60 meant the agent could never buy the tool it needed; 2000 cost nothing in practice. The rails that matter are *who* (your own fleet, the allow list, floors, the platform's own caps), more than *how much*. Loosen when needed, and log it.
2. **Sit inside the platform's own caps,** and read its usage numbers daily: stop when the account total nears its limit, not only your own.
3. **A cap is not a rate.** "3 per tick" was read as 4,320 a day; measured, it was 61.
4. **A refusal is not a crash and not a silent zero.** Log "REFUSED: already done today", don't exit with an error, and never let a component that *can't* report look like "nothing to do".
5. **Shadow first for new powers.** Go live after reading real would-refuse lines (`refusals.jsonl` lines with `wouldRefuse: true`).
6. **Refuse duplicate runs by key** (an id or a date) before any spend.
7. **Dashboards get fewer buttons than the agent:** pause, resume, answer. Never move money or change limits from a page.

## Keep a rogue
A guard that never says no is untested. Schedule an action that must always be refused, and alert if it passes:

```sh
node controls.mjs rogue ~/agents/scout    # exit 0: refused, as it must be. exit 2: ALERT
```

It alerts in shadow mode too, correctly: in shadow, nothing is being stopped.

## Enforced outside the agent
The files here stop mistakes and runaway loops. **An agent that can write its own policy can raise its own limits**, delete STOP, or reset `spent.json`.
- Keep `policy.json` and `STOP` owned by another user, readable by the agent's user, in a folder it can't write. `doctor` warns when the current user can write policy.json or the agent's folder (which would let it replace either file).
- For real money, put the same rules where the agent can't reach them: a gateway in front of the payment system that checks an owner-signed mandate, or a contract that holds the funds and refuses out-of-mandate moves. Publish proof the rules held: none broken, only allowed actions, the rules unchanged.

## Trading-style limits
If your agent trades, the same `check()` extends naturally: allowed markets, a risk band on exposure after the action, a daily stop-loss that latches until tomorrow, a price band in basis points against a reference price, maximum position, leverage, open orders and order lifetime, and deadlines for follow-up actions. They were run and tested in the draft this skill came from; they are left out here to keep the core small. Add each one as a rule in `limits.mjs` with a refuse case and an allow case in the self-test.
