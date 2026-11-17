// files.mjs: the small file habits every control file uses.
//   - write whole files atomically (temp file + rename), so a reader never sees half a file
//   - owner-only permissions (600 files, 700 folders): these files say what an agent may do
//   - JSON lines are appended one line per write and read back skipping any broken line
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

export function appendLine(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', { mode: 0o600 });
}

export function readLines(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn or hand-edited line: skip it, keep the rest */ }
  }
  return out;
}

// One line of text, control characters removed, clamped.
export const oneLine = (v, n) => String(v ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export const iso = (ms) => new Date(ms).toISOString();
