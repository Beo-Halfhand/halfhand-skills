#!/usr/bin/env node
// mask-pipe.mjs: masks text on its way somewhere. Use it as a command around programs you don't control, or import it.
//
// As a command (stdin → stdout, or into a daily log file):
//   some-program 2>&1 | node mask-pipe.mjs                       masked to your terminal
//   some-program 2>&1 | node mask-pipe.mjs --log ~/logs build      appends to ~/logs/build-YYYYMMDD.log (600, folder 700)
//   node mask-pipe.mjs --count < old.log > old.masked              "masked-lines=N" on stderr, never the values
// Options:
//   --log <dir> <name>   write to <dir>/<name>-YYYYMMDD.log (local date); past --max-mb it rolls to .2.log, .3.log …
//                        Log mode always removes terminal escape codes, turns \r into new lines and drops blank lines.
//   --max-mb <n>         roll size for --log (default 20, or SAFE_LOGS_LOG_MAX_MB; fractions allowed)
//   --cr-to-nl           a \r becomes a new line (a progress line redrawn ten times is ten lines)
//   --strip-ansi         always remove terminal escape codes (default: kept on lines with nothing to mask)
//   --extra <file>       your own terms, one regex per line (or SAFE_LOGS_EXTRA)
//   --secret-vars A,B    mask the values of these environment variables exactly (or SAFE_LOGS_SECRET_VARS)
//   --no-generic         no catch-all for long mixed tokens    --keep-paths   don't turn home folders into ~
//   --count              print masked-lines=N on stderr at the end
// Fails closed: if the options are bad (a broken regex, an unreadable file) it exits 2 before writing anything;
// if masking fails mid-stream it stops writing and exits 3. Exit 0 otherwise.
//
// As a module (nothing runs on import; stdin is left alone):
//   import { maskPipe, createMaskTransform, openDailyLog } from './mask-pipe.mjs';
//   await maskPipe(child.stdout, process.stdout);                  // → { lines, masked }
//   child.stderr.pipe(createMaskTransform({ crToNl: true })).pipe(fs.createWriteStream(f, { mode: 0o600 }));
import fs from 'node:fs';
import path from 'node:path';
import { Transform, Writable, pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { makeRedactor, stripAnsi } from './redact.mjs';
import { optionsFromEnv } from './options.mjs';

const HOLD_MAX = 64 * 1024;   // a line longer than this is passed on in pieces, cut at a space where possible

// A Transform from text to masked text. Whole lines go out as soon as they end (\n or \r); a partial line is held
// back, so a key split across two reads is joined before it is matched. opts: makeRedactor's options plus
//   crToNl (false), skipBlank (false), stripAnsi (false: same as ansi 'strip')
export function createMaskTransform(opts = {}) {
  const r = makeRedactor({ ...opts, ansi: opts.stripAnsi ? 'strip' : opts.ansi });
  let held = '';
  const emit = (text, t) => {
    let s = text;
    if (opts.crToNl) s = s.replace(/\r\n?/g, '\n');
    let out = r.text(s);
    if (opts.stripAnsi) out = stripAnsi(out);
    if (opts.skipBlank) out = out.split('\n').filter((l) => l.trim() !== '').map((l) => l + '\n').join('');   // whole lines only
    if (out) t.push(out);
  };
  const tr = new Transform({
    decodeStrings: false,
    transform(chunk, _enc, cb) {
      try {
        held += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        let cut = Math.max(held.lastIndexOf('\n'), held.lastIndexOf('\r')) + 1;
        if (cut === held.length && held.endsWith('\r')) cut--;   // a lone \r might be the first half of \r\n: wait one read
        if (!cut && held.length > HOLD_MAX) { const sp = held.lastIndexOf(' ', held.length - 1024); cut = sp > 0 ? sp + 1 : held.length - 1024; }
        if (cut > 0) { emit(held.slice(0, cut), this); held = held.slice(cut); }
        cb();
      } catch (e) { cb(Object.assign(new Error('the mask failed'), { code: 'SAFE_LOGS_MASK', cause: e })); }
    },
    flush(cb) {
      try { if (held) emit(held, this); held = ''; cb(); }
      catch (e) { cb(Object.assign(new Error('the mask failed'), { code: 'SAFE_LOGS_MASK', cause: e })); }
    },
  });
  tr.setEncoding('utf8');
  Object.defineProperty(tr, 'masked', { get: () => r.changed });
  return tr;
}

// input (a readable) → masked → output (a writable). Resolves { masked } (lines that had something masked).
export function maskPipe(input, output, opts = {}) {
  const t = createMaskTransform(opts);
  return new Promise((resolve, reject) => pipeline(input, t, output, (err) => (err ? reject(err) : resolve({ masked: t.masked }))));
}

// A writable that appends to <dir>/<name>-YYYYMMDD.log (local date), rolling to .2.log … past maxMb.
// The folder is made 700 and every file 600. The name is cleaned so it can't leave the folder.
export function openDailyLog(dir, name, { maxMb = 20 } = {}) {
  const safe = String(name).replace(/[^A-Za-z0-9_-]/g, '_') || 'log';
  const max = Math.max(1, Math.floor(Number(maxMb) * 1024 * 1024));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* not ours to change */ }
  const today = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
  const partPath = (d, p) => path.join(dir, p === 1 ? `${safe}-${d}.log` : `${safe}-${d}.${p}.log`);
  const size = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
  let day = '', file = '', fd = null;
  const open = () => {
    const d = today(); let p = 1;
    while (fs.existsSync(partPath(d, p)) && size(partPath(d, p)) >= max) p++;
    if (fd !== null) fs.closeSync(fd);
    day = d; file = partPath(d, p);
    fd = fs.openSync(file, 'a', 0o600);
    try { fs.fchmodSync(fd, 0o600); } catch { /* best effort */ }
  };
  return new Writable({
    decodeStrings: false,
    write(chunk, _enc, cb) {
      try {
        if (fd === null || today() !== day || size(file) >= max) open();
        fs.writeSync(fd, typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        cb();
      } catch (e) { cb(e); }
    },
    final(cb) { try { if (fd !== null) fs.closeSync(fd); fd = null; cb(); } catch (e) { cb(e); } },
  });
}

// ── the command ────────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { log: null, maxMb: process.env.SAFE_LOGS_LOG_MAX_MB ?? 20, over: {}, crToNl: false, stripAnsi: false, count: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], need = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--log') { o.log = [need(), need()]; }
    else if (a === '--max-mb') o.maxMb = need();
    else if (a === '--cr-to-nl') o.crToNl = true;
    else if (a === '--strip-ansi') o.stripAnsi = true;
    else if (a === '--count') o.count = true;
    else if (a === '--extra') o.over.extraFile = need();
    else if (a === '--secret-vars') o.over.secretVars = need().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--no-generic') o.over.generic = false;
    else if (a === '--keep-paths') o.over.homePaths = false;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (!(Number(o.maxMb) > 0)) throw new Error('--max-mb must be a number above 0');
  return o;
}

async function main() {
  let o, opts;
  try {
    o = parseArgs(process.argv.slice(2));
    if (o.help) { process.stdout.write(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n'); return 0; }
    const r = optionsFromEnv(process.env, o.over);
    opts = r.opts;
    if (r.skipped.length) process.stderr.write(`safe-logs: not masking by value (missing or under 6 characters): ${r.skipped.join(', ')}\n`);
  } catch (e) { process.stderr.write(`safe-logs: ${e.message}; nothing written\n`); return 2; }
  const logMode = !!o.log;
  let out;
  try { out = logMode ? openDailyLog(o.log[0], o.log[1], { maxMb: o.maxMb }) : process.stdout; }
  catch { process.stderr.write('safe-logs: cannot open the log folder; nothing written\n'); return 2; }
  const t = createMaskTransform({ ...opts, crToNl: o.crToNl || logMode, stripAnsi: o.stripAnsi || logMode, skipBlank: logMode });
  process.stdin.setEncoding('utf8');
  const code = await new Promise((resolve) => pipeline(process.stdin, t, out, (err) => {
    if (!err) return resolve(0);
    if (err.code === 'EPIPE') return resolve(0);           // the reader went away (| head): not a failure
    process.stderr.write(err.code === 'SAFE_LOGS_MASK' ? 'safe-logs: the mask failed; stopped writing\n' : `safe-logs: ${err.code ?? 'write failed'}; stopped writing\n`);
    resolve(3);
  }));
  if (o.count) process.stderr.write(`masked-lines=${t.masked}\n`);
  return code;
}

// Run as a command only when started directly. Node resolves symlinks for the module (/tmp on macOS, a linked
// tools/ folder) but not in argv[1], so compare real paths, or a linked path would silently do nothing.
const realArgv1 = () => { try { return fs.realpathSync(process.argv[1]); } catch { return path.resolve(process.argv[1]); } };
if (process.argv[1] && realArgv1() === fs.realpathSync(fileURLToPath(import.meta.url))) main().then((c) => { process.exitCode = c; });
