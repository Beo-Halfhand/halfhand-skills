#!/usr/bin/env node
// tools/check.mjs: the repo's release gate, run in CI and before any visibility change.
//   1. every skills/<name>/SKILL.md has frontmatter with a valid `name` (= folder) and a `description`
//   2. every skill folder has a README.md
//   3. relative links in every .md file resolve
//   4. no secrets or setup details in tracked files (prints file:line and the rule, never the match)
//   5. every commit author and committer uses a GitHub noreply address
// Optional: LEAK_TERMS=<file outside the repo>, one case-insensitive regex per line, for your own
// names, hosts and ids. Exit 0 clean, 1 findings.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = path.relative(ROOT, fileURLToPath(import.meta.url));
const problems = [];
const bad = (where, msg) => problems.push(`${where}: ${msg}`);
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

let files;
try { files = git('ls-files', '-co', '--exclude-standard').split('\n').filter(Boolean); }
catch {
  files = [];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(e.name)) continue;
    const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p);
  } };
  walk('');
}
files = files.filter((f) => fs.existsSync(path.join(ROOT, f)));

// 1-2. skills
const skillsDir = path.join(ROOT, 'skills');
const skills = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
for (const name of skills) {
  const dir = `skills/${name}`, skillMd = path.join(ROOT, dir, 'SKILL.md');
  if (!fs.existsSync(skillMd)) { bad(dir, 'no SKILL.md'); continue; }
  if (!fs.existsSync(path.join(ROOT, dir, 'README.md'))) bad(dir, 'no README.md');
  const m = fs.readFileSync(skillMd, 'utf8').match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) { bad(`${dir}/SKILL.md`, 'no frontmatter'); continue; }
  const fm = Object.fromEntries(m[1].split('\n').map((l) => l.match(/^([a-z][\w-]*):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2].trim()]));
  if (!fm.name) bad(`${dir}/SKILL.md`, 'frontmatter has no name');
  else {
    if (fm.name !== name) bad(`${dir}/SKILL.md`, `name "${fm.name}" does not match folder "${name}"`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name) || fm.name.length > 64) bad(`${dir}/SKILL.md`, 'name must be lowercase words joined by hyphens, 64 chars max');
  }
  if (!fm.description) bad(`${dir}/SKILL.md`, 'frontmatter has no description');
  else if (fm.description.length > 1024) bad(`${dir}/SKILL.md`, `description is ${fm.description.length} chars (max 1024)`);
}

// 3. relative links in markdown
for (const f of files.filter((f) => f.endsWith('.md'))) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const p = path.join(ROOT, path.dirname(f), decodeURI(target.split('#')[0]));
    if (!fs.existsSync(p)) bad(f, `broken link ${target}`);
  }
}

// 4. leaks: the same rules as skills/prepublish-leak-check (one source, so CI and the skill can't drift)
const LEAK_SCRIPT = 'skills/prepublish-leak-check/scripts/leak-check.mjs';
const { RULES, FORBIDDEN, termsFrom } = await import(new URL(`../${LEAK_SCRIPT}`, import.meta.url));
const extra = termsFrom(process.env.LEAK_TERMS);

// Documented placeholders (approved by the repo owner, 2026-11-17). The mirrored-workspace skill uses one
// mesh-VPN product as its worked example, so a few lines name the product and a placeholder network name.
// Rules of this allowlist:
//   - exact file paths and exact literal strings only: no regex, no wildcard
//   - only the 'private network' rule; private terms (LEAK_TERMS) and every other rule still apply
//   - a line passes only if the rule stops matching once these literal strings are cut out, so a real
//     network name, machine name or IP on the same line still fails
//   - each file has a maximum number of excused lines; one more is a problem, not a pass
// The two strings are assembled from parts so this file holds no text the leak-check skill would flag.
const MESH_NAME = ['Tail', 'scale'].join('');
const MESH_PLACEHOLDER = ['always-on.your-tailnet', 'ts', 'net'].join('.');
const PLACEHOLDERS = [
  { file: 'skills/mirrored-workspace/references/private-network.md', rule: 'private network', strings: [MESH_NAME, MESH_PLACEHOLDER], maxLines: 4 },
  { file: 'skills/mirrored-workspace/SKILL.md', rule: 'private network', strings: [MESH_NAME], maxLines: 1 },
];
const excusedCount = new Map();
const excused = (f, rule, re, line) => {
  const a = PLACEHOLDERS.find((p) => p.file === f && p.rule === rule);
  if (!a) return false;
  const rest = a.strings.reduce((l, s) => l.split(s).join(' '), line);
  if (rest === line || re.test(rest)) return false;
  excusedCount.set(f, (excusedCount.get(f) ?? 0) + 1);
  return true;
};
for (const f of files) {
  if (f === SELF || f === LEAK_SCRIPT || f === 'LICENSE') continue;
  const buf = fs.readFileSync(path.join(ROOT, f));
  if (buf.includes(0)) continue; // binary
  buf.toString('utf8').split('\n').forEach((line, i) => {
    for (const [rule, re] of [...RULES, ...extra]) if (re.test(line) && !excused(f, rule, re, line)) bad(`${f}:${i + 1}`, rule);
  });
}
for (const a of PLACEHOLDERS) {
  const n = excusedCount.get(a.file) ?? 0;
  if (n > a.maxLines) bad(a.file, `${n} lines use the documented placeholders, more than the ${a.maxLines} allowed`);
}
for (const f of files) if (FORBIDDEN.test(f)) bad(f, 'file type that must not be published');

// 5. commit identities
try {
  const ids = git('log', '--all', '--format=%ae%n%ce').split('\n').filter(Boolean);
  for (const e of new Set(ids)) if (!/@users\.noreply\.github\.com$/.test(e)) bad('git history', 'a commit author or committer is not a GitHub noreply address');
} catch { /* not a git checkout */ }

if (problems.length) { console.log(problems.join('\n')); console.log(`\ncheck: ${problems.length} problem(s)`); process.exit(1); }
console.log(`check: clean (${skills.length} skill(s), ${files.length} file(s)${extra.length ? `, ${extra.length} private term(s)` : ''})`);
