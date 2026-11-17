// asks.mjs: ask the owner, the agent's side. The file format is fleet-dashboard's "Asks for you" inbox, shared,
// not copied: the id rule, the text limit, the dashboard's reader and the answer writer are imported from it.
//
//   <asksDir>/<id>.json          the agent writes it      { id, agent, question, draft?, at,  kind, onTimeout, deadline, context?, action? }
//   <asksDir>/answers/<id>.json  the owner's side writes  { id, verdict: "ok" | "own" | "skip", text?, at, by }
//   <asksDir>/done/<id>.json     the agent, when it closes the ask: the ask, the answer and what happened
//
// The first five ask fields are fleet-dashboard's; `kind`, `onTimeout`, `deadline`, `context` and `action` are
// additions it ignores. Every ask has a deadline and a default for silence, chosen per kind of action:
//   onTimeout "send"     send the draft (low risk, e.g. a friendly reply)
//   onTimeout "nothing"  do nothing and let it expire (anything with money, items or commitments)
// A late answer (after the deadline) is logged, never acted on. Any text that would be said, the owner's included,
// passes the gate first.
import fs from 'node:fs';
import path from 'node:path';
import { ID_RE, TEXT_MAX, listAsks, answerAsk } from '../../../fleet-dashboard/scripts/lib/asks.mjs';
import { readJson, writeJson, oneLine } from './files.mjs';

export { ID_RE, TEXT_MAX, listAsks, answerAsk };
export const MAX_OPEN = 5;

const askFile = (dir, id) => path.join(dir, `${id}.json`);
const answerFile = (dir, id) => path.join(dir, 'answers', `${id}.json`);

/** The open asks this agent wrote (or all of them, with no agent): raw files, including the added fields. */
export function openAsks(asksDir, agent = null) {
  let files = [];
  try { files = fs.readdirSync(asksDir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of files) {
    const id = f.slice(0, -5);
    if (!ID_RE.test(id)) continue;
    const a = readJson(askFile(asksDir, id));
    if (!a || (a.id !== undefined && a.id !== id)) continue;
    if (agent && a.agent !== agent) continue;
    out.push({ ...a, id });
  }
  return out.sort((x, y) => String(x.at).localeCompare(String(y.at)));
}

/**
 * Write an ask. Returns { ok: true, ask } or { ok: false, reason }.
 *   question   should stand on its own: who, what they said, what you'd like to do. Put earlier lines in `context`.
 *   minutes    required: every ask has a deadline
 *   onTimeout  "send" or "nothing" (the default for silence)
 */
export function openAsk(asksDir, { id, agent, question, draft = null, kind = 'other', onTimeout = 'nothing', minutes, context = [], action = null, maxOpen = MAX_OPEN, now = Date.now() } = {}) {
  if (!ID_RE.test(String(id ?? ''))) return { ok: false, reason: 'bad ask id (1 to 40 of A-Z a-z 0-9 - _)' };
  if (!oneLine(question, 600)) return { ok: false, reason: 'an ask needs a question' };
  if (!['send', 'nothing'].includes(onTimeout)) return { ok: false, reason: 'onTimeout is "send" or "nothing"' };
  if (onTimeout === 'send' && !oneLine(draft, TEXT_MAX)) return { ok: false, reason: 'onTimeout "send" needs a draft' };
  if (!(minutes > 0)) return { ok: false, reason: 'an ask needs a deadline (minutes > 0)' };
  if (action && !(typeof action.name === 'string' && action.name && (action.amount === undefined || Number.isFinite(action.amount)))) return { ok: false, reason: 'action is { name, amount?, to? }' };
  if (action && onTimeout === 'send') return { ok: false, reason: 'an ask for an action never acts on silence: use onTimeout "nothing"' };
  if (fs.existsSync(askFile(asksDir, id)) || fs.existsSync(path.join(asksDir, 'done', `${id}.json`))) return { ok: false, reason: `ask id ${id} is already used` };
  if (openAsks(asksDir, agent).length >= maxOpen) return { ok: false, reason: `queue full (${maxOpen} open asks)` };
  const ask = {
    id, agent: String(agent ?? ''), question: oneLine(question, 600), ...(draft ? { draft: oneLine(draft, TEXT_MAX) } : {}),
    at: new Date(now).toISOString(), kind: oneLine(kind, 40), onTimeout, deadline: new Date(now + minutes * 60_000).toISOString(),
    ...(context?.length ? { context: context.slice(-6).map((l) => oneLine(l, 200)) } : {}),
    ...(action ? { action: { name: oneLine(action.name, 60), ...(action.amount !== undefined ? { amount: action.amount } : {}), ...(action.to ? { to: oneLine(action.to, 60) } : {}) } } : {}),
  };
  writeJson(askFile(asksDir, id), ask);
  return { ok: true, ask };
}

/**
 * What to do about an ask now. Never acts: returns a decision the driver carries out.
 *   { status: 'waiting' }
 *   { status: 'answered', verdict, say, blocked?, reason? }    say = the text to send, or null
 *   { status: 'timeout',  say, blocked?, reason? }             the default for silence
 *   { status: 'late',     verdict }                            answered after the deadline: log it, do nothing
 */
export function resolveAsk(asksDir, ask, { gate, now = Date.now() } = {}) {
  if (typeof gate !== 'function') throw new Error('resolveAsk needs a gate: every line goes through one');
  const deadline = Date.parse(ask.deadline);
  const a = readJson(answerFile(asksDir, ask.id));
  const check = (text) => { const g = gate(text); return g.ok ? { say: text } : { say: null, blocked: true, reason: g.reason }; };
  if (a && a.id === ask.id && ['ok', 'own', 'skip'].includes(a.verdict)) {
    const answeredAt = Date.parse(a.at);
    if (Number.isFinite(deadline) && Number.isFinite(answeredAt) && answeredAt > deadline) return { status: 'late', verdict: a.verdict };
    if (a.verdict === 'skip') return { status: 'answered', verdict: 'skip', say: null };
    const text = a.verdict === 'ok' ? ask.draft : a.text;
    if (!text && a.verdict === 'ok' && ask.action) return { status: 'answered', verdict: 'ok', say: null };   // an approval: see approvalFrom()
    if (!text) return { status: 'answered', verdict: a.verdict, say: null, blocked: true, reason: 'nothing to send' };
    return { status: 'answered', verdict: a.verdict, ...check(text) };
  }
  if (!Number.isFinite(deadline) || now <= deadline) return { status: 'waiting' };
  if (ask.onTimeout !== 'send' || !ask.draft) return { status: 'timeout', say: null };
  return { status: 'timeout', ...check(ask.draft) };
}

/**
 * For an ask that asked to DO something: the approved action, exactly as it was asked, or null.
 * Only an in-time "ok" approves. "own" words are speech, never an action; "skip", silence and late answers approve nothing.
 * Pass the result straight to limits: check(a.name, a.ctx). It still has to pass every other rule.
 */
export function approvalFrom(ask, r) {
  if (!ask.action || r.status !== 'answered' || r.verdict !== 'ok') return null;
  const { name, amount, to } = ask.action;
  return { name, ctx: { ...(amount !== undefined ? { amount } : {}), ...(to ? { to } : {}), approved: ask.id } };
}

/** Close an ask: one record in done/, then the ask (and its answer, if any) are removed. Returns the record. */
export function closeAsk(asksDir, ask, outcome) {
  const answer = readJson(answerFile(asksDir, ask.id));
  const record = { ask, answer, outcome: oneLine(outcome, 200), closedAt: new Date().toISOString() };
  writeJson(path.join(asksDir, 'done', `${ask.id}.json`), record);
  fs.rmSync(askFile(asksDir, ask.id), { force: true });
  fs.rmSync(answerFile(asksDir, ask.id), { force: true });
  return record;
}

/** One log line per outcome, the same words every time, so a day's log can be counted. */
export function outcomeLine(ask, r) {
  if (r.status === 'late') return `ASK late #${ask.id}: answer (${r.verdict}) came after the deadline; nothing sent`;
  if (r.status === 'timeout') return `ASK timeout #${ask.id} -> ${r.say ? 'draft sent' : r.blocked ? `draft blocked by gate (${r.reason})` : 'nothing'}`;
  return `OWNER SAYS #${ask.id}: ${r.verdict}${r.blocked ? ` (blocked by gate: ${r.reason})` : ''}`;
}
