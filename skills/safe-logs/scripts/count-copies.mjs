#!/usr/bin/env node
// count-copies.mjs: after a leak, find every copy of one secret without ever printing it.
//
//   node count-copies.mjs --var MY_API_KEY ~/logs ~/notes            the value comes from the environment
//   node count-copies.mjs --var MY_API_KEY --env-file ~/secrets/app.env ~/logs   …or from an env file (NAME=value)
//
// Prints, per file that holds it: how many times the whole value appears, and how many times its first 12
// characters appear (a cut-off or wrapped copy). Never the value, never a line from the file. Folders are walked
// (skipping .git and node_modules); binary files are searched too. Symlinks are not followed.
// Exit 0: no copies · 1: copies found · 2: usage or the value couldn't be read.
// Then: rotate the secret first (copies in synced folders, backups and version history can't be recalled),
// and only then clean the copies (mask-pipe.mjs --count rewrites a text file masked).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readValue({ name, envFile }) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name ?? '')) throw new Error('--var needs a variable name');
  if (!envFile) return process.env[name] ?? null;
  let text; try { text = fs.readFileSync(envFile, 'utf8'); } catch { throw new Error('cannot read the env file'); }
  for (const l of text.split('\n')) {
    const m = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`).exec(l);
    if (m) return m[1].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return null;
}

export function countIn(buf, value) {
  const whole = Buffer.from(value), head = Buffer.from(value.slice(0, 12));
  const count = (needle) => { let n = 0, i = 0; while ((i = buf.indexOf(needle, i)) !== -1) { n++; i += needle.length; } return n; };
  return { whole: count(whole), head: count(head) };
}

export function* walk(p) {
  let st; try { st = fs.lstatSync(p); } catch { return; }
  if (st.isSymbolicLink()) return;
  if (st.isFile()) { yield p; return; }
  if (!st.isDirectory()) return;
  let entries = []; try { entries = fs.readdirSync(p); } catch { return; }
  for (const e of entries.sort()) { if (e === '.git' || e === 'node_modules') continue; yield* walk(path.join(p, e)); }
}

function main(argv) {
  const o = { name: null, envFile: null, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--var') o.name = argv[++i];
    else if (argv[i] === '--env-file') o.envFile = argv[++i];
    else if (argv[i] === '-h' || argv[i] === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return 0; }
    else o.paths.push(argv[i]);
  }
  let value;
  try { value = readValue(o); } catch (e) { console.error(`count-copies: ${e.message}`); return 2; }
  if (!value) { console.error(`count-copies: ${o.name ?? 'the variable'} is empty or not set; nothing to look for`); return 2; }
  if (value.length < 12) { console.error('count-copies: the value is under 12 characters; too short to count reliably'); return 2; }
  if (!o.paths.length) { console.error('count-copies: give at least one file or folder to search'); return 2; }
  let files = 0, hits = 0, total = 0;
  for (const p of o.paths) for (const f of walk(p)) {
    let buf; try { buf = fs.readFileSync(f); } catch { continue; }
    files++;
    const c = countIn(buf, value);
    if (c.whole || c.head) { hits++; total += c.whole; console.log(`${String(c.whole).padStart(5)} whole · ${String(c.head).padStart(5)} first-12  ${f}`); }
  }
  console.log(`count-copies: ${total} whole cop${total === 1 ? 'y' : 'ies'} in ${hits} of ${files} file(s)${hits ? ' — rotate the secret, then clean these' : ''}`);
  return hits ? 1 : 0;
}

// Run as a command only when started directly. Node resolves symlinks for the module (/tmp on macOS, a linked
// tools/ folder) but not in argv[1], so compare real paths, or a linked path would silently do nothing.
const realArgv1 = () => { try { return fs.realpathSync(process.argv[1]); } catch { return path.resolve(process.argv[1]); } };
if (process.argv[1] && realArgv1() === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
