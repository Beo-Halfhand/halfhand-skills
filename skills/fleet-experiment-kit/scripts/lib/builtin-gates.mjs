// builtin-gates.mjs: the kit's own gates, each with the known-bad cases it must refuse. `xk.mjs gates` runs these
// before your own, so the kit proves it can say no before you trust a single readout from it.
import { checkRow, decide } from './register.mjs';
import { evaluate } from './bars.mjs';
import { rewardGuard, confirmReading } from './guard.mjs';
import { checkOutcome, scoreable } from './outcomes.mjs';
import { rawFlags } from './review.mjs';
import { rng } from './stats.mjs';

const NOW = Date.UTC(2026, 0, 20, 12), H = 3_600_000, DAY = 24 * H;
const iso = (t) => new Date(t).toISOString();

const row = (over = {}) => ({
  id: 'faster-nets', question: 'Do the new nets catch more per hour?', change: 'new nets', design: 'concurrent',
  treatment: ['ash', 'birch'], control: ['cedar', 'dune'], metric: 'catch_per_min', barText: 'median catch per minute ≥ +15% vs control',
  bar: { type: 'lift', min: 0.15 }, barWrittenAt: iso(NOW - 9 * DAY), liveSince: iso(NOW - 8 * DAY), minSample: 100,
  backstop: new Date(NOW + 6 * DAY).toISOString().slice(0, 10), status: 'running', ...over,
});

// Outcomes for a lift row: n per arm, centred on 100 (control) and 100 × (1 + lift) (treatment), ±spread.
function liftRecs({ n = 200, nT = n, nC = n, lift = 0.3, spread = 0.1, seed = 's' }) {
  const r = rng(seed), out = [];
  const add = (arm, k, centre) => { for (let i = 0; i < k; i++) out.push({ t: NOW - 7 * DAY + i * 60_000 * 30, exp: 'faster-nets', agent: arm === 'T' ? 'ash' : 'cedar', arm, metric: 'catch_per_min', value: centre * (1 + (r() * 2 - 1) * spread), confirmed: true, proof: 'harbour ledger' }); };
  add('T', nT, 100 * (1 + lift)); add('C', nC, 100);
  return out;
}
function pairRecs({ n, lift, spread, seed = 'p' }) {
  const r = rng(seed), out = [];
  for (let p = 1; p <= n; p++) {
    const c = 50 * (1 + (r() * 2 - 1) * 0.2), t = c * (1 + lift + (r() * 2 - 1) * spread);
    for (const [arm, v] of [['C', c], ['T', t]]) out.push({ t: NOW - 6 * DAY + p * H, exp: 'faster-nets', agent: 'ash', arm, pair: p, metric: 'catch_per_min', value: v, confirmed: true, proof: 'harbour ledger' });
  }
  return out;
}
function decisions({ n, flagged = {}, seed = 'd' }) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ t: NOW - 5 * DAY + i * 60_000, exp: 'faster-nets', agent: 'ash', arm: 'T', metric: 'decision', value: 1, confirmed: true, proof: 'shadow log', flags: [] });
  let i = 0;
  for (const [flag, k] of Object.entries(flagged)) for (let j = 0; j < k; j++) out[(i++ * 37) % n].flags.push(flag);
  return out;
}
const pairedRow = row({ id: 'faster-nets', design: 'paired', treatment: ['ash'], control: undefined, bar: { type: 'paired-lift', min: 0.03, lowerBoundAbove: 0, stopBelow: -0.1, stopAfter: 20 }, minSample: 60 });
const rateRow = row({ design: 'shadow', treatment: ['ash'], control: undefined, metric: 'decision', bar: { type: 'rate', flag: 'fallback', max: 0.01, none: ['harmful'] }, minSample: 500 });

const outcome = { t: NOW - H, v: 1, exp: 'faster-nets', agent: 'ash', arm: 'T', metric: 'catch_per_min', value: 104.5, confirmed: true, proof: 'receipt R-0417' };
const last24 = (recs) => recs.map((r, i) => ({ ...r, t: NOW - DAY + (i + 1) * (DAY / (recs.length + 1)) }));
const varied = last24(liftRecs({ n: 12, seed: 'v' }));

export const BUILTIN_GATES = [
  {
    name: 'register-row',
    why: 'a row that breaks the rules (bar after the data, no control, no minimum) must not be accepted',
    accept: (rows) => rows.flatMap((r) => checkRow(r, rows)).length === 0,
    good: [{ label: 'a concurrent row', input: [row()] }, { label: 'two rows, different agents', input: [row(), row({ id: 'night-shift', treatment: ['elm'], control: ['fir'] })] }],
    bad: [
      { label: 'bar written after go-live', input: [row({ barWrittenAt: iso(NOW - 7 * DAY) })] },
      { label: 'no minimum sample', input: [row({ minSample: 0 })] },
      { label: 'an agent in both groups', input: [row({ control: ['cedar', 'ash'] })] },
      { label: 'backstop before go-live', input: [row({ backstop: '2025-12-01' })] },
      { label: 'concurrent with no control', input: [row({ control: [] })] },
      { label: 'no bar', input: [row({ bar: undefined })] },
      { label: 'one agent in two open rows', input: [row(), row({ id: 'night-shift', treatment: ['birch'], control: ['fir'] })] },
    ],
    mutants: [['0.barWrittenAt', 'future'], ['0.minSample', 'zero'], ['0.bar', 'drop'], ['0.backstop', 'drop'], ['0.control', 'drop'], ['0.bar.min', 'drop'], ['0.status', 'flip']],
  },
  {
    name: 'outcome-record',
    why: 'the outcome log refuses records that cannot be scored honestly',
    accept: (o) => checkOutcome(o, NOW).length === 0,
    good: [{ label: 'a confirmed outcome', input: outcome }],
    bad: [
      { label: 'time in the future', input: { ...outcome, t: NOW + DAY } },
      { label: 'confirmed with no proof', input: { ...outcome, proof: '' } },
      { label: 'confirmed left out', input: { ...outcome, confirmed: undefined } },
      { label: 'value missing (not a zero)', input: { ...outcome, value: undefined } },
      { label: 'unknown arm', input: { ...outcome, arm: 'B' } },
    ],
    mutants: [['agent', 'drop'], ['t', 'future'], ['arm', 'flip'], ['proof', 'drop'], ['confirmed', 'drop'], ['value', 'drop'], ['exp', 'drop']],
  },
  {
    name: 'score-confirmed-only',
    why: 'only what the world confirmed is scored, never what the agent claimed',
    accept: scoreable,
    good: [{ label: 'confirmed by a receipt', input: outcome }],
    bad: [
      { label: 'claimed only', input: { ...outcome, confirmed: false, claimed: { trades: 3 } } },
      { label: 'confirmed with an empty proof', input: { ...outcome, proof: ' ' } },
      { label: 'an unmeasured window', input: { ...outcome, ok: false, why: 'sampling gap' } },
      { label: 'value is not a number', input: { ...outcome, value: 'lots' } },
    ],
    mutants: [['proof', 'drop'], ['confirmed', 'drop'], ['value', 'drop']],
  },
  {
    name: 'reward-guard',
    why: 'one glitched reading must not carry a result',
    accept: ({ history, value }) => { const recs = [...history, value].map((v, i) => ({ agent: 'ash', metric: 'm', value: v, i })); return rewardGuard(recs).keep.some((r) => r.i === history.length); },
    good: [{ label: '1.4× the usual', input: { history: [100, 110, 95, 105, 120], value: 140 } }],
    bad: [
      { label: '45× the agent\'s own median', input: { history: [100, 110, 95, 105, 120], value: 4700 } },
      { label: 'negative', input: { history: [100, 110, 95], value: -20 } },
      { label: 'missing', input: { history: [100, 110, 95], value: undefined } },
      { label: 'NaN', input: { history: [100, 110, 95], value: NaN } },
    ],
    mutants: [['value', 'drop'], ['value', 'negate']],
  },
  {
    name: 'confirm-before-log',
    why: 'a polled value is logged only when a second read agrees; A→B→A is a flap',
    accept: ({ reads }) => { const s = {}; confirmReading(s, 'k', reads[0]); return reads.slice(1).some((v, i) => confirmReading(s, 'k', v, i + 1) !== null); },
    good: [{ label: 'B read twice', input: { reads: [5, 7, 7] } }],
    bad: [
      { label: 'A→B→A flap', input: { reads: [5, 7, 5] } },
      { label: 'B seen once', input: { reads: [5, 7] } },
      { label: 'two different candidates', input: { reads: [5, 7, 8] } },
      { label: 'alternating copies', input: { reads: [5, 7, 5, 7, 5] } },
    ],
    mutants: [['reads.2', 'bump'], ['reads.2', 'drop']],
  },
  {
    name: 'bar-lift',
    why: 'the lift bar must not pass noise, a small win, or a big win on too little data',
    accept: (recs) => evaluate(row(), recs, NOW).state === 'met',
    good: [{ label: '+30%, 200 a side', input: liftRecs({ lift: 0.3 }) }],
    bad: [
      { label: 'no difference, 200 a side', input: liftRecs({ lift: 0 }) },
      { label: '+5%, under the +15% bar', input: liftRecs({ lift: 0.05 }) },
      { label: '+40% but 12 a side (too early)', input: liftRecs({ n: 12, lift: 0.4 }) },
      { label: '+30% but the control has 40', input: liftRecs({ nC: 40, lift: 0.3 }) },
      { label: 'only claimed, never confirmed', input: liftRecs({ lift: 0.3 }).map((r) => ({ ...r, confirmed: false })) },
      { label: '+30%, all measured before go-live', input: liftRecs({ lift: 0.3 }).map((r) => ({ ...r, t: r.t - 6 * DAY })) },
    ],
  },
  {
    name: 'bar-paired',
    why: 'the paired bar needs the lower bound above 0 and stops a losing change early',
    accept: (recs) => evaluate(pairedRow, recs, NOW).state === 'met',
    good: [{ label: '+8% steady, 80 pairs', input: pairRecs({ n: 80, lift: 0.08, spread: 0.05 }) }],
    bad: [
      { label: '−12% after 25 pairs (stop)', input: pairRecs({ n: 25, lift: -0.12, spread: 0.05 }) },
      { label: '+4% in heavy noise (bound under 0)', input: pairRecs({ n: 80, lift: 0.04, spread: 0.6 }) },
      { label: '+8% but 30 pairs', input: pairRecs({ n: 30, lift: 0.08, spread: 0.05 }) },
      { label: 'half of every pair missing', input: pairRecs({ n: 80, lift: 0.08, spread: 0.05 }).filter((r) => r.arm === 'T' || r.pair % 2) },
    ],
  },
  {
    name: 'bar-rate',
    why: 'the shadow/canary bar refuses too many fallbacks and stops at the first harmful one',
    accept: (recs) => evaluate(rateRow, recs, NOW).state === 'met',
    good: [{ label: '600 decisions, 2 fallbacks', input: decisions({ n: 600, flagged: { fallback: 2, disagree: 4 } }) }],
    bad: [
      { label: '600 decisions, 12 fallbacks (2%)', input: decisions({ n: 600, flagged: { fallback: 12 } }) },
      { label: 'one harmful disagreement', input: decisions({ n: 600, flagged: { fallback: 1, harmful: 1 } }) },
      { label: '100 decisions (too early)', input: decisions({ n: 100 }) },
    ],
  },
  {
    name: 'raw-output-check',
    why: 'the review must see what a counter cannot: empty, frozen, unmeasured, or unconfirmed evidence',
    accept: (recs) => rawFlags(row(), recs, null).length === 0,
    good: [{ label: '24 varied outcomes', input: varied }],
    bad: [
      { label: 'nothing in 24 h', input: [] },
      { label: '12 identical treatment values', input: varied.map((r) => (r.arm === 'T' ? { ...r, value: 120 } : r)) },
      { label: 'all zeros', input: varied.map((r) => ({ ...r, value: 0 })) },
      { label: 'a third unmeasured', input: varied.map((r, i) => (i % 3 ? r : { ...r, ok: false, why: 'sampling gap', value: undefined })) },
      { label: 'a quarter claimed, not confirmed', input: varied.map((r, i) => (i % 4 ? r : { ...r, confirmed: false })) },
    ],
  },
  {
    name: 'decide',
    why: 'recording a decision is refused when the data cannot carry it yet',
    accept: ({ r, verdict, readout, early, why }) => typeof decide(r, verdict, readout, { today: '2026-01-20', early, why }) === 'string',
    good: [{ label: 'KEEP with the sample in', input: { r: row(), verdict: 'KEEP', readout: { enough: true, backstopPassed: false, numberText: '+31%', sampleText: '120 T vs 118 C' } } }],
    bad: [
      { label: 'KEEP on half the sample, no reason', input: { r: row(), verdict: 'KEEP', readout: { enough: false, backstopPassed: false, numberText: '+40%', sampleText: '50 T vs 50 C' } } },
      { label: 'deciding a closed row', input: { r: row({ status: 'CLOSED 2026-01-10: never went live' }), verdict: 'KEEP', readout: { enough: true } } },
      { label: 'CLOSE with no reason', input: { r: row(), verdict: 'CLOSE', readout: null } },
      { label: 'a made-up verdict', input: { r: row(), verdict: 'WIN', readout: { enough: true } } },
    ],
    mutants: [['readout', 'drop'], ['verdict', 'flip']],
  },
];

export const FIXTURES = { row, pairedRow, rateRow, liftRecs, pairRecs, decisions, NOW };
