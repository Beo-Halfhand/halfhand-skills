#!/usr/bin/env node
// selftest.mjs: plants fake secrets and setup details in a temporary git repo, then checks leak-check.mjs finds each
// one, finds nothing in clean files, and finds a fake that only lives in an old commit with --history.
// The fakes are assembled at run time, so this file itself holds none.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECK = path.join(HERE, 'leak-check.mjs');
const j = (...p) => p.join('');
const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'leak-check-test-'));
const git = (...a) => execFileSync('git', ['-C', tmp, ...a], { stdio: 'ignore' });
const run = (args, env = {}) => { try { return { code: 0, out: execFileSync('node', [CHECK, tmp, ...args], { encoding: 'utf8', env: { ...process.env, ...env } }) }; } catch (e) { return { code: e.status, out: e.stdout }; } };

const PLANTS = {
  'anthropic.txt': ['api key', j('key = "sk-', 'ant-', 'api03-', 'x'.repeat(24), '"')],
  'openai.txt': ['api key', j('sk-', 'proj-', 'Ab1'.repeat(14))],
  'google.txt': ['api key', j('AI', 'za', 'S'.repeat(35))],
  'github.txt': ['api key', j('gh', 'p_', 'a1'.repeat(18))],
  'aws.txt': ['api key', j('AK', 'IA', 'ABCDEFGHIJKLMNOP')],
  'xai.txt': ['api key', j('xa', 'i-', 'q'.repeat(30))],
  'assign.sh': ['secret assignment', j('export AGENT_', 'TOKEN=', 'Zx9'.repeat(6))],
  'url.md': ['key in url', j('wss://rpc.example.org/?project', '_id=', 'abc123def456ghi')],
  'basic.md': ['password in url', j('https://deploy:', 'hunter22x', '@ci.example.org/')],
  'pem.txt': ['private key', j('-----BEGIN ', 'OPENSSH PRIVATE', ' KEY-----')],
  'hex.json': ['64-hex value', j('{"addr":"', 'ab'.repeat(32), '"}')],
  'path.md': ['home path', j('/Us', 'ers/', 'alice/work/app')],
  'path2.md': ['home path', j('/Us', 'ers/', 'Zoltan/work/app')],
  'sync.md': ['synced folder', j('~/Library/Cloud', 'Storage/x')],
  'net.md': ['private network', j('ssh box.tail1234', '.ts', '.net')],
  'ip.md': ['private network', j('192.', '168.', '1.20')],
  'host.md': ['machine name', j('on alices-', 'MacBook-Pro')],
  'label.md': ['scheduler label', j('com.', 'alice.', 'nightly-sync')],
  'mail.md': ['email', j('alice', '@', 'mailbox.example.net')],
  [j('.env', '.prod')]: ['file type that must not be published', 'X=1'],
  'wallet-seed.txt': ['file type that must not be published', 'nothing'],
};
const CLEAN = {
  'README.md': 'Version 10.4.1 of the tool. Contact: someone@example.com. Path ~/projects/app. Address placeholder <your address>.',
  'code.js': 'const key = process.env.API_KEY; // name only\nconsole.log(`API_KEY=${key ? "<set>" : "<empty>"}`);',
  'ci.yml': 'node-version: 22\nrun: npx gitleaks@8 detect',
  '.gitignore': '.env.local\nsettings.local.json\nnode_modules/',
};

let ok = 0, failed = 0;
const t = (name, cond, extra = '') => { if (cond) { ok++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
try {
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', '1+test@users.noreply.github.com');
  for (const [f, body] of Object.entries(CLEAN)) fs.writeFileSync(path.join(tmp, f), body + '\n');
  git('add', '.'); git('commit', '-q', '-m', 'clean');
  const clean = run([]);
  t('clean files: exit 0, no findings', clean.code === 0, clean.out);

  // a secret that was committed, then deleted: only --history should see it
  fs.writeFileSync(path.join(tmp, 'old.env.example'), j('DEPLOY_', 'SECRET=', 'Qw8'.repeat(6), '\n'));
  git('add', '.'); git('commit', '-q', '-m', 'oops'); git('rm', '-q', 'old.env.example'); git('commit', '-q', '-m', 'remove');
  t('deleted secret: not in the tree check', run([]).code === 0);
  const hist = run(['--history']);
  t('deleted secret: found with --history', hist.code === 1 && /history \w+ old\.env\.example: secret assignment/.test(hist.out), hist.out);

  for (const [f, [, body]] of Object.entries(PLANTS)) fs.writeFileSync(path.join(tmp, f), body + '\n');
  const out = run([]).out;
  for (const [f, [rule]] of Object.entries(PLANTS)) t(`planted ${rule} in ${f}`, out.includes(`${f}${rule.startsWith('file type') ? '' : ':1'}: ${rule}`));
  for (const f of Object.keys(CLEAN)) t(`no false positive in ${f}`, !out.includes(`${f}:`));
  t('output never shows the planted values', !/hunter22x|abc123def456ghi|Zx9Zx9/.test(out));

  // private terms file
  const terms = path.join(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'terms-')), 'leakterms');
  fs.writeFileSync(terms, 'project-bluebird\nalices-laptop\n');
  fs.writeFileSync(path.join(tmp, 'notes.md'), 'Deployed from alices-laptop for Project-Bluebird.\n');
  const withTerms = run([], { LEAK_TERMS: terms }).out;
  t('private terms: both found (case-insensitive)', /notes\.md:1: private term 1/.test(withTerms) && /notes\.md:1: private term 2/.test(withTerms), withTerms);

  // a commit from a real address
  fs.writeFileSync(path.join(tmp, 'x.txt'), 'x\n');
  git('add', 'x.txt'); git('-c', j('user.email=alice', '@', 'mailbox.example.net'), 'commit', '-q', '-m', 'x');
  t('non-noreply commit author found', /git history: a commit author or committer is not a GitHub noreply address/.test(run([]).out));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`selftest: ${ok} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
