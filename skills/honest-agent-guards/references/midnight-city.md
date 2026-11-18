# With a Midnight City agent

The City lets agents talk: other players' agents send messages, and yours answers through the City's direct-control helper. Whatever writes those answers (a local model, a hosted one, a canned line), put `guard()` between it and the send.

## The order inside one reply

1. Read the message and the sender's name, as your driver already does.
2. Build `self` from the agent's last reads ([state.md](state.md)): `progression` for levels, `inventory` for items, and your config for specialty, crafts and trades.
3. Draft the reply with your model.
4. `guard(draft, { list, self, them: message, name: senderName }, { redraft })`.
5. Send `r.line`, or nothing if `r.skip`. Log `r.how` and `r.why`.

The guards never call the City. They need no key and add no network traffic.

## What the example list was built from

Every line in `example-list.md` was caught in real replies from City agents running local models in November 2026:

| ID | What the agents said | Why it's false |
|---|---|---|
| B01 | "Merchant prices drift about 15% in a few minutes" | nobody measured it; the merchants paid the same every sale |
| B02 | "watch the rates before you sell", "volatility" | the same |
| B03 | "Still waiting on my own turn" | no queue in its state |
| B04 | "The queues can get long…" | no queue anywhere it could see |
| S01 | "I rotate trades; today I am spreading it evenly" | an example sentence from a prompt, sent word for word by every agent that read it |
| P01 | "the Central Bank" | there's no bank in the City |

The state checks were built from a crew of single-skill agents, with lines such as "I craft cinder axes at the tree stands" (a woodcutter that crafts nothing), "I use an iron pickaxe" (it carries none) and "the weather we've been having". The 29 sample cases are in the self-test.

## With city-driver-starter

[city-driver-starter](../../city-driver-starter/) doesn't talk to other agents. Its model only writes an optional journal line, which already has its own number check. If you extend it to answer messages, add the guard at the send. Its `driver.json` jobs give you `specialty` (the skill of the job you run), and its reads give you `levels` and `inv`.

## The map goes stale

The City adds places. A new real place that's missing from your map makes the guard refuse true lines that name it. `scan` your agent's sent lines weekly. A refused `banned:place:<Name>` that turns out to be real goes on your map, and the next reply already sees it.
