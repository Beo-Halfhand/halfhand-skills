---
type: index
writer: {{AGENT}}
updated: {{DATE}}
---
# Key index
#vault

**Names and locations only. Never a value, in this file or anywhere in the vault.** Not a partial value, not the last four characters, not "it starts with".

Every key, token, seed and login you set up gets a line here the day it is made: what it is, where it is stored, what it unlocks. That way an assistant can tell you *which* key a job needs and *where to find it* without ever seeing it.

Label pattern for your password manager (so the "Where" column is exact): `<Service> — <purpose> (<environment>)`.

## API keys and tokens
| Name | Where it is stored | Unlocks | Made | Rotated |
|---|---|---|---|---|
| _Example: weather API, read-only_ | _password manager: "Weather — dashboard (prod)"; env var `WEATHER_KEY` on the server_ | _reading forecasts, nothing else_ | _2026-01-05_ | |

## Wallet seeds and private keys
| Name | Where it is stored | Unlocks | Made |
|---|---|---|---|
| _Example: test wallet 1_ | _password manager: "Wallet — test 1 (testnet)"; offline paper copy in the safe_ | _testnet funds only_ | |

## SSH and logins
| Name | Where it is stored | Unlocks | Made |
|---|---|---|---|
| _Example: laptop → server SSH key_ | _laptop: the default SSH key file; public half on the server_ | _shell on the server_ | |

## Hygiene to-dos
- _Example: rotate the weather key (it was pasted into a chat once)._
