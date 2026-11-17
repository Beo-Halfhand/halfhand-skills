// gate.mjs: the check every outgoing line passes, whoever wrote it: the model, a draft, or the owner's own answer.
// An owner's words are data, not commands: anyone who can reach the dashboard or the asks folder could write them too.
//
//   const gate = makeGate({ maxChars: 280, banned: ['guarantee'], check: (t) => (mentionsUnknownPlace(t) ? 'names a place not in state' : null) });
//   gate('hello') -> { ok: true }   |   { ok: false, reason: 'over 280 characters' }
//
// Secret-shaped text is caught with fleet-dashboard's masker (one masker, shared): if masking would change the
// line, the line isn't sent.
import { mask } from '../../../fleet-dashboard/scripts/lib/mask.mjs';
import { TEXT_MAX } from '../../../fleet-dashboard/scripts/lib/asks.mjs';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function makeGate({ maxChars = TEXT_MAX, banned = [], commandPrefixes = ['/', '!'], check = null } = {}) {
  const words = banned.map((w) => String(w).trim()).filter(Boolean);
  const bannedRe = words.length ? new RegExp(`(^|[^\\p{L}\\p{N}])(${words.map(escape).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu') : null;
  return function gate(text) {
    const t = String(text ?? '');
    if (!t.trim()) return { ok: false, reason: 'empty' };
    if (/[\x00-\x08\x0b-\x1f\x7f]/.test(t)) return { ok: false, reason: 'has control characters' };
    if (t.length > maxChars) return { ok: false, reason: `over ${maxChars} characters` };
    const lead = t.trimStart();
    if (commandPrefixes.some((p) => lead.startsWith(p))) return { ok: false, reason: 'looks like a command' };
    if (bannedRe && bannedRe.test(t)) return { ok: false, reason: 'uses a banned word' };
    if (mask(t) !== t) return { ok: false, reason: 'looks like it holds a key, a token or a home folder' };
    const extra = check ? check(t) : null;
    if (extra) return { ok: false, reason: String(extra) };
    return { ok: true };
  };
}
