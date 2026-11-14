# Print names, not values; redact at the source

Most leaks are printed before they're published. Two habits make most later checks pass by design.

## Show which settings are set, never their values

```js
// which of my settings are set? (names only)
const keys = Object.keys(process.env).filter((k) => k.startsWith('AGENT_')).sort();
for (const k of keys) console.log(`${k}=${process.env[k] ? '<set>' : '<empty>'}`);
```

Make a secret without ever showing it:

```sh
node -e "require('fs').appendFileSync('.env','AGENT_SEED_HEX='+require('crypto').randomBytes(32).toString('hex')+'\n',{mode:0o600})"
ls -la .env        # plain ls -l hides dotfiles, so an empty-looking listing proves nothing
```

## Redact in the logger, not when copying out

Endpoint URLs often carry a key in the query string, and they turn up in connection errors and stack traces from libraries you don't control. Mask everything the process writes:

```js
// mask-output.mjs: import this FIRST, before anything that can log
const PATTERNS = [
  [/([?&](?:project_id|api[_-]?key|apikey|key|token|secret)(?:=|%3D))[^&\s"'<>]+/gi, '$1***'],
  [/(Authorization:\s*Bearer\s+)\S+/gi, '$1***'],
  [/(\/\/[^/\s:@]+:)[^@\s/]+@/g, '$1***@'],                          // user:pass@host
  [/\b(sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{30,})\b/g, '***'],
];
export const redact = (s) => PATTERNS.reduce((t, [re, to]) => t.replace(re, to), String(s));
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => write(typeof chunk === 'string' || Buffer.isBuffer(chunk) ? redact(chunk.toString()) : chunk, ...rest);
}
```

Patching the streams catches library log lines that bypass your own logger. Add patterns for anything else your setup prints: a key in a URL **path** needs its own pattern, as do your provider's bare key format and wallet addresses.

## Pasting a log somewhere

1. Run it through the same `redact` (or the leak check) first: save the excerpt to a file in its own folder and run `leak-check.mjs` on that folder.
2. Read what's left. Hostnames, paths and usernames in a prompt line aren't secrets to a scanner, but they are to you.
3. Paste text, not a screenshot of a terminal.
