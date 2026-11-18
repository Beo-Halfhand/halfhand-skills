# The loop and the functions

Everything is exported from `scripts/guards.mjs`. Only `loadList()` touches files. Every other function is pure: same input, same answer.

## `guard(line, ctx, opts)` → `{ line, how, why? }` or `{ skip: true, how: 'skipped', why }`

| `how` | Means | Send |
|---|---|---|
| `clean` | nothing refused | `line` as it was |
| `redrafted` | refused (`why`); the model's one redraft passed **every** check | the redraft |
| `trimmed` | refused; no good redraft; the refused sentences were dropped and 25+ characters were left | `line` minus those sentences |
| `skipped` | refused; nothing good enough left | nothing |

- `ctx`: `{ list, self, them, name }`. `list` comes from `loadList()`; `self` is the [state](state.md); `them` is their last message; `name` is their name.
- `opts.redraft(reason, line)`: your model call, made at most once per line. `reason` is a `tell()`. Return a string, or `null` for none. If it throws, that counts as `null`.
- `opts.extra(line)`: your other checks (length, a profanity filter, your own facts), returning a reason or `null`. They run on the first line, on the redraft, and when sentences are dropped.
- `opts.minLen` (25): a trimmed line shorter than this is skipped.

A prompt for the redraft that works with small models:

```
<your usual prompt>

Your last try was rejected (it <reason>): "<line>". Write a different reply that answers what they actually said.
```

Keep the refused line in the prompt: models fix it better when they see it. Don't add an example of a good answer, because the model will send the example.

## The checks on their own

| Function | Returns |
|---|---|
| `checkLine(text, ctx)` | the first reason, or `null`: list claims, then places, then (with `self`) levels and gear, then actions |
| `claimWhy(text, { list, them })` | `banned:<ID>` |
| `placeWhy(text, { list, them, name })` | `banned:<P-ID>` or `banned:place:<Name>` |
| `stateWhy(text, self)` | `state:level:<skill> <n>`, `state:goal-level:…`, `state:item:<gear>`, `state:owned:<gear>`, `state:count:<item> <n>` |
| `actionWhy(text, self)` | `invented:craft:<verb>`, `invented:trade:<verb>`, `invented:own:<thing>`, `invented:skill:<skill>`, `invented:world:<word>` |
| `tell(why, ctx)` | plain words for the redraft, finishing "it …" |
| `dropBad(text, whyFn, minLen)` | the text without refused sentences, or `null` |
| `scan(lines, ctx)` | `[{ i, text, hits: [reasons] }]` for lines with any hit (every hit, not just the first) |
| `loadList(path)`, `parseList(md)` | the list (see [list-format.md](list-format.md)); `list.tag` is a one-line summary to log |

The reason strings are stable: count them, alert on them, and grep for them.

## What to log

One line per reply, so a review can count what the guards did:

```
GUARD clean                                   (nothing to log, or count it)
GUARD redrafted banned:B01 (412 ms)
GUARD trimmed invented:craft:craft
GUARD skipped state:level:woodcutting 30
```

Log the list's `tag` when it changes, so a fallback to the example list doesn't go unnoticed. **Don't** log the refused text into anything public. It's the false thing you just stopped.

## Where it goes in a driver

Right before send, after any other filter you already have, and after anything that rewrites the line (trimming, emoji removal): those can create a claim. **Canned lines go through it too.** If your agent has fallback lines ("I cut wood at the tree stands"), check them once at start-up against its state, so a fallback can't say something its state no longer backs.

One model call per refused line is the cost. On a busy machine, put the redraft behind the same load or time limit as the first draft. With no redraft, `guard()` just trims or skips.
