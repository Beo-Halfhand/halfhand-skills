#!/usr/bin/env node
// leak-check.mjs: look for secrets and setup details in a folder before it leaves the machine.
// The same rules run in this repo's CI (tools/check.mjs imports them from here).
//
//   node leak-check.mjs [folder]            files git would publish (tracked + untracked, not ignored), or every file if not a repo
//   node leak-check.mjs [folder] --history  also every line ever added in the git history (all branches)
//   LEAK_TERMS=<file> node leak-check.mjs   add your own terms: one case-insensitive regex per line, file kept OUTSIDE the folder
//
// Prints file:line and the rule name. Never prints the matching text. Exit 0 clean, 1 findings, 2 usage error.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RULES = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY/],
  ['api key', /\b(sk-ant-[\w-]{10,}|sk-[A-Za-z0-9_-]{32,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xai-[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,})/],
  ['secret assignment', /\b[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|API_KEY|SEED|MNEMONIC)[A-Z0-9_]*\s*[=:]\s*["']?[A-Za-z0-9+/_-]{12,}/],
  ['key in url', /[?&](api[_-]?key|apikey|project_id|access_token|auth|token|secret|key)=[^&\s"'<$]{8,}/i],
  ['password in url', /\/\/[^/\s:@'"]+:[^@\s/'"<$]{6,}@/],
  ['bearer token', /Bearer\s+[A-Za-z0-9._~+/-]{20,}/],
  ['64-hex value', /\b[0-9a-f]{64}\b/i],
  ['home path', /\/Users\/[A-Za-z]|\/home\/[A-Za-z][\w-]*\//],
  ['synced folder', /Cloud[S]torage|Dropbox\//i],
  ['private network', /\.ts\.net\b|\btailscale\b|\b(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+\b/i],
  ['machine name', /\b[\w-]+s-(Mac|MacBook)[\w-]*|(?<![\w.-])[\w-]+\.local\b(?![.\w-])/],
  ['scheduler label', /\bcom\.(?!example\b)[a-z0-9-]+\.[a-z0-9-]+-?(sync|watch|digest|agent)\b|LaunchAgents\//],
  ['email', /[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com|example\.(com|org)|anthropic\.com)[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/],
];
// Files that must not be published whatever is inside them.
export const FORBIDDEN = /(^|\/)(\.env[^/]*|\.dev\.vars|[^/]*\.plist|[^/]*\.(pem|key|p12)|[^/]*(seed|mnemonic|wallet)[^/]*\.(txt|json|hex)|seed|[^/]*\.seed|id_(rsa|ed25519|ecdsa))$/i;

export function termsFrom(file) {
  if (!file) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  return lines.map((s, i) => [`private term ${i + 1}`, new RegExp(s, 'i')]);
}

const gitIn = (root) => (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });

/** Files to scan: what git would publish, or every file when the folder is not a git checkout. */
export function filesIn(root) {
  try { return gitIn(root)('ls-files', '-co', '--exclude-standard').split('\n').filter(Boolean).filter((f) => fs.existsSync(path.join(root, f))); }
  catch {
    const out = [];
    const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      if (['.git', 'node_modules'].includes(e.name)) continue;
      const p = path.join(d, e.name); e.isDirectory() ? walk(p) : out.push(p);
    } };
    walk('');
    return out;
  }
}

/** Scan text line by line. Returns [{ where, rule }]. */
export function scanText(text, where, rules) {
  const hits = [];
  text.split('\n').forEach((line, i) => { for (const [rule, re] of rules) if (re.test(line)) hits.push({ where: `${where}:${i + 1}`, rule }); });
  return hits;
}

/** The whole check on one folder. skip: files not to scan (e.g. this script). */
export function check(root, { history = false, terms = [], skip = [] } = {}) {
  const rules = [...RULES, ...terms];
  const hits = [];
  const files = filesIn(root);
  for (const f of files) {
    if (FORBIDDEN.test(f)) hits.push({ where: f, rule: 'file type that must not be published' });
    if (skip.includes(f)) continue;
    const buf = fs.readFileSync(path.join(root, f));
    if (buf.includes(0)) continue; // binary
    hits.push(...scanText(buf.toString('utf8'), f, rules));
  }
  let git = null;
  try { git = gitIn(root); git('rev-parse', '--git-dir'); } catch { git = null; }
  if (git) {
    let ids = [];
    try { ids = git('log', '--all', '--format=%ae%n%ce').split('\n').filter(Boolean); } catch { /* no commits yet */ }
    for (const e of new Set(ids)) if (!/@users\.noreply\.github\.com$/.test(e)) hits.push({ where: 'git history', rule: 'a commit author or committer is not a GitHub noreply address' });
    if (history) {
      let log = '';
      try { log = git('log', '-p', '--all', '--format=commit %h', '--no-color', '--unified=0'); } catch { /* no commits */ }
      let commit = '?', file = '?';
      for (const line of log.split('\n')) {
        if (line.startsWith('commit ')) { commit = line.slice(7); continue; }
        if (line.startsWith('+++ ')) { file = line.slice(6); continue; }
        if (!line.startsWith('+') || line.startsWith('+++')) continue;
        if (skip.includes(file)) continue;
        for (const [rule, re] of rules) if (re.test(line.slice(1))) hits.push({ where: `history ${commit} ${file}`, rule });
      }
      let names = '';
      try { names = git('log', '--all', '--name-only', '--format='); } catch { /* none */ }
      for (const f of new Set(names.split('\n').filter(Boolean))) if (FORBIDDEN.test(f)) hits.push({ where: `history ${f}`, rule: 'file type that must not be published (in an old commit)' });
    }
  }
  return { files: files.length, hits };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const history = args.includes('--history');
  const pos = args.filter((a) => !a.startsWith('--'));
  if (args.some((a) => a.startsWith('--') && a !== '--history') || pos.length > 1) { console.log('usage: leak-check.mjs [folder] [--history]'); process.exit(2); }
  const root = path.resolve(pos[0] ?? '.');
  if (!fs.existsSync(root)) { console.log(`no folder ${pos[0]}`); process.exit(2); }
  const terms = termsFrom(process.env.LEAK_TERMS);
  if (process.env.LEAK_TERMS && path.resolve(process.env.LEAK_TERMS).startsWith(root + path.sep)) console.log('warning: your LEAK_TERMS file is inside the folder you are checking; move it out');
  const self = path.relative(root, fileURLToPath(import.meta.url));
  const { files, hits } = check(root, { history, terms, skip: self.startsWith('..') ? [] : [self] });
  const seen = new Set();
  for (const h of hits) { const k = `${h.where}: ${h.rule}`; if (!seen.has(k)) { seen.add(k); console.log(k); } }
  console.log(`\nleak-check: ${seen.size ? `${seen.size} finding(s)` : 'clean'} · ${files} file(s)${history ? ' + history' : ''}${terms.length ? ` · ${terms.length} private term(s)` : ''}`);
  process.exit(seen.size ? 1 : 0);
}
