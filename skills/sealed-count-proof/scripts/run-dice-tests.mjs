#!/usr/bin/env node
// run-dice-tests.mjs: clone the public hall-cage at the pinned commit and run the dice proof's tests, with no chain, no wallet and no
// keys. The tests run the compiled circuits in the Compact simulator and through the circuit checker.
//
//   node run-dice-tests.mjs <empty or missing folder> [--mutants]
//
//   --mutants   also run hall-cage's mutant sweep (scripts/dice-mutants.mjs): one changed line at a time, recompiled, every test run
//               against it. Takes several minutes.
//
// Run it from your own work folder, not from inside the skill: the clone goes where you say.
//
// Needs: git, Node 22+, pnpm 10 (corepack enable), and the Compact compiler 0.31.1 as the default (compact update 0.31.1).
// Network: GitHub and the npm registry only. Exit 0 = every test passed and none skipped (and, with --mutants, none alive).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = 'https://github.com/Beo-Halfhand/hall-cage.git';
const PIN = 'e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614';
const COMPILER = '0.31.1';
const TEST_FILE = 'test/dice-proof.test.mjs';

const USAGE = 'usage: node run-dice-tests.mjs <empty or missing folder> [--mutants]';
const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('-'));
const unknown = flags.filter((a) => a !== '--mutants');
if (unknown.length) { console.error(`unknown option ${unknown.join(' ')}\n${USAGE}`); process.exit(2); }
const mutants = flags.includes('--mutants');
const dirs = args.filter((a) => !a.startsWith('-'));
if (dirs.length !== 1) { console.error(USAGE); process.exit(2); }
const dir = dirs[0];
const TIMEOUT_MS = 15 * 60 * 1000;
const SWEEP_TIMEOUT_MS = 60 * 60 * 1000;
const fail = (msg) => { console.error(`FAILED: ${msg}`); process.exit(1); };
const out = (cmd, a, opts = {}) => execFileSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const step = (label) => console.log(`\n== ${label}`);

// 1. tools
step('tools');
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) fail(`Node ${process.versions.node}: needs 22 or newer`);
let pnpm, compiler;
try { pnpm = out('pnpm', ['--version']); } catch { fail('pnpm not found: run corepack enable'); }
if (pnpm.split('.')[0] !== '10') fail(`pnpm ${pnpm}: the lockfile at the pin is pnpm 10's; use pnpm 10 (corepack use pnpm@10)`);
try { compiler = out('compact', ['compile', '--version']).split('\n').pop(); } catch { fail('the compact tool is not installed: see https://docs.midnight.network for the Compact installer'); }
if (compiler !== COMPILER) fail(`the default Compact compiler is ${compiler}; the pinned build needs ${COMPILER}: run compact update ${COMPILER}`);
console.log(`node ${process.versions.node} · pnpm ${pnpm} · compact compile ${compiler}`);

// 2. clone at the pin, and prove it is the pin
step(`clone hall-cage at ${PIN.slice(0, 7)}`);
const abs = path.resolve(dir);
if (fs.existsSync(abs) && fs.readdirSync(abs).length && !fs.existsSync(path.join(abs, '.git'))) fail(`${dir} is not empty and not a clone`);
if (!fs.existsSync(path.join(abs, '.git'))) {
  const r = spawnSync('git', ['clone', '--quiet', REPO, abs], { stdio: 'inherit' });
  if (r.status !== 0) fail('git clone');
}
const git = (...a) => out('git', ['-C', abs, ...a]);
try { git('checkout', '--quiet', '--detach', PIN); } catch { fail(`commit ${PIN} not found in the clone`); }
if (git('rev-parse', 'HEAD') !== PIN) fail('HEAD is not the pinned commit');
if (git('status', '--porcelain', '--untracked-files=no')) fail('the clone has local changes: use a fresh folder');
console.log(`HEAD ${PIN}`);

// 3. install, compile
const run = (label, cmd, a) => {
  step(label);
  const t = Date.now();
  const r = spawnSync(cmd, a, { cwd: abs, stdio: 'inherit', timeout: TIMEOUT_MS });
  if (r.error) fail(`${label}: ${r.error.code ?? r.error.message}`);
  if (r.status !== 0) fail(`${label} (exit ${r.status})`);
  console.log(`${label}: ${Math.round((Date.now() - t) / 1000)} s`);
};
run('install (frozen lockfile)', 'pnpm', ['install', '--frozen-lockfile']);
run('compile dice-proof (8 circuits)', 'npm', ['run', 'compile:dice']);

// 4. the tests
step(`the dice proof's tests (${TEST_FILE})`);
let t = Date.now();
const r = spawnSync('node', ['--test', '--test-reporter=tap', TEST_FILE], { cwd: abs, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: TIMEOUT_MS });
if (r.error) fail(`the test run: ${r.error.code ?? r.error.message}`);
const tap = `${r.stdout}`;
const count = (k) => Number((tap.match(new RegExp(`^# ${k} (\\d+)$`, 'm')) || [])[1] ?? NaN);
const pass = count('pass'), failed = count('fail'), total = count('tests'), skipped = count('skipped') || count('skip') || 0;
for (const m of tap.matchAll(/^\s*not ok \d+ - (.*)$/gm)) console.log(`  not ok: ${m[1]}`);
for (const m of tap.matchAll(/^\s*ok \d+ - (.*) # SKIP(.*)$/gm)) console.log(`  skipped: ${m[1]}${m[2]}`);
console.log(`tests: ${pass} passed, ${failed} failed, ${skipped} skipped, of ${total} · ${Math.round((Date.now() - t) / 1000)} s`);
if (r.stderr && r.status !== 0) console.error(r.stderr.trim().split('\n').slice(-20).join('\n'));
if (!Number.isFinite(pass) || !Number.isFinite(total)) fail('could not read the test summary: see the output above');
if (r.status !== 0 || failed !== 0 || !(pass > 0)) fail('some tests failed: see above, and references/tests.md');
if (skipped > 0) fail('some tests were skipped, so this run proves less than it says: see the skipped lines above');
let summary = `${pass} of ${total} tests`;

// 5. optional: the mutant sweep
if (mutants) {
  step('mutant sweep (scripts/dice-mutants.mjs)');
  t = Date.now();
  const m = spawnSync('node', ['scripts/dice-mutants.mjs'], { cwd: abs, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: SWEEP_TIMEOUT_MS });
  if (m.error) fail(`the sweep: ${m.error.code ?? m.error.message}`);
  const text = `${m.stdout}`;
  process.stdout.write(text);
  const s = text.match(/^(\d+) mutants · (\d+) caught · (\d+) alive · (\d+) didn't apply$/m);
  if (!s) fail('could not read the sweep summary: see the output above');
  const [, n, caught, alive, broke] = s.map(Number);
  console.log(`sweep: ${caught} caught, ${alive} alive, ${broke} didn't apply, of ${n} · ${Math.round((Date.now() - t) / 1000)} s`);
  if (m.status !== 0) fail(`the sweep exited ${m.status}`);
  if (alive > 0 || broke > 0) fail('some mutants were not caught: see references/tests.md for the ones expected at the pin');
  summary += `, ${caught} of ${n} mutants caught`;
}
console.log(`\nPASS: hall-cage ${PIN.slice(0, 7)} dice proof, ${summary}`);
