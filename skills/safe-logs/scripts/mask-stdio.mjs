// mask-stdio.mjs: import it FIRST in an entry point, and everything the process writes to stdout and stderr is
// masked, including what libraries print on their own (a websocket client logging "disconnected from
// wss://…?project_id=…" with console.error).
//
//   import './safe-logs/mask-stdio.mjs';      // the first import, before anything that can log
//
// Options come from SAFE_LOGS_* environment variables (see options.mjs). If they are broken (a bad extra-terms
// file), the default rules still apply and one line on stderr says the extra terms were not loaded.
// See mask-stream.mjs for what it can't catch, and use mask-pipe.mjs around programs you don't control.
import { maskStream, safeDestination } from './mask-stream.mjs';
import { optionsFromEnv } from './options.mjs';

let opts = {}, note = null;
try {
  const r = optionsFromEnv();
  opts = r.opts;
  if (r.skipped.length) note = `safe-logs: not masking by value (missing or under 6 characters): ${r.skipped.join(', ')}`;
} catch (e) { note = `safe-logs: ${e.message}; using the default rules only`; }
maskStream(process.stdout, opts);
maskStream(process.stderr, opts);
if (note) process.stderr.write(note + '\n');

export { safeDestination };
