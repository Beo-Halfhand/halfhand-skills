// asks.mjs: "Asks for you", a file inbox between your agents and you. Each side writes only its own files.
//
//   the agent writes   <asksDir>/<id>.json           { "id", "agent", "question", "draft"?, "at" }
//   the dashboard writes <asksDir>/answers/<id>.json  { "id", "verdict": "ok" | "skip" | "own", "text"?, "at" }
//
// An ask is open while its answer file doesn't exist. The dashboard creates an answer file once (exclusive create)
// and never edits or deletes anything. The agent reads the answer, applies its own rules, and tidies up its ask.
import fs from 'node:fs';
import path from 'node:path';

export const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const TEXT_MAX = 500;
const clean = (v, n) => String(v ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export function listAsks(asksDir, agentKeys) {
  if (!asksDir) return { enabled: false, asks: [] };
  let files = []; try { files = fs.readdirSync(asksDir).filter((f) => f.endsWith('.json')); } catch { return { enabled: true, asks: [], note: 'the asks folder does not exist yet' }; }
  const answered = new Set((() => { try { return fs.readdirSync(path.join(asksDir, 'answers')); } catch { return []; } })().filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));
  const asks = [];
  for (const f of files) {
    const id = f.slice(0, -5); if (!ID_RE.test(id)) continue;
    let j; try { j = JSON.parse(fs.readFileSync(path.join(asksDir, f), 'utf8')); } catch { continue; }
    if (!j || typeof j !== 'object' || (j.id !== undefined && String(j.id) !== id)) continue;
    const agent = String(j.agent ?? '').toLowerCase();
    const at = Date.parse(j.at ?? '');
    asks.push({ id, agent: agentKeys.includes(agent) ? agent : null, question: clean(j.question, 600), draft: clean(j.draft, TEXT_MAX) || null,
      at: Number.isFinite(at) ? at : null, open: !answered.has(id) });
  }
  asks.sort((x, y) => (y.open - x.open) || ((y.at ?? 0) - (x.at ?? 0)));
  return { enabled: true, max: TEXT_MAX, asks: asks.slice(0, 50) };
}

// → [httpCode, body]
export function answerAsk(asksDir, body) {
  if (!asksDir) return [404, { error: 'asks are off (no asksDir in the config)' }];
  const id = String(body?.id ?? ''), verdict = String(body?.verdict ?? '');
  if (!ID_RE.test(id)) return [400, { error: 'bad ask id' }];
  if (!['ok', 'skip', 'own'].includes(verdict)) return [400, { error: 'verdict must be ok, skip or own' }];
  const askFile = path.join(asksDir, `${id}.json`);
  if (!fs.existsSync(askFile)) return [404, { error: `no ask ${id}` }];
  const text = verdict === 'own' ? clean(body?.text, TEXT_MAX + 1) : '';
  if (verdict === 'own' && !text) return [400, { error: 'write your answer first' }];
  if (text.length > TEXT_MAX) return [400, { error: `answers are ${TEXT_MAX} characters at most` }];
  const dir = path.join(asksDir, 'answers');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const out = { id, verdict, ...(text ? { text } : {}), at: new Date().toISOString(), by: 'fleet-dashboard' };
  try { fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(out, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (e) { if (e.code === 'EEXIST') return [409, { error: `${id} is already answered` }]; throw e; }
  return [200, { ok: true, id, verdict }];
}
