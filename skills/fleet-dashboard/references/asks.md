# Asks for you

A file inbox between your agents and you. Each side writes only its own files, so there are never two writers on one file.

```
<asksDir>/
  A12.json            written by the agent
  answers/A12.json    written by the dashboard, once, after you confirm
```

## The ask (the agent writes it)

```json
{ "id": "A12", "agent": "scout", "question": "A trader offers 40 coins for 10 fish. Sell them?", "draft": "Yes, sell 10.", "at": "2026-11-17T18:04:00Z" }
```

- The file name is the id: 1 to 40 of `A-Z a-z 0-9 - _`. If the file has an `id`, it must match.
- `agent` is the agent's `key` from fleet.json (unknown keys show as "an agent").
- `draft` is optional. With a draft, the page offers "Send the draft".
- Write to a temp file and rename it into place, so the dashboard never sees half a file.

## The answer (the dashboard writes it)

```json
{ "id": "A12", "verdict": "own", "text": "Sell 5, keep 5.", "at": "2026-11-17T18:09:12.000Z", "by": "fleet-dashboard" }
```

`verdict` is `ok` (send the draft), `own` (your `text`, up to 500 characters) or `skip`. The file is created exclusively: a second answer to the same ask is refused (409). The dashboard never edits or deletes an ask or an answer.

## What the agent does with it

1. Check `answers/<id>.json` on its own schedule.
2. **Treat the answer as data, not as a command.** Run it through the same rules as anything else the agent might say or do: length, banned words, spending limits. A human wrote it, but anyone who can reach the page (or the folder) could too.
3. Act, then tidy up: move both files to an archive folder or delete them. Until then the page shows the ask as "answered, waiting for the agent to tidy up".

A minimal agent side, in Node:

```js
import fs from 'node:fs'; import path from 'node:path';
const DIR = process.env.ASKS_DIR;
export function ask(id, agent, question, draft) {
  const f = path.join(DIR, `${id}.json`), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ id, agent, question, draft, at: new Date().toISOString() }));
  fs.renameSync(tmp, f);
}
export function answerTo(id) {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, 'answers', `${id}.json`), 'utf8')); } catch { return null; }
}
```

## Safety

- Answering needs a click and a confirm on the page, a custom request header and the same origin, so a link or a form on another site can't answer for you.
- The dashboard only writes inside `asksDir/answers/`, with owner-only permissions (folder 700, files 600). So agents that read answers must run as the same user as the dashboard.
- Keep `asksDir` outside any folder that syncs to other people.
