// limits.mjs: owner limits. One policy file the owner writes, one check() the driver calls before every action
// that changes anything, and a log of every "no".
//
//   policy.json     the owner writes it; the agent never does (re-read on every call, so tightening needs no restart)
//   STOP            the owner writes it: everything except read-only actions is refused while it exists
//   spent.json      the agent writes it: spend today and this week (in the owner's time zone), the freeze latch
//   refusals.jsonl  the agent appends: { at, mode, action, rule, reason, amount?, to?, approved?, wouldRefuse? }
//
// needsHuman actions are refused unless the policy has "approvals": "asks" AND the driver passes { approved: <ask id> }
// from approvalFrom() in asks.mjs, which binds the approval to the exact action, amount and counterparty in the ask.
//
// Order of checks: read-only actions always pass. Then the hard stops (STOP, mode "off", past `expires`, frozen),
// then needsHuman, allow, neverTo, floors, spend caps, rates. No valid policy.json = everything refused (fails closed).
import fs from 'node:fs';
import path from 'node:path';
import { appendLine, readJson, writeJson } from './files.mjs';
import { mask } from '../../../fleet-dashboard/scripts/lib/mask.mjs';

const KNOWN = new Set(['mode', 'tz', 'expires', 'spend', 'allow', 'readOnly', 'needsHuman', 'approvals', 'neverTo', 'floors', 'rate', 'perMinute', 'onBreach', 'note']);

/** Check a policy object. Returns a list of problems (empty = fine). */
export function policyProblems(p) {
  const bad = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['policy.json is not a JSON object'];
  for (const k of Object.keys(p)) if (!KNOWN.has(k)) bad.push(`unknown field "${k}" (a typo would silently turn a rule off)`);
  if (!['on', 'shadow', 'off'].includes(p.mode)) bad.push('mode must be "on", "shadow" or "off"');
  if (p.tz !== undefined) { try { new Intl.DateTimeFormat('en', { timeZone: p.tz }); } catch { bad.push(`tz "${p.tz}" is not a time zone`); } }
  if (p.expires !== undefined && !Number.isFinite(Date.parse(p.expires))) bad.push('expires must be a date');
  for (const k of ['allow', 'readOnly', 'needsHuman', 'neverTo']) if (p[k] !== undefined && !(Array.isArray(p[k]) && p[k].every((x) => typeof x === 'string'))) bad.push(`${k} must be a list of names`);
  if (!Array.isArray(p.allow)) bad.push('allow is required (the actions this agent may take)');
  const s = p.spend ?? {};
  for (const k of ['perAction', 'perDay', 'perWeek']) if (s[k] !== undefined && !(Number.isFinite(s[k]) && s[k] >= 0)) bad.push(`spend.${k} must be a number >= 0`);
  for (const [k, v] of Object.entries(p.floors ?? {})) if (!Number.isFinite(v)) bad.push(`floors.${k} must be a number`);
  for (const [k, v] of Object.entries(p.rate ?? {})) if (!(Number.isInteger(v?.perHour) && v.perHour >= 0)) bad.push(`rate.${k}.perHour must be a whole number`);
  if (p.perMinute !== undefined && !(Number.isInteger(p.perMinute) && p.perMinute >= 0)) bad.push('perMinute must be a whole number');
  if (p.onBreach !== undefined && !['refuse', 'freeze'].includes(p.onBreach)) bad.push('onBreach must be "refuse" or "freeze"');
  if (p.approvals !== undefined && !['off', 'asks'].includes(p.approvals)) bad.push('approvals must be "off" or "asks"');
  return bad;
}

// Day and week (starting Monday) as dates in the owner's time zone.
function periods(ms, tz) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).split('-').map(Number);
  const local = Date.UTC(y, m - 1, d);
  const day = new Date(local).toISOString().slice(0, 10);
  const week = new Date(local - ((new Date(local).getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
  return { day, week };
}

export function createLimits(dir, { now = () => Date.now() } = {}) {
  const F = { policy: path.join(dir, 'policy.json'), stop: path.join(dir, 'STOP'), state: path.join(dir, 'spent.json'), log: path.join(dir, 'refusals.jsonl') };
  const recent = { all: [], by: {} };          // rate windows: in memory, per process
  let p = null, problems = [];
  const state = () => readJson(F.state) ?? { day: 0, week: 0 };
  const save = (s) => writeJson(F.state, s);

  function load() {
    const raw = readJson(F.policy);
    problems = raw ? policyProblems(raw) : ['no readable policy.json'];
    p = problems.length ? null : raw;
    const s = state();
    if (p) {
      const { day, week } = periods(now(), p.tz);
      let changed = false;
      if (s.dayKey !== day) { s.day = 0; s.dayKey = day; changed = true; }
      if (s.weekKey !== week) { s.week = 0; s.weekKey = week; changed = true; }
      if (changed) save(s);
    }
    return s;
  }
  const log = (action, rule, reason, extra = {}) =>
    appendLine(F.log, { at: new Date(now()).toISOString(), mode: p?.mode ?? null, action: String(action).slice(0, 60), rule, reason: mask(reason), ...extra });

  function rules(action, ctx, s) {
    const amount = Number(ctx.amount ?? 0);
    if ((p.needsHuman ?? []).includes(action)) {
      // An owner's "ok" to an ask lifts this one rule, and only when the policy says approvals come from asks.
      // Every rule below (caps, floors, who, rates) still applies, and STOP, expiry and freeze were checked first.
      if (!(ctx.approved && p.approvals === 'asks')) return ['human', p.approvals === 'asks' ? 'the owner must approve this (ask the owner)' : 'the owner must do this (approvals from asks are off)'];
    } else if (!p.allow.includes(action)) return ['allow', `${action} is not in the allow list`];
    if (ctx.to && (p.neverTo ?? []).includes(ctx.to)) return ['who', 'that counterparty is blocked'];
    for (const [k, min] of Object.entries(p.floors ?? {})) {
      if (ctx.after?.[k] !== undefined && ctx.after[k] < min) return ['floor', `${k} would be ${ctx.after[k]}, below the floor of ${min}`];
    }
    const sp = p.spend ?? {};
    if (!(Number.isFinite(amount) && amount >= 0)) return ['cap', 'the amount is not a number >= 0'];
    if (sp.perAction !== undefined && amount > sp.perAction) return ['cap', `${amount} is over the per-action cap of ${sp.perAction}`];
    if (sp.perDay !== undefined && s.day + amount > sp.perDay) return ['cap', `today ${s.day} + ${amount} would pass the daily cap of ${sp.perDay}`];
    if (sp.perWeek !== undefined && s.week + amount > sp.perWeek) return ['cap', `this week ${s.week} + ${amount} would pass the weekly cap of ${sp.perWeek}`];
    const t = now();
    const r = p.rate?.[action];
    if (r) {
      recent.by[action] = (recent.by[action] ?? []).filter((x) => x > t - 3_600_000);
      if (recent.by[action].length >= r.perHour) return ['rate', `${action}: ${r.perHour} an hour reached`];
    }
    if (p.perMinute !== undefined) {
      recent.all = recent.all.filter((x) => x > t - 60_000);
      if (recent.all.length >= p.perMinute) return ['rate', `${p.perMinute} actions a minute reached`];
    }
    return null;
  }

  /** check(action, { amount, to, after }) -> { ok: true } | { ok: true, wouldRefuse } (shadow) | { ok: false, rule, reason } */
  function check(action, ctx = {}) {
    const s = load();
    if (!p) { log(action, 'policy', problems.join('; ')); return { ok: false, rule: 'policy', reason: problems.join('; ') }; }
    if ((p.readOnly ?? []).includes(action)) return { ok: true };
    const hard = fs.existsSync(F.stop) ? ['stop', 'the owner\'s STOP file is there']
      : p.mode === 'off' ? ['stop', 'mode is "off"']
      : p.expires && now() >= Date.parse(p.expires) ? ['expired', 'this policy has expired; the owner must renew it']
      : s.frozen ? ['frozen', `frozen after a refusal (${s.frozen}); the owner must unfreeze`] : null;
    if (hard) { log(action, ...hard); return { ok: false, rule: hard[0], reason: hard[1] }; }
    const bad = rules(action, ctx, s);
    const extra = { ...(ctx.amount !== undefined ? { amount: Number(ctx.amount) } : {}), ...(ctx.to ? { to: mask(String(ctx.to)).slice(0, 60) } : {}), ...(ctx.approved ? { approved: String(ctx.approved).slice(0, 40) } : {}) };
    if (!bad) {
      const t = now();
      if (p.rate?.[action]) (recent.by[action] ??= []).push(t);
      recent.all.push(t);
      return { ok: true };
    }
    if (p.mode === 'shadow') { log(action, ...bad, { ...extra, wouldRefuse: true }); return { ok: true, wouldRefuse: bad[0], reason: bad[1] }; }
    log(action, ...bad, extra);
    if (p.onBreach === 'freeze' && bad[0] !== 'human') { s.frozen = `${action}: ${bad[0]}`; save(s); }
    return { ok: false, rule: bad[0], reason: bad[1] };
  }

  /** After the action happened: count what it spent. */
  function record(amount) {
    const s = load();
    const n = Number(amount);
    if (!(Number.isFinite(n) && n >= 0)) throw new Error('record: amount must be a number >= 0');
    s.day += n; s.week += n; save(s);
    return { day: s.day, week: s.week };
  }

  /** Owner only: call it from your own tool, never from the agent's loop. */
  function unfreeze() { const s = load(); delete s.frozen; save(s); }

  function status() {
    const s = load();
    return { policyOk: Boolean(p), problems, mode: p?.mode ?? null, tz: p?.tz ?? 'UTC', stop: fs.existsSync(F.stop), frozen: s.frozen ?? null,
      expires: p?.expires ?? null, spentToday: s.day ?? 0, spentWeek: s.week ?? 0, caps: p?.spend ?? {} };
  }

  return { check, record, unfreeze, status, files: F };
}
