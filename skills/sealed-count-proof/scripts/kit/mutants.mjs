#!/usr/bin/env node
// mutants.mjs: do your tests notice when a rule goes missing? Changes one thing in the contract at a time, compiles it (--skip-zk),
// and runs your test file against that build. A mutant the tests don't catch is a hole in the tests, or a change that makes no
// difference; each one left alive has to say which. The pattern is hall-cage's scripts/dice-mutants.mjs at e5ce2d1, made generic.
//
//   node mutants.mjs <contract.compact> <mutations.json> <test file> [--only <text>]
//
// mutations.json: [{ "name": "...", "from": "exact text in the contract", "to": "what replaces it (once)" }, ...]
// A mutant that makes no difference (an "equivalent" mutant) stays in the list with "equivalent": "<why it can't matter>". If it
// survives, the run prints the reason and still passes. If one marked equivalent is caught, the run says so: the reason was wrong.
// The test file must read its build from process.env.BUILD (a folder `compact compile` wrote), and should skip anything that compiles
// on its own when process.env.SWEEP === '1'. example/tally.test.mjs does both.
//
// First runs the tests against the unchanged contract: if that fails, nothing else means anything. Exit 0 = every mutant caught.
// Works under <this folder>/managed/.sweep-* (where Node finds the runtime this folder installs), which it deletes when done.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'usage: node mutants.mjs <contract.compact> <mutations.json> <test file> [--only <text>]';
const argv = process.argv.slice(2);
let only = null;
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--only') { only = argv[++i]; if (!only) { console.error(USAGE); process.exit(2); } }
  else if (argv[i].startsWith('-')) { console.error(`unknown option ${argv[i]}\n${USAGE}`); process.exit(2); }
  else pos.push(argv[i]);
}
if (pos.length !== 3) { console.error(USAGE); process.exit(2); }
const [source, list, testFile] = pos.map((p) => path.resolve(p));
for (const f of [source, list, testFile]) if (!existsSync(f)) { console.error(`not found: ${f}`); process.exit(2); }
const SRC = readFileSync(source, 'utf8');
let M;
try { M = JSON.parse(readFileSync(list, 'utf8')); } catch (e) { console.error(`${list}: ${e.message}`); process.exit(2); }
if (!Array.isArray(M) || M.some((m) => typeof m?.name !== 'string' || typeof m?.from !== 'string' || typeof m?.to !== 'string')) {
  console.error(`${list}: expected [{ "name", "from", "to" }, ...]`); process.exit(2);
}
const work = path.join(path.dirname(fileURLToPath(import.meta.url)), 'managed', `.sweep-${process.pid}`);
const TIMEOUT = 5 * 60 * 1000;

function build(text, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, path.basename(source)), text);
  execFileSync('compact', ['compile', '--skip-zk', path.join(dir, path.basename(source)), path.join(dir, 'build')], { stdio: 'pipe' });
  return path.join(dir, 'build');
}
const runTests = (buildDir) => spawnSync('node', ['--test', testFile], { encoding: 'utf8', timeout: TIMEOUT, env: { ...process.env, BUILD: buildDir, SWEEP: '1' } });

const t0 = Date.now();
let base;
try { base = runTests(build(SRC, path.join(work, 'base'))); } catch (e) { console.error(`FAILED: the unchanged contract doesn't compile: ${String(e.stderr ?? e.message).trim().split('\n').slice(-5).join('\n')}`); process.exit(1); }
if (base.error || base.status !== 0) {
  const out = `${base.stdout ?? ''}${base.stderr ?? ''}`;
  for (const l of out.split('\n').filter((l) => /^\s*(✖|not ok)/.test(l))) console.error(l);
  console.error(out.trim().split('\n').slice(-30).join('\n'));
  console.error('FAILED: the tests fail against the unchanged contract, so a caught mutant would mean nothing'); rmSync(work, { recursive: true, force: true }); process.exit(1);
}
console.log('baseline: the tests pass against the unchanged contract');

const caught = [], alive = [], broke = [], explained = [], wrongly = [];
for (const [i, m] of M.entries()) {
  if (only && !m.name.includes(only)) continue;
  const n = SRC.split(m.from).length - 1;
  if (n !== 1) { broke.push(`${m.name}: "from" appears ${n} times, needs exactly 1`); continue; }
  let dir;
  try { dir = build(SRC.replace(m.from, m.to), path.join(work, String(i))); }
  catch { caught.push(`${m.name} (the compiler refuses it)`); console.log(`caught  ${m.name} (compiler)`); continue; }
  const r = runTests(dir);
  if (r.error) { broke.push(`${m.name}: ${r.error.code ?? r.error.message}`); continue; }
  if (r.status === 0 && m.equivalent) { explained.push(`${m.name}: ${m.equivalent}`); console.log(`equiv.  ${m.name}`); }
  else if (r.status === 0) { alive.push(m.name); console.log(`ALIVE   ${m.name}`); }
  else { caught.push(m.name); if (m.equivalent) wrongly.push(m.name); console.log(`caught  ${m.name}`); }
}
rmSync(work, { recursive: true, force: true });
const ran = caught.length + alive.length + broke.length + explained.length;
console.log(`\n${ran} mutants · ${caught.length} caught · ${explained.length} equivalent · ${alive.length} alive · ${broke.length} didn't apply · ${Math.round((Date.now() - t0) / 1000)} s`);
for (const x of explained) console.log(`  equivalent: ${x}`);
for (const x of wrongly) console.log(`  marked equivalent but caught (fix the list): ${x}`);
for (const x of broke) console.log(`  didn't apply: ${x}`);
for (const x of alive) console.log(`  alive: ${x}`);
if (!ran) { console.log('FAILED: no mutant ran'); process.exit(1); }
if (alive.length || broke.length || wrongly.length) { console.log('FAILED: every mutant must be caught, or marked "equivalent": "<why it can\'t matter>"'); process.exit(1); }
console.log(`PASS: every mutant caught${explained.length ? `, ${explained.length} equivalent and explained` : ''}`);
