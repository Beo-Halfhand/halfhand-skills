# Words from a model

The driver can ask a model for one journal line now and then. That's the only thing a model does here. It never chooses an action, never speaks to another agent, and never sees your token.

## Hooking one up

`driver.json`:

```json
"words": { "enabled": true, "url": "http://127.0.0.1:11434/api/chat", "model": "<model tag>", "everyMinutes": 60, "apiKeyEnv": "", "timeoutSeconds": 30 }
```

| Where the model runs | `url` | Notes |
|---|---|---|
| Ollama on your machine | `http://127.0.0.1:11434/api/chat` | The driver sends `think: false`: thinking models otherwise can return an empty answer. Use a tag with a fixed context size so it doesn't load at full width |
| LM Studio, a llama.cpp server, other local servers | their `…/v1/chat/completions` | OpenAI-style request and answer |
| A hosted API | its `…/v1/chat/completions` | Put the key in an environment variable, and that variable's **name** in `apiKeyEnv`. The key goes in the `Authorization` header and nowhere else |

A model that doesn't answer within `timeoutSeconds` (default 30) is logged as `journal_failed` and the loop goes on. Keep the timeout short: the driver doesn't look at PAUSE while it waits for the model.

## What the model gets

Plain first-person facts from this tick, for example:

```
- I am not hungry
- my load is light
- I carry 10 crystal
- I carry 4 log
- I just chose this, and it is not finished yet: job pine_logs
```

and the instruction to say only what the facts say: no feelings, times of day, places, people, numbers, plans or results that aren't there.

## The check before a line is kept

| Rejected | Logged as |
|---|---|
| empty | `journal_rejected` `empty reply` |
| over 200 characters | `longer than 200 characters` |
| a number that isn't one of the numbers in the facts (whole numbers: "2" doesn't pass because the facts say "12") | `number N is not in the facts` |
| the same as one of the last 20 lines | `repeats a recent line` |

Quotes around the line are stripped.

## What our test showed

An 8B local model through Ollama, against the fake City:

- With the first prompt ("use only these facts", facts like `hunger is normal`), all three lines embellished: "Hunger is a familiar itch" while not hungry, "the job's done for now" while still working, "loading for the night".
- With the facts in plain first person, "it is not finished yet", and the longer list of things not to add, three of four lines said only the facts. One still added a little ("I've selected a few items for the job").

**The check catches invented numbers written as digits, not numbers written as words, and not invented events.** Keep the journal for yourself, or read it before it goes anywhere public. If you later let the model write lines other agents will read, add more checks than this one: lines must not describe places the agent can't see, must not repeat a shape ("Name, observation, so question?") again and again, and must not promise anything. Test each check against real model output, not only against lines you wrote yourself.
