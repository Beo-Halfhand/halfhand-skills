// server.mjs: the dashboard's web server. It listens on 127.0.0.1 only. To open it from a phone, put a private
// proxy in front (one that only serves your own signed-in devices) and list that host and who may use it under "access".
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFleet, agentDetail, outputFor } from './fleet.mjs';
import { listAsks, answerAsk } from './asks.mjs';

const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const PAGES = { '/': 'index.html', '/m': 'm.html', '/agent': 'agent.html' };
const STATIC = new Set(fs.readdirSync(PUB).filter((f) => TYPES[path.extname(f)] && !f.endsWith('.html')));
export const SEC_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
};

export function createServer({ config, records, version, log = () => {} }) {
  const port = config.port;
  const local = new RegExp(`^(localhost|127\\.0\\.0\\.1|\\[::1\\])(:${port})?$`, 'i');
  const keys = config.agents.map((a) => a.key);
  const byKey = (k) => config.agents.find((a) => a.key === k) ?? null;

  function gate(req) {                         // → null if allowed, else [code, text]
    const host = String(req.headers.host ?? '').toLowerCase();
    if (local.test(host)) return null;
    if (config.access.hosts.some((h) => host === h || host.split(':')[0] === h)) {
      const login = String(req.headers[config.access.loginHeader] ?? '').toLowerCase();
      if (login && config.access.allowLogins.includes(login)) return null;
      log(`refused ${host}: login ${login ? 'not in access.allowLogins' : 'header missing'}`);
      return [403, 'fleet-dashboard: this login is not in access.allowLogins'];
    }
    return [421, 'fleet-dashboard: unknown host (add it to access.hosts in the config)'];
  }
  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...SEC_HEADERS }); res.end(JSON.stringify(obj)); };
  const readBody = (req) => new Promise((resolve) => {
    let d = '', big = false;
    req.on('data', (c) => { d += c; if (d.length > 8192) { big = true; req.destroy(); } });
    req.on('end', () => { if (big) return resolve(null); try { resolve(JSON.parse(d || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
  const asksOpen = () => listAsks(config.asksDir, keys).asks.filter((x) => x.open).length;

  return http.createServer(async (req, res) => {
    try {
      const g = gate(req);
      if (g) { res.writeHead(g[0], { 'Content-Type': 'text/plain; charset=utf-8', ...SEC_HEADERS }); return res.end(g[1]); }
      const url = new URL(req.url, 'http://x'), p = url.pathname;
      if (req.method === 'GET' || req.method === 'HEAD') {
        const file = PAGES[p] ?? (STATIC.has(p.slice(1)) ? p.slice(1) : null);
        if (file) { res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], ...SEC_HEADERS }); return res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(path.join(PUB, file))); }
        if (p === '/api/fleet') return send(res, 200, buildFleet(config, records, version, asksOpen()));
        if (p === '/api/health') { const r = records(Date.now() - 3_600_000); return send(res, 200, { ok: true, version, agents: keys.length, lastRound: r.length ? r[r.length - 1].t : null }); }
        if (p === '/api/asks') return send(res, 200, listAsks(config.asksDir, keys));
        if (p === '/api/output') {
          const key = String(url.searchParams.get('key') ?? 'fleet');
          if (key !== 'fleet' && !byKey(key)) return send(res, 404, { error: 'unknown agent' });
          return send(res, 200, outputFor(config, records, key));
        }
        const m = /^\/api\/agent\/([a-z0-9_-]{1,40})$/.exec(p);
        if (m) { const a = byKey(m[1]); return a ? send(res, 200, { version, title: config.title, timeZone: config.timeZone, ...agentDetail(config, records, a) }) : send(res, 404, { error: 'unknown agent' }); }
      }
      if (req.method === 'POST' && p === '/api/ask') {
        if (req.headers['x-deck'] !== '1') return send(res, 403, { error: 'missing X-Deck header' });   // a plain cross-site form can't set it
        const origin = req.headers.origin;
        if (origin) { let oh = ''; try { oh = new URL(origin).host; } catch { /* bad origin */ } if (oh.toLowerCase() !== String(req.headers.host).toLowerCase()) return send(res, 403, { error: 'cross-origin' }); }
        const body = await readBody(req); if (!body) return send(res, 400, { error: 'bad json' });
        const [code, out] = answerAsk(config.asksDir, body);
        if (code === 200) log(`ask ${out.id} answered: ${out.verdict}`);
        return send(res, code, out);
      }
      send(res, 404, { error: 'not found' });
    } catch (e) { log(`error ${req.method} ${req.url}: ${e.message}`); send(res, 500, { error: 'server error' }); }
  });
}
