// command adapter: for any agent that can answer "how are you?" with a small program.
// The dashboard runs your command (no shell) every round and reads one JSON Sample from its stdout:
//   { "xp": { "research": 1200 }, "doing": { "label": "reading", "detail": "issue 41" },
//     "position": { "space": "queue-b", "name": "Queue B" }, "counters": { "tasks_done": 7 } }
// Every field is optional. A non-zero exit, or no JSON, counts as a failed read (the light goes yellow).
//
// fleet.json, per agent:
//   "adapter": "command",
//   "command": { "run": ["node", "status.mjs", "--json"], "cwd": "~/agents/scout", "env": ["SCOUT_HOME"] }
// "env" lists the names of environment variables to pass through (values are never logged). PATH and HOME always pass.
import { spawn } from 'node:child_process';
import os from 'node:os';
import { expand } from '../lib/config.mjs';

export const name = 'command';

export function check(agent) {
  const o = agent.opts, e = [];
  if (!Array.isArray(o.run) || !o.run.length || o.run.some((x) => typeof x !== 'string' || !x)) e.push('"command".run must be a list like ["node", "status.mjs"] (no shell)');
  if (o.cwd !== undefined && typeof o.cwd !== 'string') e.push('"command".cwd must be a folder path');
  if (o.env !== undefined && (!Array.isArray(o.env) || o.env.some((x) => typeof x !== 'string' || !/^[A-Z_][A-Z0-9_]{0,60}$/.test(x)))) e.push('"command".env must be a list of variable names');
  return e;
}

export function sample(agent, ctx) {
  const o = agent.opts;
  return new Promise((resolve, reject) => {
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: os.homedir() };
    for (const k of o.env ?? []) if (process.env[k] !== undefined) env[k] = process.env[k];
    const [cmd, ...args] = o.run;
    const p = spawn(cmd, args, { cwd: o.cwd ? expand(o.cwd, agent.base) : agent.base, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let out = '', err = '', size = 0;
    const timer = setTimeout(() => p.kill('SIGKILL'), Math.max(2_000, (ctx.timeoutMs ?? 25_000) - 1_000));
    p.stdout.on('data', (d) => { size += d.length; if (size < 1024 * 1024) out += d; });
    p.stderr.on('data', (d) => { if (err.length < 2000) err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? `command not found: ${cmd}` : e.message)); });
    p.on('close', (code, sig) => {
      clearTimeout(timer);
      if (sig) return reject(new Error('the status command timed out'));
      if (code !== 0) return reject(new Error(`status command exit ${code}: ${err.trim().split('\n').pop() ?? ''}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('the status command did not print JSON')); }
    });
  });
}
