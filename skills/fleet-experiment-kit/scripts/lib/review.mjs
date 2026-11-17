// review.mjs: the daily review. For every open row it reads the outcomes, works out the readout against the bar,
// looks at the raw lines for the things counts hide, and writes ONE verdict per row:
//   STOP             a stop rule in the bar fired: act now
//   LOOKS WRONG      something in the data or the measurement is off (what, and why)
//   READY TO DECIDE  the minimum sample is in and the raw output reads clean, or the backstop has come
//   OK               on track: the number so far, the sample so far
// Two LOOKS WRONG in a row for the same reason, with no entry in decisions.json, go to the top as REPEAT with a
// proposed fix: nothing sits. It measures; it never decides. Every READY TO DECIDE waits for a person.
import fs from 'node:fs';
import path from 'node:path';
import { evaluate } from './bars.mjs';
import { loadRegister, isOpen, clockFrom, statusKind } from './register.mjs';
import { readOutcomes, scoreable } from './outcomes.mjs';
import { mask } from './mask.mjs';
import { num } from './stats.mjs';

const H = 3_600_000, DAY = 24 * H;

export const FIXES = {
  'evidence-empty': 'Check that the hook sits on the path where the event really happens (an agent that never walks through that door logs nothing), then that the collector still runs. Fix it today or close the row with the reason.',
  gaps: 'Find out why readings stopped (sampler down, agent restarted, machine asleep). Unmeasured windows are not zeros; if the gaps hit one arm more than the other, the comparison is biased.',
  'too-clean': 'Suspect the instrument first: identical or all-zero values usually mean a stale read, a snapshot taken at the wrong moment, or a field that is missing and read as 0. Trace one outcome by hand from the source.',
  claims: 'Only confirmed outcomes are scored. Find where the agent\'s claims and the world part ways (a step that reports success before the receipt, a retry counted twice) and fix the agent, not the score.',
  volume: 'Fix volume before reading the bar: give the change more chances to act (more windows, more agents) or move the backstop on purpose, with a note. A bar confirmed on noise is not a result.',
  register: 'Fix the row in register.json. If the fix changes what is being tested, add a design note: the clock restarts.',
};

export function dateIn(t, timeZone = 'UTC') { return new Date(t).toLocaleDateString('en-CA', { timeZone }); }

export function loadDecisions(dir, today) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(path.join(dir, 'decisions.json'), 'utf8')); } catch { return { active: [], problems: [] }; }
  if (!Array.isArray(list)) return { active: [], problems: ['decisions.json must be a list'] };
  const problems = [], active = [];
  for (const d of list) {
    if (!d?.row || !d?.flag || !d?.status || !/^\d{4}-\d{2}-\d{2}$/.test(d?.until ?? '')) { problems.push(`decisions.json: every entry needs row, flag, status and until (YYYY-MM-DD); "${d?.row ?? '?'}/${d?.flag ?? '?'}" is skipped`); continue; }
    if (d.until >= today) active.push(d);
  }
  return { active, problems };
}

export function lastVerdict(dir, today) {
  let files = [];
  try { files = fs.readdirSync(path.join(dir, 'verdicts')).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(0, 10) < today).sort(); } catch { return null; }
  if (!files.length) return null;
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'verdicts', files.at(-1)), 'utf8')); } catch { return null; }
}

// The checks on raw lines that a count would miss. Exported so the gate runner can show each one saying no.
export function rawFlags(row, recs24, readout) {
  const f = [];
  const measured = recs24.filter((r) => r.ok !== false), gaps = recs24.length - measured.length;
  if (!recs24.length) f.push(['evidence-empty', 'no outcomes in the last 24 h: the measurement is broken, or the hook sits on a path the agent never takes']);
  else if (gaps / recs24.length >= 0.25) f.push(['gaps', `${gaps} of ${recs24.length} outcomes in the last 24 h were unmeasured (${[...new Set(recs24.filter((r) => r.ok === false).map((r) => r.why))].join(', ')})`]);
  if (['lift', 'paired-lift'].includes(row.bar?.type)) {
    for (const arm of ['T', 'C']) {
      const v = measured.filter((r) => r.arm === arm && scoreable(r)).map((r) => r.value);
      if (v.length >= 8 && v.every((x) => x === v[0])) f.push(['too-clean', `the last ${v.length} ${arm} values are all exactly ${v[0]}`]);
    }
  }
  const unconf = measured.filter((r) => !scoreable(r)).length;
  if (unconf >= 2 && unconf / Math.max(1, measured.length) >= 0.1) {
    f.push(['claims', `the agent reported ${measured.length} in the last 24 h, the world confirmed ${measured.length - unconf}; only the ${measured.length - unconf} are scored`]);
  }
  if (readout && readout.projected !== null && !readout.enough && !readout.backstopPassed && readout.projected < row.minSample) {
    f.push(['volume', `at this pace about ${readout.projected} of ${row.minSample} by the backstop (${row.backstop})`]);
  }
  return f;
}

export function review(dir, { now = Date.now(), timeZone = 'UTC' } = {}) {
  const today = dateIn(now, timeZone);
  const reg = loadRegister(dir), dec = loadDecisions(dir, today), prev = lastVerdict(dir, today);
  const rows = [], badRows = new Set(reg.errors.map((e) => e.split(':')[0]));
  let lines24 = 0;
  for (const row of reg.rows.filter(isOpen)) {
    const recs = readOutcomes(dir, { exp: row.id });
    const recs24 = recs.filter((r) => r.t >= now - DAY && r.t < now);
    lines24 += recs24.length;
    const clock = clockFrom(row), live = clock !== null && statusKind(row.status) === 'running';
    const readout = live ? evaluate(row, recs, now) : null;
    let flags = [];
    const ageFrom = live ? clock : Date.parse(row.barWrittenAt);
    if (now - ageFrom >= DAY) flags = rawFlags(row, live ? recs24.filter((r) => r.arm !== 'baseline') : recs24, readout);
    if (badRows.has(row.id)) flags.unshift(['register', reg.errors.filter((e) => e.startsWith(row.id + ':')).map((e) => e.slice(row.id.length + 2)).join('; ')]);
    const suppressed = flags.filter(([k]) => dec.active.some((d) => d.row === row.id && d.flag === k));
    const open = flags.filter((x) => !suppressed.includes(x));
    let verdict, text;
    if (readout?.state === 'stop') { verdict = 'STOP'; text = `${readout.stop}. The bar says stop now: revert and write down why.`; }
    else if (open.length) { verdict = 'LOOKS WRONG'; text = open.map(([k, m]) => `${m} [${k}]`).join('; '); }
    else if (readout && (readout.enough || readout.backstopPassed)) {
      verdict = 'READY TO DECIDE';
      text = readout.enough ? `bar ${readout.state === 'met' ? 'MET' : 'NOT MET'}: ${readout.numberText}; ${readout.sampleText} (min ${row.minSample})`
        : `backstop ${row.backstop} reached with ${readout.sampleText} of ${row.minSample}: ${readout.numberText}. Decide anyway; EXTEND needs a written reason`;
    } else if (!live) { verdict = 'OK'; text = `logging only (not live): ${recs24.length} outcomes in the last 24 h`; }
    else { verdict = 'OK'; text = `${readout.numberText}; ${readout.sampleText} of ${row.minSample}${readout.nextLook ? `, next look at ${readout.nextLook}` : ''}`; }
    const was = prev?.rows?.find((r) => r.id === row.id);
    const repeat = verdict === 'LOOKS WRONG' && was?.verdict === 'LOOKS WRONG' ? open.filter(([k]) => was.flags?.includes(k)).map(([k]) => k) : [];
    rows.push({ row, verdict, text, flags: open.map(([k]) => k), suppressed: suppressed.map(([k]) => k), repeat, readout, raw: (live ? readout.recent : recs24).slice(-3) });
  }
  const shut = reg.rows.filter((r) => !isOpen(r)).length;
  const md = render({ today, reg, dec, prev, rows, shut, lines24 });
  const json = { date: today, at: new Date(now).toISOString(), rows: rows.map((r) => ({ id: r.row.id, verdict: r.verdict, flags: r.flags, suppressed: r.suppressed, repeat: r.repeat, number: r.readout?.number ?? null, sample: r.readout?.sample ?? null, state: r.readout?.state ?? null })) };
  return { today, md, json, rows };
}

export function writeReview(dir, res) {
  const d = path.join(dir, 'verdicts');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${res.today}.md`), res.md);
  fs.writeFileSync(path.join(d, `${res.today}.json`), JSON.stringify(res.json, null, 2) + '\n');
  return path.join(d, `${res.today}.md`);
}

const fmtRaw = (r) => {
  const when = new Date(r.t).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
  const what = r.ok === false ? `not measured (${r.why})` : `${r.metric}=${num(r.value)}${r.flags?.length ? ` flags=${r.flags.join(',')}` : ''}`;
  const proof = r.ok === false ? '' : scoreable(r) ? ` ✓ ${r.proof}` : ` ✗ unconfirmed${r.claimed ? `: claimed ${JSON.stringify(r.claimed)}` : ''}`;
  return mask(`${when} ${r.agent} ${r.arm}${r.pair ? ` pair ${r.pair}` : ''} ${what}${proof}`);
};

function render({ today, reg, dec, prev, rows, shut, lines24 }) {
  const o = [];
  o.push(`# Daily review: ${today}`, '');
  o.push(`Read: register.json (${reg.rows.length} rows: ${rows.length} open, ${shut} decided or closed), the outcome log for the open rows (${lines24} outcomes in the last 24 h), decisions.json (${dec.active.length} in force), the last review (${prev?.date ?? 'none'}).`);
  o.push('', '_This review measures. It never decides: every READY TO DECIDE waits for a person._', '');
  const stop = rows.filter((r) => r.verdict === 'STOP'), rep = rows.filter((r) => r.repeat.length);
  if (stop.length) { o.push('## STOP (act now)', ''); for (const r of stop) o.push(`- **${r.row.id}**: ${r.text}`); o.push(''); }
  if (rep.length) {
    o.push('## REPEAT (LOOKS WRONG two reviews running, no decision)', '');
    for (const r of rep) o.push(`- **${r.row.id}** LOOKS WRONG again (${r.repeat.join(', ')}). **Proposed:** ${r.repeat.map((k) => FIXES[k]).join(' ')}`);
    o.push('');
  }
  o.push('## Rows', '');
  for (const [i, r] of rows.entries()) {
    o.push(`### ${i + 1}. ${r.row.id}: ${r.verdict}`, '');
    o.push(`${r.text}`, '');
    o.push(`- Bar (written ${String(r.row.barWrittenAt).slice(0, 10)}): ${r.row.barText}`);
    if (r.readout && ['LOOKS WRONG', 'STOP'].includes(r.verdict)) o.push(`- Readout so far: ${r.readout.numberText}; ${r.readout.sampleText} of ${r.row.minSample}`);
    if (r.readout) {
      const u = r.readout.unscored, bits = [];
      if (u.guard) bits.push(`${u.guard} dropped by the reward guard (${[...new Set(r.readout.guardDrops.map((d) => d.why))].join('; ')})`);
      if (u.gap) bits.push(`${u.gap} not measured`);
      if (u.unconfirmed) bits.push(`${u.unconfirmed} claimed but not confirmed`);
      o.push(`- Scored: ${r.readout.scored ?? 0}${bits.length ? `. Not scored: ${bits.join(', ')}` : ''}`);
      if (r.readout.baseline) o.push(`- Baseline (pinned, before go-live): median ${num(r.readout.baseline.median)} over ${r.readout.baseline.n}`);
    }
    if (r.suppressed.length) o.push(`- Settled in decisions.json, not re-flagged: ${r.suppressed.join(', ')}`);
    o.push('', 'Raw (newest last):', '', '```', ...(r.raw.length ? r.raw.map(fmtRaw) : ['(none)']), '```', '');
  }
  if (dec.active.length) { o.push('## Settled (decisions.json)', ''); for (const d of dec.active) o.push(`- ${d.row} · ${d.flag} · ${d.status} until ${d.until}${d.note ? `: ${d.note}` : ''}`); o.push(''); }
  const probs = [...reg.errors, ...dec.problems];
  if (probs.length) { o.push('## Register problems', ''); for (const p of probs) o.push(`- ${p}`); o.push(''); }
  return o.join('\n');
}
