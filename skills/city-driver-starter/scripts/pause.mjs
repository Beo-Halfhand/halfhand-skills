#!/usr/bin/env node
// pause.mjs: take the agent from the driver for a while, safely.
//   node pause.mjs <driver folder> <minutes> [--by <name>]   write PAUSE, wait until the driver says RELEASED
//   node pause.mjs <driver folder> off                       remove PAUSE; the driver takes the agent back
// A PAUSE always gets an end time here, so a crashed script can't strand the agent: when it passes,
// the driver resumes on its own. Exit 0 released (or removed), 1 the driver didn't answer in time, 2 usage,
// 3 the driver answered but could NOT hand back control (don't connect: you would fight it).
import fs from 'node:fs';
import path from 'node:path';

const [dir, what, ...rest] = process.argv.slice(2);
const usage = () => { console.error('usage: node pause.mjs <driver folder> <minutes> [--by <name>] | node pause.mjs <driver folder> off'); process.exit(2); };
if (!dir || !what || !fs.existsSync(dir)) usage();
const P = path.join(dir, 'PAUSE'), R = path.join(dir, 'RELEASED');
if (what === 'off') {
  if (!fs.existsSync(P)) { console.log('there was no PAUSE; nothing to do'); process.exit(0); }
  fs.rmSync(P); console.log('PAUSE removed. Disconnect first if you connected; the driver connects again within a few seconds.'); process.exit(0);
}
const mins = Number(what);
if (!(mins > 0 && mins <= 24 * 60)) usage();
if (rest.length && (rest[0] !== '--by' || !rest[1] || rest.length > 2)) usage();
const by = rest[1] || 'owner';
const at = new Date().toISOString(), until = new Date(Date.now() + mins * 60_000).toISOString();
fs.writeFileSync(P, JSON.stringify({ by, at, until }) + '\n');
console.log(`PAUSE written (by ${by}, until ${until}); waiting for the driver to let go…`);
const waitMs = Number(process.env.PAUSE_WAIT_SECONDS || 120) * 1000, start = Date.now();
while (Date.now() - start < waitMs) {
  try {
    const r = JSON.parse(fs.readFileSync(R, 'utf8'));
    if (r.for === at) {
      if (r.dryRun) { console.log(`RELEASED: the driver is in a dry run and holds no control. The agent is yours until ${until}.`); process.exit(0); }
      if (!r.released) { console.error('the driver paused but could NOT hand back control (its disconnect failed). Don\'t connect yet; see its log.jsonl.'); process.exit(3); }
      console.log(`RELEASED: work ${r.stoppedWork ? 'stopped' : 'was not running'}, control handed back. The agent is yours until ${until}; at that time the driver takes it back, even mid-play.`);
      process.exit(0);
    }
  } catch {}
  await new Promise((ok) => setTimeout(ok, 1000));
}
console.error(`no RELEASED from the driver after ${waitMs / 1000} s. Is it running? PAUSE stays until ${until}; remove it with: node pause.mjs ${dir} off`);
process.exit(1);
