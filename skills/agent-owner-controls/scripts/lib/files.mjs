// files.mjs: the small file habits every control file uses.
//   - write whole files atomically (temp file + rename), so a reader never sees half a file
//   - owner-only permissions (600 files, 700 folders): these files say what an agent may do
//   - JSON lines are appended one line per write and read back skipping any broken line
//   - a JSON-lines log stays small: past CONTROLS_LOG_MAX_KB (default 1024) it rolls to <name>.1.jsonl, replacing
//     the older part, so a log never holds more than about twice that. Readers read both parts, oldest first
import fs from 'node:fs';
import path from 'node:path';

export function writeAtomic(file, data, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, { mode });
  fs.renameSync(tmp, file);
}

export const writeJson = (file, obj, mode = 0o600) => writeAtomic(file, JSON.stringify(obj, null, 2) + '\n', mode);

export function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** The older part of a rolled log: events.jsonl -> events.1.jsonl */
export const previousPart = (file) => { const ext = path.extname(file); return `${file.slice(0, file.length - ext.length)}.1${ext || '.log'}`; };

export const logMaxBytes = () => {
  const kb = Number(process.env.CONTROLS_LOG_MAX_KB);
  return Number.isFinite(kb) && kb > 0 ? kb * 1024 : 1024 * 1024;
};

export function appendLine(file, obj, { maxBytes = logMaxBytes() } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', { mode: 0o600 });
  try { if (fs.statSync(file).size > maxBytes) roll(file, maxBytes); } catch { /* rolling is best effort; the line is written */ }
}

// Several writers may append to one log (events.jsonl), so only the one holding <file>.roll (created with O_EXCL)
// rolls, and it checks the size again first. Appends never wait: a line written during the rename lands in one
// part or the other, whole. A lock left by a crash is taken over after a minute.
function roll(file, maxBytes) {
  const lock = `${file}.roll`;
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); } catch {
    try { if (Date.now() - fs.statSync(lock).mtimeMs > 60_000) fs.rmSync(lock, { force: true }); } catch { /* gone already */ }
    return;
  }
  try {
    if (fs.statSync(file).size > maxBytes) fs.renameSync(file, previousPart(file));
  } finally {
    fs.closeSync(fd); fs.rmSync(lock, { force: true });
  }
}

function parseLines(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn or hand-edited line: skip it, keep the rest */ }
  }
  return out;
}

/** Every line of a JSON-lines log, the rolled part first, so the newest lines are last. */
export const readLines = (file) => [...parseLines(previousPart(file)), ...parseLines(file)];

// One line of text, control characters removed, clamped.
export const oneLine = (v, n) => String(v ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export const iso = (ms) => new Date(ms).toISOString();
