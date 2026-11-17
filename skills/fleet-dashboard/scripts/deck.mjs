#!/usr/bin/env node
// fleet-dashboard: one page that shows every agent you run. No dependencies, Node 20+.
//
//   node deck.mjs --demo                    a made-up fleet in a temp folder; nothing to set up (Ctrl-C ends it)
//   node deck.mjs --config fleet.json       your agents: the web page and the sampler in one process
//   node deck.mjs --config fleet.json --check   check the config and read each agent once; writes nothing
//   node deck.mjs --config fleet.json --once    one sampling round into the history, then exit
// Options: --port N (overrides the config), --no-sampler (page only; run the sampler elsewhere with --once)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS, sampleOne } from './adapters/index.mjs';
import { loadConfig } from './lib/config.mjs';
import { makeReader } from './lib/history.mjs';
import { round, startSampler } from './lib/sampler.mjs';
import { createServer } from './lib/server.mjs';
import { buildDemo, keepLogsMoving } from './lib/demo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VERSION = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8')).version;

function args(argv) {
  const o = { demo: false, config: null, check: false, once: false, sampler: true, port: null, keep: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') o.demo = true;
    else if (a === '--config') o.config = argv[++i];
    else if (a === '--check') o.check = true;
    else if (a === '--once') o.once = true;
    else if (a === '--no-sampler') o.sampler = false;
    else if (a === '--keep') o.keep = true;
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '-h' || a === '--help') o.help = true;
    else { console.error(`unknown option ${a} (try --help)`); process.exit(2); }
  }
  return o;
}

function usage() {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 9).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}

async function main() {
  const o = args(process.argv.slice(2));
  if (o.help || (!o.demo && !o.config)) { usage(); process.exit(o.help ? 0 : 2); }
  if (o.port !== null && !(Number.isInteger(o.port) && o.port >= 1024 && o.port <= 65535)) { console.error('--port must be 1024 to 65535'); process.exit(2); }

  let config, stopLogs = () => {}, demoDir = null;
  if (o.demo) {
    demoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-dashboard-demo-'));
    process.stdout.write('building a made-up fleet (8 agents, 26 h of history)… ');
    ({ config } = await buildDemo(demoDir, { port: o.port ?? 7700 }));
    console.log('done');
    stopLogs = keepLogsMoving(config);
  } else {
    const file = path.resolve(o.config);
    const r = loadConfig(file, ADAPTERS);
    if (r.errors.length) { console.error(`fleet.json has ${r.errors.length} problem(s):\n- ${r.errors.join('\n- ')}`); process.exit(2); }
    config = r.config;
    if (o.port !== null) config.port = o.port;
  }

  if (o.check) {
    console.log(`config ok: ${config.agents.length} agent(s), data in ${config.dataDir}`);
    let bad = 0;
    for (const a of config.agents) {
      const s = await sampleOne(a, { now: Date.now() });
      if (s.err) { bad++; console.log(`  ✗ ${a.key} (${a.adapter}): ${s.err}`); continue; }
      const xp = Object.keys(s.xp ?? {}).length, where = s.act?.name ?? s.act?.space;
      console.log(`  ✓ ${a.key} (${a.adapter}): ${xp} skill(s)${s.act?.label ? `, doing "${s.act.label}"` : ''}${where ? `, at ${where}` : ''}${a.log ? (fs.existsSync(a.log) ? ', log found' : ', LOG NOT FOUND') : ''}`);
    }
    process.exit(bad ? 1 : 0);
  }

  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const logFile = path.join(config.dataDir, 'deck.log');
  const log = (m) => { const line = `[${new Date().toISOString()}] ${m}`; try { fs.appendFileSync(logFile, line + '\n', { mode: 0o600 }); } catch { /* read-only */ } if (process.stdout.isTTY) console.log(line); };

  if (o.once) { await round(config, { log }); process.exit(0); }

  const records = makeReader(config.dataDir);
  const server = createServer({ config, records, version: VERSION, log });
  let sampler = null;
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `port ${config.port} is in use: pick another with --port or "port" in the config` : `server: ${e.message}`);
    process.exit(1);
  });
  server.listen(config.port, '127.0.0.1', () => {
    log(`fleet-dashboard v${VERSION} on http://127.0.0.1:${config.port} · ${config.agents.length} agent(s) · sampler ${o.sampler ? `every ${config.sampleMinutes} min` : 'off'}${o.demo ? ' · DEMO (made-up data)' : ''}`);
    if (!process.stdout.isTTY) return;
    console.log(`\n  open  http://localhost:${config.port}        phone layout  http://localhost:${config.port}/m`);
    if (o.demo) console.log(`  demo files: ${o.keep ? demoDir : 'a temporary folder, removed when you press Ctrl-C (--keep keeps it)'}\n`);
  });
  if (o.sampler) sampler = startSampler(config, { log });

  const stop = () => {
    sampler?.stop(); stopLogs(); server.close();
    if (demoDir && !o.keep) fs.rmSync(demoDir, { recursive: true, force: true });
    process.exit(0);
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
