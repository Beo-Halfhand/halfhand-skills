// file adapter: the agent keeps a small JSON status file up to date; the dashboard reads it every round.
// Same Sample shape as the command adapter. A file older than maxAgeMinutes counts as a failed read, so an agent
// that stopped writing doesn't look fine.
//
// fleet.json, per agent:
//   "adapter": "file",
//   "file": { "path": "~/agents/scout/status.json", "maxAgeMinutes": 20 }
import fs from 'node:fs';
import { expand } from '../lib/config.mjs';

export const name = 'file';

export function check(agent) {
  const o = agent.opts, e = [];
  if (typeof o.path !== 'string' || !o.path) e.push('"file".path must be the status file the agent writes');
  if (o.maxAgeMinutes !== undefined && !(Number.isFinite(o.maxAgeMinutes) && o.maxAgeMinutes > 0)) e.push('"file".maxAgeMinutes must be a number above 0');
  return e;
}

export async function sample(agent, ctx) {
  const file = expand(agent.opts.path, agent.base);
  let st; try { st = fs.statSync(file); } catch { throw new Error('no status file at the configured path'); }
  if (st.size > 1024 * 1024) throw new Error('the status file is over 1 MB');
  const age = (ctx.now ?? Date.now()) - st.mtimeMs, max = (agent.opts.maxAgeMinutes ?? 20) * 60_000;
  if (age > max) throw new Error(`the status file is ${Math.round(age / 60_000)} min old`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('the status file is not valid JSON'); }
}
