# The rules

`leak-check.mjs` tests every line against each rule. The rule's regex is in the script; this is what each one is for and where it goes wrong.

| Rule | Catches | False positives | Misses |
|---|---|---|---|
| `private key` | PEM private key headers (RSA, EC, OpenSSH, PKCS#8) | Docs that quote the header | Keys stored as bare base64 or hex (the 64-hex rule catches some) |
| `api key` | Anthropic, OpenAI (including project keys), Google, GitHub (classic and fine-grained), AWS access key ids, xAI, Slack tokens | Rare | Most other providers: that's what gitleaks is for |
| `secret assignment` | `NAME_TOKEN=…`, `SECRET`, `PASSWORD`, `API_KEY`, `SEED`, `MNEMONIC` assigned a 12+ character value | Long placeholder values after the `=`: use `<your key>` instead | Lowercase names (`api_secret = …`), a value split over lines. gitleaks misses these too; read your diff |
| `key in url` | `?api_key=`, `apikey`, `project_id`, `access_token`, `auth`, `token`, `secret`, `key` with an 8+ character value | Docs showing a URL shape: write `project_id=<your id>` | A key in the URL *path* (`/v1/<key>/…`); other parameter names |
| `password in url` | A user name and password written before the host in a URL | Rare | |
| `bearer token` | `Bearer <20+ characters>` in headers, curl lines, logs | Docs: write `Bearer <token>` | |
| `64-hex value` | 32-byte values in hex: seeds, private keys, also hashes and addresses | Many: transaction hashes, commit-like ids, public addresses. Read each | Shorter or longer secrets |
| `home path` | `/Users/<name>` and `/home/<name>/`, any case | Docs about paths: use `~/` | Windows paths |
| `synced folder` | Paths into Dropbox and macOS cloud-sync folders | | Other sync services: add them to your terms |
| `private network` | Tailnet hostnames, the tailnet product's name, private IPv4 (10.x, 192.168.x, 172.16–31.x) | Example IPs in docs: use the documentation ranges (192.0.2.x) | IPv6, CGNAT ranges; add yours to your terms |
| `machine name` | Default macOS hostnames like `name-MacBook-Pro`, and hostnames ending in `.local` | Rare: `.env.local` and `settings.local.json` style file names are not flagged | Custom hostnames: add them to your terms |
| `scheduler label` | launchd-style labels ending in -sync, -watch, -digest or -agent, and LaunchAgents paths | | Other label shapes: add your prefix to your terms |
| `email` | Any email address except GitHub noreply, `example.com`/`example.org` and `anthropic.com` (for co-author lines) | Public contact addresses you mean to publish: the rule can't know | Obfuscated addresses |

## Files that must never ship

Whatever is inside them: `.env` and `.env.*`, `.dev.vars`, `*.plist`, `*.pem`, `*.key`, `*.p12`, files named `seed` or `*.seed`, any `*seed*`, `*mnemonic*` or `*wallet*` file ending in `.txt`, `.json` or `.hex`, and SSH private keys (`id_rsa`, `id_ed25519`, `id_ecdsa`). Ship an `example.env` with placeholders instead (it doesn't match).

In a git repo the check only sees files git would publish: an ignored `.env.local` isn't listed, because it won't be pushed. If you package the folder another way (zip, copy, paste), run the check on a copy without `.git`, so ignored files are included.

## Commit identities

Every author and committer address in `git log --all` must end in `@users.noreply.github.com`. Set it before the first commit:

```sh
git config user.email "<id>+<handle>@users.noreply.github.com"   # the address GitHub shows in Settings → Emails
```

Turn on "Keep my email addresses private" and "Block command line pushes that expose my email" on GitHub too.

## Why both this and gitleaks

They overlap on keys and differ on everything else. gitleaks knows hundreds of key formats and uses entropy, but it doesn't consider a home folder path or a tailnet hostname a leak. This script does, and it knows your private terms. Run both.
