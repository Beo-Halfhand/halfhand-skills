# log.jsonl

One JSON object per line, in the driver's folder. Every line has `t` (ISO time) and `event`.

| `event` | Other fields | Means |
|---|---|---|
| `start` | `dryRun`, `mode` | the driver started |
| `connected` / `disconnected` | | control taken / handed back |
| `connect_failed` / `disconnect_failed` | `error` | the helper refused; the driver exits (and says so on the terminal) if it can't connect at start |
| `reconnect` | `because`, `ok` | a call said the lease expired or control changed. `ok: true`: it connected and retried once. `ok: false`: the connect was refused (its own `connect_failed` line has the reason) |
| `giving_up` | `why` | 3 reconnects in a row refused: something else drives the agent, so the driver stops (exit 1) |
| `skill_updated` | `installedVersion` | the City's skill updated itself on `connect`; the driver stops (exit 3) so you can re-read it |
| `read_failed` | `read`, `error`, sometimes `hint` | a read failed; the tick is skipped |
| `inventory_changed` | `delta` (item → change since the last tick) | **measured** change. This is the only place a gain is recorded |
| `note` | `note` | something the decision saw: a skipped job and why, hungry with no food, loaded with nothing to sell. Logged when the notes change, not every tick |
| `wait` | `why` | no action this tick: mid-action, already working, event lock, overburdened, no open job, or an action held after `pending` or `backoff` |
| `backoff` | `act`, `ticks` | the same action failed 3 times in a row; it isn't sent again for `ticks` ticks |
| `would` | `act`, `why` | dry run: what it would have sent |
| `act` | `act` (the command), `why`, `submitted`, `result` (`confirmed`, `pending`, `failed`, `unknown`, `error`), `reason` or `error` | one action and the City's own answer |
| `paused` | `by`, `until`, `stoppedWork`, `released` (`null` in a dry run, which holds no control) | a PAUSE was honoured |
| `pause_renewed` | `by`, `until` | a new or extended PAUSE while already paused; answered in RELEASED, nothing sent |
| `resumed` / `pause_expired` | `by` | the PAUSE was removed / its `until` passed |
| `config_error` / `config_ok` | `error`, `kept` | a bad edit of `driver.json` (the last good config is still in use) / the file is good again |
| `journal` / `journal_rejected` / `journal_failed` | `why` or `error` | the optional model line landed / was refused by the check / the model didn't answer |
| `stop` | `why` (`signal`, `skill`, `control`) | the driver exited |

Quick reads:

```sh
grep '"act"' log.jsonl | tail -20                       # last actions and their outcomes
grep -c '"result":"confirmed"' log.jsonl                 # confirmed actions
grep '"inventory_changed"' log.jsonl | tail             # what really changed
grep -E '"(note|wait)"' log.jsonl | tail                # why it didn't act
```

`log.jsonl` grows forever. Rotate it with your system's log tool, or move it aside now and then; the driver opens it fresh on every line.
