// mask.mjs: every line of agent text the dashboard shows (log lines, sample errors) goes through mask() first.
// It is a net, not a guarantee: keep secrets out of logs in the first place.
const RULES = [
  // first, so "Authorization: Bearer <token>" masks the token, not the word Bearer
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 [masked]'],
  // name=value / name: value, where the name says it is secret
  [/\b((?:api[_-]?key|apikey|access[_-]?key|secret|token|password|passwd|pass|seed|mnemonic|private[_-]?key|auth|authorization|session|cookie|project[_-]?id)\s*["']?\s*[:=]\s*["']?)([^\s"',;}]{4,})/gi, '$1[masked]'],
  // well-known key shapes
  [/\b(sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}/g, '[masked]'],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/g, '[masked]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[masked]'],              // JWTs
  [/\b(?:[a-z]+ ){11,23}[a-z]+\b/g, (m) => (m.split(' ').length >= 12 && m.split(' ').every((w) => w.length >= 3 && w.length <= 8) ? '[masked words]' : m)],   // a seed phrase
  [/[A-Za-z0-9+/_=]{32,}/g, '[masked]'],                                                         // long tokens (ids with dashes survive)
  // setup details: whose home folder this is
  [/(?:\/Users|\/home)\/[^/\s"']+/g, '~'],
  [/[A-Z]:\\Users\\[^\\\s"']+/g, '~'],
];

export function mask(text) {
  let s = String(text ?? '');
  for (const [re, to] of RULES) s = s.replace(re, to);
  // control characters (terminal colours, bells) never reach the page
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}
