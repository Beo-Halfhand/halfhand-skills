// arms.mjs: who gets which arm, decided by a coin nobody can lean on.
//
// Paired windows: one agent alternates between the old rule (C) and the change (T). Inside each pair a coin flip picks
// which arm runs first, so a time-of-day effect can't line up with one arm. The flip is a hash of the experiment id,
// the pair number and a seed written in the register, so the agent and the review always agree on it and nobody can
// re-roll a pair they didn't like.
import { hash } from './stats.mjs';

export function armsForPair(exp, pair, seed = '') {
  if (!Number.isInteger(pair) || pair < 1) throw new Error('pair must be a whole number from 1');
  return hash(`${exp}|${pair}|${seed}`) & 1 ? ['T', 'C'] : ['C', 'T'];
}

// The n-th window (from 1) of a paired row: which pair it belongs to and which arm runs.
export function armForWindow(exp, n, seed = '') {
  const pair = Math.ceil(n / 2);
  return { pair, arm: armsForPair(exp, pair, seed)[(n - 1) % 2] };
}

// Concurrent rows: split a list of agents into two groups at random (seeded), for when you have no reason to pick.
export function splitGroups(agents, seed = '') {
  const s = [...agents].sort((a, b) => hash(`${seed}|${a}`) - hash(`${seed}|${b}`));
  return { treatment: s.slice(0, Math.ceil(s.length / 2)), control: s.slice(Math.ceil(s.length / 2)) };
}
