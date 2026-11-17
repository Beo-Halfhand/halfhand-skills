// gates.mjs: a gate that has never rejected anything is not a filter. This runner makes every gate (a bar, a checker,
// a guard, a validator: anything that says yes or no) show, every time it runs, that it says NO to known-bad cases
// and YES to known-good ones. Then it mutates each good case (one character flipped, a field dropped, a number
// zeroed or nudged, a time moved) and checks the gate says no to each mutant. A mutant it lets through "survived":
// the gate is not looking at that field.
//
// A gate:
//   { name, why,                          // why it exists, one line
//     accept(input) → boolean,            // true = let it through. Throwing counts as "no" (and is reported)
//     good: [{ label, input }],           // must all pass
//     bad:  [{ label, input }],           // must all be refused; at least one is required
//     mutants: [[path, op], …] }          // optional; applied to every good case, each must be refused
// ops: flip (one character of a string), drop (delete the field), zero, negate, bump (a number up by 1% + 1),
//      future / past (a time, ms or ISO, moved 30 days)

const DAY = 86_400_000;
const isIso = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
const shift = (v, d) => (typeof v === 'number' ? v + d : isIso(v) ? new Date(Date.parse(v) + d).toISOString().slice(0, v.length === 10 ? 10 : undefined) : undefined);
export const OPS = {
  flip: (v) => { if (typeof v !== 'string' || !v) return undefined; const i = Math.floor(v.length / 2), c = v[i]; return v.slice(0, i) + (c === 'x' ? 'y' : /[0-9]/.test(c) ? String((+c + 1) % 10) : 'x') + v.slice(i + 1); },
  zero: (v) => (typeof v === 'number' && v !== 0 ? 0 : undefined),
  negate: (v) => (typeof v === 'number' && v !== 0 ? -v : undefined),
  bump: (v) => (typeof v === 'number' ? v * 1.01 + 1 : undefined),
  future: (v) => shift(v, 30 * DAY),
  past: (v) => shift(v, -30 * DAY),
};

export function mutate(input, pathStr, op) {
  const copy = structuredClone(input), keys = String(pathStr).split('.');
  let o = copy;
  for (const k of keys.slice(0, -1)) { if (o?.[k] === undefined) return { ok: false }; o = o[k]; }
  const last = keys.at(-1);
  if (!o || !(last in o)) return { ok: false };
  if (op === 'drop') { if (Array.isArray(o)) o.splice(+last, 1); else delete o[last]; return { ok: true, input: copy }; }
  const f = OPS[op]; if (!f) return { ok: false };
  const v = f(o[last]); if (v === undefined) return { ok: false };
  o[last] = v;
  return { ok: true, input: copy };
}

async function says(gate, input) {
  try { return { yes: (await gate.accept(input)) === true }; } catch (err) { return { yes: false, threw: String(err?.message ?? err).slice(0, 120) }; }
}

export async function runGate(gate) {
  const r = { name: gate.name, why: gate.why ?? '', bad: { n: 0, refused: 0 }, good: { n: 0, passed: 0 }, mutants: { n: 0, killed: 0 }, problems: [] };
  const good = gate.good ?? [], bad = gate.bad ?? [];
  if (typeof gate.accept !== 'function') { r.problems.push('no accept(input) function'); r.ok = false; return r; }
  if (!bad.length) r.problems.push('no known-bad case: a gate that has never rejected anything is not a filter');
  if (!good.length) r.problems.push('no known-good case: a gate that refuses everything is not a filter either');
  for (const c of bad) { r.bad.n++; const s = await says(gate, c.input); if (!s.yes) r.bad.refused++; else r.problems.push(`let through a known-bad case: ${c.label}`); }
  for (const c of good) { r.good.n++; const s = await says(gate, c.input); if (s.yes) r.good.passed++; else r.problems.push(`refused a known-good case: ${c.label}${s.threw ? ` (threw: ${s.threw})` : ''}`); }
  for (const c of good) {
    for (const [p, op] of gate.mutants ?? []) {
      const m = mutate(c.input, p, op);
      if (!m.ok) { r.problems.push(`mutant ${op} ${p} does not apply to "${c.label}"`); continue; }
      r.mutants.n++;
      const s = await says(gate, m.input);
      if (!s.yes) r.mutants.killed++; else r.problems.push(`mutant survived: ${op} ${p} on "${c.label}" was let through`);
    }
  }
  r.ok = r.problems.length === 0;
  return r;
}

export async function runGates(gates) {
  const results = [];
  for (const g of gates) results.push(await runGate(g));
  return { ok: results.every((r) => r.ok), results };
}

export function formatGates({ results, ok }) {
  const w = Math.max(20, ...results.map((r) => r.name.length));
  const out = [`${'gate'.padEnd(w)}  says no to bad  yes to good  mutants killed  result`];
  for (const r of results) {
    out.push(`${r.name.padEnd(w)}  ${`${r.bad.refused}/${r.bad.n}`.padEnd(14)}  ${`${r.good.passed}/${r.good.n}`.padEnd(11)}  ${(r.mutants.n ? `${r.mutants.killed}/${r.mutants.n}` : '-').padEnd(14)}  ${r.ok ? 'ok' : 'FAIL'}`);
    for (const p of r.problems) out.push(`${' '.repeat(w)}    ✗ ${p}`);
  }
  const bad = results.filter((r) => !r.ok).length;
  out.push('', ok ? `gates: ${results.length} ok, each shown saying no` : `gates: ${bad} of ${results.length} FAILED: do not trust ${bad === 1 ? 'that gate' : 'those gates'} until fixed`);
  return out.join('\n');
}
