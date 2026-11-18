// jobs.mjs: what each card says about the agent's work, beyond its light: its JOB in words, ONE number for it, and
// the LAST meaningful thing it did. Also which agents are RETIRED (kept in fleet.json, but off the page).
// Pure helpers plus two small file reads (the jobs file and a retired flag), so the self-test can check every rule.
//
//   "job":     { "title": "Woodcutting at the tree stand", "slot": "second seat", "status": "live",
//                "number": { "label": "Woodcutting XP", "xp": "woodcutting" } }        one of: xp, counter, value
//   "lastDid": [ { "match": "\"event\":\"act\",\"act\":\\[\"(\\w+)\"", "say": "sent $1 (confirmed)" } ]
//   "retired": true | "a short note"        or   "retiredFile": "~/agents/scout/RETIRED"
//   top level "jobsFile": "./jobs.json"     { "agents": { "<key>": { <a job, as above> } } }, re-read every minute
import fs from 'node:fs';
import { mask } from './mask.mjs';

// Text only, short, masked. The page inserts it with textContent; this keeps it readable and free of secrets too.
export const clean = (s, n) => mask(String(s ?? '')).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const SKILL_RE = /^[a-z0-9][a-z0-9_ -]{0,39}$/i, COUNTER_RE = /^[a-z][a-z0-9_]{0,30}$/i;
const STATUS = ['live', 'staged', 'paused', 'planned', 'testing'];

// One job entry → { job, errors }. Used for fleet.json (errors stop the start) and for the jobs file (bad entries dropped).
export function parseJob(raw, at) {
  const errors = [];
  if (raw === undefined || raw === null) return { job: null, errors };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { job: null, errors: [`${at} must be an object like { "title": "…" }`] };
  const title = clean(raw.title, 60);
  if (!title) errors.push(`${at}.title must say the job in words (up to 60 characters)`);
  const status = raw.status === undefined ? 'live' : String(raw.status);
  if (!STATUS.includes(status)) errors.push(`${at}.status must be one of ${STATUS.join(', ')}`);
  let number = null;
  const n = raw.number;
  if (n !== undefined) {
    const src = ['xp', 'counter', 'value'].filter((k) => n?.[k] !== undefined);
    if (!n || typeof n !== 'object' || !clean(n.label, 40)) errors.push(`${at}.number needs a label (what the number is)`);
    else if (src.length !== 1) errors.push(`${at}.number needs exactly one of xp (a skill), counter (a counter name) or value (text you keep up to date)`);
    else if (n.xp !== undefined && !SKILL_RE.test(String(n.xp))) errors.push(`${at}.number.xp must be a skill name`);
    else if (n.counter !== undefined && !COUNTER_RE.test(String(n.counter))) errors.push(`${at}.number.counter must be a counter name`);
    else if (n.as !== undefined && !['number', 'rank'].includes(n.as)) errors.push(`${at}.number.as must be "number" or "rank"`);
    else {
      number = { label: clean(n.label, 40), as: n.as ?? 'number' };
      if (n.xp !== undefined) number.xp = String(n.xp).toLowerCase().replace(/[ -]+/g, '_');
      if (n.counter !== undefined) number.counter = String(n.counter);
      if (n.value !== undefined) { number.value = clean(n.value, 30); number.asOf = n.asOf ? clean(n.asOf, 20) : null; }
    }
  }
  if (errors.length) return { job: null, errors };
  return { job: { title, slot: raw.slot ? clean(raw.slot, 50) : null, status, number }, errors };
}

// lastDid rules → { rules, errors }. "say" may use $1 … $9 from the match and nothing else from the line.
export function parseLastDid(raw, at) {
  const rules = [], errors = [];
  if (raw === undefined) return { rules, errors };
  if (!Array.isArray(raw) || raw.length > 20) return { rules, errors: [`${at} must be a list of up to 20 { "match", "say" } rules`] };
  for (const [i, r] of raw.entries()) {
    const say = typeof r?.say === 'string' ? r.say.trim().slice(0, 80) : '';
    if (!say) { errors.push(`${at}[${i}].say must be the words to show, like "sold $1 fish"`); continue; }
    try { rules.push({ re: new RegExp(String(r.match)), say }); } catch { errors.push(`${at}[${i}].match is not a valid regular expression`); }
  }
  return { rules, errors };
}

// The newest log line that a rule matches, as { t, text }. Lines are read newest first; on each line the rules are
// tried in order. Captures are masked and capped; underscores and dashes read as spaces; nothing else is copied.
export function lastDidOf(lines, rules, timeOf, max = 2000) {
  if (!lines?.length || !rules?.length) return null;
  for (let i = lines.length - 1, seen = 0; i >= 0 && seen < max; i--, seen++) {
    for (const { re, say } of rules) {
      const m = re.exec(lines[i]);
      if (!m) continue;
      // mask BEFORE making underscores into spaces, or "sk_live_…" would become "sk live …" and slip past the masker
      const text = clean(say.replace(/\$([1-9])/g, (_, d) => clean(mask(String(m[d] ?? '')).replace(/[_-]+/g, ' '), 40)), 80);
      if (text) return { t: timeOf(lines[i]), text };
    }
  }
  return null;
}

// The card's one number, from the newest good reading (xp, counters) and the log's counters, or the value you wrote.
const n0 = (x) => Math.round(Number(x)).toLocaleString('en-US');
const short = (x) => { const a = Math.abs(x); return a >= 1e6 ? `${(x / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e4 ? `${Math.round(x / 1e3)}k` : n0(x); };
export function numberView(number, good, counters) {
  if (!number) return null;
  if (number.value !== undefined) return { label: number.label, value: number.value, live: false, note: number.asOf ? `as of ${number.asOf}` : null };
  const v = number.xp !== undefined ? good?.xp?.[number.xp] : counters?.[number.counter];
  if (!Number.isFinite(Number(v)) || v === null) return { label: number.label, value: '—', live: false, note: 'not read yet' };
  const shown = number.as === 'rank' ? `#${n0(v)}` : number.xp !== undefined ? `${short(Number(v))} XP` : n0(v);
  return { label: number.label, value: shown, live: true, note: null };
}

// The jobs file: re-read at most once a minute, so a job can change without restarting the dashboard. A missing or
// broken file means "no jobs from the file" (fleet.json's own jobs still show); bad entries are dropped one by one.
const jobsCache = new Map();   // file → { at, mtime, jobs }
export function jobsFromFile(file, now = Date.now()) {
  if (!file) return {};
  const c = jobsCache.get(file);
  if (c && now - c.at < 60_000) return c.jobs;
  let mtime = null; try { mtime = fs.statSync(file).mtimeMs; } catch { /* no file */ }
  if (c && c.mtime === mtime) { c.at = now; return c.jobs; }
  const jobs = {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [k, v] of Object.entries(raw?.agents ?? {})) { const { job } = parseJob(v, k); if (job && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(k)) jobs[k] = job; }
  } catch { /* missing or not JSON */ }
  jobsCache.set(file, { at: now, mtime, jobs });
  return jobs;
}

// Retired = "retired" in fleet.json, or the retiredFile exists. Checked every time, so creating the file takes the
// agent off the page and out of the sampler on the next read, with no restart. The file's text is the note.
export function retiredOf(a) {
  if (a.retired) return { since: null, note: typeof a.retired === 'string' ? clean(a.retired, 160) : null };
  if (!a.retiredFile) return null;
  let st; try { st = fs.statSync(a.retiredFile); } catch { return null; }
  let note = ''; try { note = fs.readFileSync(a.retiredFile, 'utf8').slice(0, 2000); } catch { /* a folder, or unreadable: still retired */ }
  return { since: st.mtimeMs, note: clean(note, 160) || null };
}
