# The rules

One list, in [`scripts/redact.mjs`](../scripts/redact.mjs), applied in this order. Every value below is fake.

| Rule | Example | Becomes |
|---|---|---|
| `private-key` | `-----BEGIN … PRIVATE KEY-----` to `-----END …-----` | every line `<masked> (private key)`, even across reads |
| `url-password` | `https://deploy:<password>@git.example.com` | `https://deploy:<masked>@git.example.com` |
| `url-query` | `wss://rpc.example.com/?project_id=…: 1006` | `wss://rpc.example.com/?project_id=<masked>: 1006` |
| | any query name with a value of 16+ characters: `?sig=…` | `?sig=<masked>` |
| | percent-encoded: `%3Fproject_id%3D…%26a%3D1` | `%3Fproject_id%3D<masked>%26a%3D1` |
| `name-value` | `API_KEY=…`, `MY_SERVICE_TOKEN: …`, `"client_secret": "…"`, `Authorization: Bearer …` | `API_KEY=<masked>` (the name stays) |
| `auth-header` | `Bearer …`, `Basic …`, `Token …` (16+ characters) | `Bearer <masked>` |
| `known-shape` | AI provider keys (`sk-…`, `sk-ant-…`, `xai-…`), code host tokens (`ghp_…`, `github_pat_…`, `glpat-…`), `npm_…`, `hf_…`, `AKIA…`, `AIza…`, `xox?-…`, payment-style `sk_live_…`, JSON web tokens `eyJ….….…`, 64 hex digits, a network name + 32 letters and digits (`preprod…`, `mainnet…`) | `<masked>` |
| `exact` | the values of the variables in `SAFE_LOGS_SECRET_VARS` (6+ characters) | `<masked>` |
| `extra` | each regex in your `SAFE_LOGS_EXTRA` file, case-insensitive | `<masked>` |
| `seed-words` | 12 to 24 lower-case words of 3 to 8 letters in a row, at least 10 of them different | `<masked> (words)` |
| `home-path` | a home folder path: `/Users/<name>`, `/home/<name>`, `C:\Users\<name>` | `~` |
| `catch-all` | any 24+ character run of letters, digits, `_` and `-` with an upper-case letter, a lower-case letter and a digit | `<masked>` |

**Name words** for `name-value`: anything containing `SECRET`, `TOKEN`, `PASSWORD`, `PASSWD`, `API_KEY`, `ACCESS_KEY`, `PRIVATE_KEY`, `SEED`, `MNEMONIC` (any case), plus `project_id`, `authorization`, `client_secret`, `cookie`, `set-cookie` and their spellings. The value must be 6+ characters, so `Password: ` (a prompt) and `tokens: 5` stay.

**Query names** masked at any length: `api_key`, `apikey`, `project_id`, `access_token`, `refresh_token`, `auth`, `token`, `secret`, `key`, `sig`, `signature`, `password`, `client_secret`, `code`. A value stops at `& # : , ; )`, quotes or spaces, so the text after the key survives.

## What it keeps

Host names and URL paths, short query values (`?page=2&sort=asc`), git hashes (40 hex), UUIDs, numbers, times, file paths outside home folders, ordinary prose (which has 1- and 2-letter words, so it's never a word run), email addresses, and text that is already masked: masking twice changes nothing.

**Terminal colours:** a line with nothing to mask comes back byte for byte. A line with something to mask is matched with its escape codes removed (a key split by a colour code is still one key) and comes back masked, without colours. `--strip-ansi` (or `SAFE_LOGS_ANSI=strip`) removes them everywhere; log files always do.

## What it misses

- A short secret with no shape and no name next to it: `the password is tulip`. Name it in `SAFE_LOGS_SECRET_VARS`, or don't print it.
- A secret printed one character at a time with cursor moves between characters (a password prompt echoing): too short in pieces.
- Seed phrases with capitals, punctuation or numbers between the words.
- Anything in an image.
- Secrets in another encoding (base64 of a key that isn't long and mixed, hex of a short password).

The catch-all makes misses rarer, at the cost of masking some harmless long ids. If it masks too much, turn it off and add your own terms instead.

## Options

| Environment | Flag (mask-pipe.mjs) | Option (redact.mjs) | Effect |
|---|---|---|---|
| `SAFE_LOGS_SECRET_VARS=A,B` | `--secret-vars A,B` | `secrets: [values]` | mask those values exactly |
| `SAFE_LOGS_EXTRA=<file>` | `--extra <file>` | `extra: loadExtra(text)` | your own regexes |
| `SAFE_LOGS_GENERIC=0` | `--no-generic` | `generic: false` | no catch-all |
| `SAFE_LOGS_KEEP_PATHS=1` | `--keep-paths` | `homePaths: false` | keep home folder names |
| `SAFE_LOGS_SEED_WORDS=0` | | `seedWords: false` | keep word runs |
| `SAFE_LOGS_ANSI=strip` | `--strip-ansi` | `ansi: 'strip'` | remove escape codes everywhere |
| `SAFE_LOGS_MARK=***` | | `mark: '***'` | the placeholder |
| `SAFE_LOGS_LOG_MAX_MB=5` | `--max-mb 5` | `openDailyLog(dir, name, { maxMb })` | log roll size |
| | `--cr-to-nl` | `crToNl: true` | `\r` becomes a new line |
| | `--count` | `redactor.changed` | `masked-lines=N` on stderr |

## Your own terms file

```text
# ~/.config/safe-logs/terms  (outside any repo, mode 600)
# machine names
my-desk-box
build-\d+\.corp
# an account id format
acct_[0-9]{8}
```

One regular expression per line, case-insensitive; `#` lines and blank lines are skipped. A bad line makes `mask-pipe.mjs` exit 2 before writing anything. The error names the line number, never its text.
