#!/usr/bin/env node
// run-cage-tests.mjs: clone the public hall-cage at the pinned commit and run its tests, with no chain,
// no wallet and no keys. The tests run the compiled circuits in the Compact simulator.
//
//   node run-cage-tests.mjs <empty or missing folder> [--attacks]
//
//   --attacks   only the attack, permit and rule tests (attacks, attacks-cage3, permit, cage). Compiles the same; tests in seconds.
//
// Run it from your own work folder, not from inside the skill: the clone goes where you say.
//
// Needs: git, Node 22+, pnpm (corepack enable), and the Compact compiler 0.31.1 as the default
// (compact update 0.31.1). Network: GitHub and the npm registry only. Exit 0 = every test passed and none skipped.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = 'https://github.com/Beo-Halfhand/hall-cage.git';
const PIN = 'e5ce2d1f2a657cb00fce8e9a8828a5e5f3a4d614';
const COMPILER = '0.31.1';
const ATTACK_FILES = ['test/attacks.test.mjs', 'test/attacks-cage3.test.mjs', 'test/permit.test.mjs', 'test/cage.test.mjs'];

const USAGE = 'usage: node run-cage-tests.mjs <empty or missing folder> [--attacks]';
const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('-'));
const unknown = flags.filter((a) => a !== '--attacks');
if (unknown.length) { console.error(`unknown option ${unknown.join(' ')}\n${USAGE}`); process.exit(2); }
const only = flags.includes('--attacks');
const dirs = args.filter((a) => !a.startsWith('-'));
if (dirs.length !== 1) { console.error(USAGE); process.exit(2); }
const dir = dirs[0];
const TEST_TIMEOUT_MS = 15 * 60 * 1000;
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
if (compiler !== COMPILER) fail(`the default Compact compiler is ${compiler}; the pinned builds need ${COMPILER}: run compact update ${COMPILER}`);
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

// 3. install, compile, test
const run = (label, cmd, a) => {
  step(label);
  const t = Date.now();
  const r = spawnSync(cmd, a, { cwd: abs, stdio: 'inherit', timeout: TEST_TIMEOUT_MS });
  if (r.error) fail(`${label}: ${r.error.code ?? r.error.message}`);
  if (r.status !== 0) fail(`${label} (exit ${r.status})`);
  console.log(`${label}: ${Math.round((Date.now() - t) / 1000)} s`);
};
run('install (frozen lockfile)', 'pnpm', ['install', '--frozen-lockfile']);
run('compile (cage v4b, dice-proof, cage #3)', 'npm', ['run', 'compile:all']);

step(only ? 'attack and permit tests' : 'every test');
const t = Date.now();
const r = spawnSync('node', ['--test', '--test-reporter=tap', ...(only ? ATTACK_FILES : fs.readdirSync(path.join(abs, 'test')).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `test/${f}`))], { cwd: abs, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: TEST_TIMEOUT_MS });
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
console.log(`\nPASS: hall-cage ${PIN.slice(0, 7)}, ${only ? 'attack and permit tests' : 'every test'}, ${pass} of ${total}`);
