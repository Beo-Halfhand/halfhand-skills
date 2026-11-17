// redact.mjs: the one list of masking rules. Everything in safe-logs uses it: mask-stdio.mjs (inside a Node
// process), mask-pipe.mjs (any program's output, a log file, a terminal mirror) and redactDeep (objects).
// Pure JavaScript, no dependencies, no I/O except loadExtra() reading the file you name.
//
// What gets masked, in this order (the name of each rule is what --explain and the docs call it):
//   private-key   PEM blocks (-----BEGIN … PRIVATE KEY----- to END), every line of them
//   url-password  scheme://user:<password>@host
//   url-query     ?key=VALUE for names that mean a secret, and any query value 16+ characters long
//                 (percent-encoded forms too: %3Fproject_id%3D…)
//   name-value    NAME=value, NAME: value, "NAME": "value" when NAME says secret (token, password, api_key, …)
//   auth-header   Bearer / Basic / Token + 16 or more characters
//   known-shape   key formats with a known prefix (AI providers, code hosts, cloud, chat, payments), JSON web
//                 tokens, 64 hex digits (private keys, seeds), network-prefixed project ids (preprod + 32 …)
//   exact         values you name (secrets from your environment): masked wherever they appear
//   extra         your own regular expressions (host names, account ids): one per line in a file
//   seed-words    12 to 24 short lower-case words in a row, at least 10 different: what a recovery phrase looks like
//   home-path     /Users/<name>, /home/<name>, C:\Users\<name> become ~ (whose machine this is)
//   catch-all     any 24+ character run of letters, digits, _ and - with an upper-case letter, a lower-case
//                 letter and a digit (turn off with generic: false)
// Kept: host names and paths of URLs, short ids, git hashes, UUIDs, numbers, ordinary words.
//
// Terminal colours: a line with nothing to mask comes back byte for byte, colours included. A line that has
// something to mask is matched with its escape codes removed (so a key split by a colour code is still caught)
// and comes back masked and without colours.

export const MARK = '<masked>';

export function stripAnsi(s) {
  return String(s)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')     // OSC: titles, hyperlinks
    .replace(/\x1b[P^_X][^\x1b]*\x1b\\/g, '')              // DCS, PM, APC, SOS
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')               // CSI: colours, cursor moves
    .replace(/\x1b[()*+][0-9A-Za-z]/g, '')                 // charset selection
    .replace(/\x1b[@-Z\\-_=>78]/g, '')                     // other two-byte escapes
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');    // other control bytes (tab, CR, LF stay)
}

// Names whose value is a secret. Upper-case env names count if they contain a secret word (MY_SERVICE_TOKEN).
const NAME = String.raw`(?:[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|SEED|MNEMONIC)[A-Za-z0-9_]*|project[_-]?id|api[_-]?key|x-api-key|authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|private[_-]?key|seed|mnemonic|set-cookie|cookie)`;
// URL query names whose value is a secret, at any length.
const QKEY = String.raw`(?:api[_-]?key|apikey|project[_-]?id|access[_-]?token|refresh[_-]?token|auth|token|secret|key|sig|signature|password|passwd|client[_-]?secret|code)`;
const QSTART = String.raw`(?:[?&;]|%3[Ff]|%26)`, QEQ = String.raw`(?:=|%3[Dd])`, QVAL = String.raw`(?:(?!%26)[^&\s"'<>#:,;)])`;   // a key never holds : , ; )
const KNOWN = new RegExp(String.raw`(?<![A-Za-z0-9])(?:` + [
  String.raw`sk-ant-[\w-]{10,}`,                          // Anthropic
  String.raw`sk-(?:proj-)?[A-Za-z0-9_-]{20,}`,            // OpenAI-style
  String.raw`AIza[0-9A-Za-z_-]{35}`,                      // Google
  String.raw`gh[pousr]_[A-Za-z0-9]{20,}`,                 // GitHub tokens
  String.raw`github_pat_[A-Za-z0-9_]{20,}`,
  String.raw`glpat-[A-Za-z0-9_-]{20,}`,                   // GitLab
  String.raw`npm_[A-Za-z0-9]{36}`,                        // npm
  String.raw`hf_[A-Za-z0-9]{30,}`,                        // Hugging Face
  String.raw`AKIA[0-9A-Z]{16}`,                           // AWS access key id
  String.raw`xai-[A-Za-z0-9]{20,}`,
  String.raw`xox[abprs]-[A-Za-z0-9-]{10,}`,               // Slack
  String.raw`(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}`,  // payment-style
  String.raw`[a-z]{0,10}(?:mainnet|preprod|preview|testnet|ipfs)[A-Za-z0-9]{32}`,   // network-prefixed project ids
  String.raw`eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`,          // JSON web tokens
  String.raw`(?:0x)?[0-9a-fA-F]{64}`,                     // 64 hex: private keys, seeds
].join('|') + String.raw`)(?![A-Za-z0-9])`, 'g');
const BEGIN_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/, END_KEY = /-----END [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// opts: { mark, generic (true), homePaths (true), seedWords (true), ansi ('keep' | 'strip'), extra: RegExp[], secrets: string[] }
export function makeRedactor(opts = {}) {
  const M = opts.mark ?? MARK;
  const generic = opts.generic !== false, homePaths = opts.homePaths !== false, seedWords = opts.seedWords !== false;
  const strip = opts.ansi === 'strip';
  const extra = (opts.extra ?? []).map((re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
  const secrets = [...new Set((opts.secrets ?? []).filter((v) => typeof v === 'string' && v.length >= 6))].sort((a, b) => b.length - a.length);
  const exact = secrets.length ? new RegExp(secrets.map(escapeRe).join('|'), 'g') : null;
  const rules = [
    ['url-password', /(\/\/[^/\s:@'"]+:)[^@\s/'"]+@/g, `$1${M}@`],
    ['url-query', new RegExp(`(${QSTART}${QKEY}${QEQ})${QVAL}+`, 'gi'), `$1${M}`],
    ['url-query', new RegExp(`(${QSTART}[A-Za-z0-9_.\\-\\[\\]]+${QEQ})${QVAL}{16,}`, 'g'), `$1${M}`],
    ['name-value', new RegExp(String.raw`\b(${NAME}["']?\s*[:=]\s*["']?)(?:(?:Bearer|Basic|Token)\s+)?[^\s"',;<>(){}\[\]]{6,}`, 'gi'), `$1${M}`],
    ['auth-header', /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{16,}/g, `$1 ${M}`],
    ['known-shape', KNOWN, M],
    ...(exact ? [['exact', exact, M]] : []),
    ...extra.map((re) => ['extra', re, M]),
    ...(seedWords ? [['seed-words', /\b[a-z]{3,8}(?: [a-z]{3,8}){11,23}\b/g, (m) => (new Set(m.split(' ')).size >= 10 ? `${M} (words)` : m)]] : []),   // mostly different words, like a real phrase
    ...(homePaths ? [['home-path', /(?:\/Users|\/home)\/[A-Za-z0-9._-]+|\b[A-Za-z]:\\Users\\[^\\\s"']+/g, '~']] : []),
    ...(generic ? [['catch-all', /(?<![A-Za-z0-9_+=.-])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{24,}(?![A-Za-z0-9_+=-])/g, M]] : []),
  ];
  let inKey = false, changed = 0;
  const hits = {};

  function plain(s) {
    let t = s;
    for (const [name, re, to] of rules) { const b = t; t = t.replace(re, to); if (t !== b) hits[name] = (hits[name] ?? 0) + 1; }
    return t;
  }
  // One line, without its line ending.
  function line(seg) {
    if (inKey) { if (END_KEY.test(seg)) inKey = false; changed++; hits['private-key'] = (hits['private-key'] ?? 0) + 1; return `${M} (private key)`; }
    const bare = stripAnsi(seg);
    if (BEGIN_KEY.test(bare)) { inKey = !END_KEY.test(bare); changed++; hits['private-key'] = (hits['private-key'] ?? 0) + 1; return `${M} (private key)`; }
    const out = plain(bare);
    if (out === bare) return strip ? bare : seg;   // nothing to mask: the original bytes, colours and all
    changed++; return out;
  }
  // Any text: split at \r\n, \n and \r, each piece masked, the line endings kept as they were.
  function text(s) {
    const parts = String(s).split(/(\r\n|\n|\r)/);
    for (let i = 0; i < parts.length; i += 2) if (parts[i]) parts[i] = line(parts[i]);
    return parts.join('');
  }
  return { line, text, get changed() { return changed; }, get hits() { return { ...hits }; }, get inKey() { return inKey; } };
}

// One-shot, stateless: masks a string (a private key block inside it is masked too).
export const redact = (s, opts) => makeRedactor(opts).text(s);

// Every string inside plain objects and arrays, masked; other values kept.
export function redactDeep(v, opts) {
  if (typeof v === 'string') return redact(v, opts);
  if (Array.isArray(v)) return v.map((x) => redactDeep(x, opts));
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out = {}; for (const [k, x] of Object.entries(v)) out[k] = redactDeep(x, opts); return out;
  }
  return v;
}

// Your own terms: one regular expression per line, case-insensitive; blank lines and # comments skipped.
// A bad line throws with its line number (never its text), so a caller can refuse to write anything.
export function loadExtra(text) {
  const out = [];
  String(text).split('\n').forEach((raw, i) => {
    const l = raw.trim(); if (!l || l.startsWith('#')) return;
    try { out.push(new RegExp(l, 'gi')); } catch { throw new Error(`bad regular expression on line ${i + 1} of the extra-terms file`); }
  });
  return out;
}

// Exact secret values from environment variables you name. Returns the values and the names that were
// missing or too short (under 6 characters can't be masked safely). Never logs a value.
export function secretsFromEnv(names, env = process.env) {
  const values = [], skipped = [];
  for (const n of names) { const v = env[n]; if (typeof v === 'string' && v.length >= 6) values.push(v); else skipped.push(n); }
  return { values, skipped };
}
