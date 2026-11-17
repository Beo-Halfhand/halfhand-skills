// register.mjs: the experiment register. register.json is the copy scripts read; register.md is rendered from it for
// people. One row per change that is meant to improve something, written BEFORE the change goes live.
//
// Row: {
//   "id": "tide-table", "question": "…", "change": "…",
//   "design": "concurrent" | "paired" | "shadow" | "single",
//   "treatment": ["wren"], "control": ["moss"],          // control: concurrent rows only
//   "metric": "xp_per_min", "bar": { "type": "lift", … }, "barText": "…in words, as written on the day…",
//   "barWrittenAt": "<ISO>", "liveSince": "<ISO>" | null, "minSample": 150, "backstop": "YYYY-MM-DD",
//   "status": "running" | "logging" | "DECIDED YYYY-MM-DD: KEEP (<number>, <sample>)" | "CLOSED YYYY-MM-DD: <reason>",
//   "notes": [{ "at": "<ISO>", "kind": "bugfix" | "design" | "infra", "text": "…" }],
//   "source": { "type": "fleet-dashboard", "dataDir": "…", "skill": null, "windowMinutes": 60 },  // optional
//   "baseline": { "from": "<ISO>", "note": "…" }   // optional: one pinned baseline window, from there to go-live
// }
import fs from 'node:fs';
import path from 'node:path';
import { checkBar } from './bars.mjs';

const ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DESIGNS = ['concurrent', 'paired', 'shadow', 'single'];
const VERDICTS = ['KEEP', 'REVERT', 'EXTEND', 'INCONCLUSIVE'];
export const STATUS_RE = /^(running|logging|DECIDED \d{4}-\d{2}-\d{2}: (KEEP|REVERT|EXTEND|INCONCLUSIVE) \(.+\)|CLOSED \d{4}-\d{2}-\d{2}: .+)$/;

export function statusKind(status) {
  if (status === 'running' || status === 'logging') return status;
  if (/^DECIDED /.test(status ?? '')) return /: EXTEND /.test(status) ? 'running' : 'decided';
  if (/^CLOSED /.test(status ?? '')) return 'closed';
  return 'unknown';
}
export const isOpen = (row) => ['running', 'logging'].includes(statusKind(row.status));

const ms = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? Date.parse(iso) : NaN);

// When the clock started: go-live, or the last design change after it (a design change restarts the row).
export function clockFrom(row) {
  let t = ms(row.liveSince);
  for (const n of row.notes ?? []) if (n.kind === 'design' && ms(n.at) > t) t = ms(n.at);
  return Number.isFinite(t) ? t : null;
}
export const backstopMs = (row) => ms(row.backstop) + 86_400_000 - 1;   // the end of that UTC day

// The rules a row must meet. Returns problems; empty = fine. `all` lets it check the "one experiment per agent" rule.
export function checkRow(row, all = [row]) {
  const e = [], at = (m) => e.push(`${row?.id ?? '(no id)'}: ${m}`);
  if (!row || typeof row !== 'object') return ['a row must be an object'];
  if (!ID.test(row.id ?? '')) at('id must be lowercase letters, digits, - or _');
  for (const f of ['question', 'change', 'metric', 'barText']) if (!(typeof row[f] === 'string' && row[f].trim())) at(`${f} is missing`);
  if (!DESIGNS.includes(row.design)) at(`design must be one of ${DESIGNS.join(', ')}`);
  const T = row.treatment, C = row.control ?? [];
  if (!(Array.isArray(T) && T.length && T.every((a) => ID.test(a)))) at('treatment must list at least one agent key');
  if (row.design === 'concurrent') {
    if (!(Array.isArray(C) && C.length && C.every((a) => ID.test(a)))) at('a concurrent row needs a control group (agents left unchanged, same window)');
    else if (Array.isArray(T) && T.some((a) => C.includes(a))) at('an agent cannot be in treatment and control');
  } else if (C.length) at(`a ${row.design} row has no control group (the control is ${row.design === 'paired' ? 'the C windows' : 'the old rule'})`);
  for (const p of checkBar(row.bar, row.design)) at(p);
  if (!Number.isFinite(ms(row.barWrittenAt))) at('barWrittenAt is missing: write the bar down, with the time, before any data');
  if (row.liveSince != null && !Number.isFinite(ms(row.liveSince))) at('liveSince must be an ISO time or null');
  if (Number.isFinite(ms(row.liveSince)) && ms(row.barWrittenAt) > ms(row.liveSince)) at('the bar was written after the change went live: a bar written after the data is not a bar');
  if (!(Number.isInteger(row.minSample) && row.minSample > 0)) at('minSample must be a whole number above 0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.backstop ?? '')) at('backstop must be a date (YYYY-MM-DD): the latest day you will let it run');
  else if (Number.isFinite(ms(row.liveSince)) && backstopMs(row) <= ms(row.liveSince)) at('backstop is before the change went live');
  if (!STATUS_RE.test(row.status ?? '')) at('status must be running, logging, "DECIDED <date>: KEEP|REVERT|EXTEND|INCONCLUSIVE (<number>, <sample>)" or "CLOSED <date>: <reason>"');
  if (statusKind(row.status) === 'running' && row.liveSince == null) at('a running row needs liveSince (use status "logging" before go-live)');
  for (const n of row.notes ?? []) if (!['bugfix', 'design', 'infra', 'decision'].includes(n?.kind) || !Number.isFinite(ms(n?.at)) || !n?.text) at('each note needs at (ISO), kind (bugfix, design, infra, decision) and text');
  if (isOpen(row) && Array.isArray(T)) {
    for (const other of all) {
      if (other === row || other.id === row.id || !isOpen(other)) continue;
      const mine = [...T, ...C], theirs = [...(other.treatment ?? []), ...(other.control ?? [])];
      const both = mine.filter((a) => theirs.includes(a));
      if (both.length) at(`${both.join(', ')} also in open row ${other.id}: one experiment per agent, or neither result means anything`);
    }
  }
  if (all.filter((r) => r.id === row.id).length > 1) at('id is used twice');
  return e;
}

export function loadRegister(dir) {
  const file = path.join(dir, 'register.json');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { return { rows: [], errors: [`register.json: ${err.code === 'ENOENT' ? 'not found' : 'not valid JSON'}`] }; }
  const rows = Array.isArray(raw?.rows) ? raw.rows : null;
  if (!rows) return { rows: [], errors: ['register.json must be { "rows": [ … ] }'] };
  return { rows, errors: rows.flatMap((r) => checkRow(r, rows)), raw };
}

export function saveRegister(dir, raw) {
  const file = path.join(dir, 'register.json'), tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n');
  fs.renameSync(tmp, file);
  fs.writeFileSync(path.join(dir, 'register.md'), renderMd(raw.rows));
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const day = (iso) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : 'not yet');
export function renderMd(rows) {
  const who = (r) => r.design === 'concurrent' ? `${r.treatment.join(', ')} vs ${r.control.join(', ')}` : `${r.treatment.join(', ')} (${r.design})`;
  const head = '| # | Change | Agents | Live since | Bar (written first) | Min sample | Backstop | Status |\n|---|---|---|---|---|---|---|---|\n';
  const line = (r, i) => `| ${i + 1} | ${cell(r.change)} | ${cell(who(r))} | ${day(r.liveSince)} | ${cell(r.barText)} | ${r.minSample} | ${r.backstop} | ${cell(r.status)} |`;
  const open = rows.filter(isOpen), shut = rows.filter((r) => !isOpen(r));
  const notes = rows.filter((r) => r.notes?.length).map((r) => `- **${r.id}**: ${r.notes.map((n) => `${day(n.at)} ${n.kind}: ${cell(n.text)}`).join(' · ')}`);
  return `# Experiment register\n\nGenerated from register.json by \`xk.mjs register\`. Edit the JSON, not this file.\n\n## Open\n\n${head}${open.map(line).join('\n')}\n\n## Decided and closed (the no's stay here too)\n\n${head}${shut.map(line).join('\n')}\n${notes.length ? `\n## Notes (bug fixes keep the clock; a design change restarts it)\n\n${notes.join('\n')}\n` : ''}`;
}

// Recording a decision. A person makes it; this only writes it down, and refuses to write one the data can't carry yet.
export function decide(row, verdict, readout, { today, early = null, why = null } = {}) {
  if (!isOpen(row)) throw new Error(`${row.id} is already ${row.status}`);
  if (verdict === 'CLOSE') { if (!why) throw new Error('CLOSE needs --why (the reason stays in the register)'); return `CLOSED ${today}: ${why}`; }
  if (!VERDICTS.includes(verdict)) throw new Error(`verdict must be ${VERDICTS.join(', ')} or CLOSE`);
  if (!readout) throw new Error('no readout yet: nothing to decide on');
  const pastBackstop = readout.backstopPassed;
  if (!readout.enough && !pastBackstop && verdict !== 'EXTEND' && !early) throw new Error(`${row.id} has ${readout.sampleText} of ${row.minSample}; deciding now needs --early "<reason>"`);
  const tail = [readout.numberText, readout.sampleText, early ? `early: ${early}` : null, pastBackstop && !readout.enough ? 'backstop reached' : null].filter(Boolean).join(', ');
  return `DECIDED ${today}: ${verdict} (${tail})`;
}
