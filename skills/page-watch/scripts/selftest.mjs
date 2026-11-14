#!/usr/bin/env node
// selftest.mjs: page-watch checked against a small site it serves itself on 127.0.0.1. No network beyond this machine.
//   node selftest.mjs            every check (needs Chromium for playwright-core: see SKILL.md step 2)
//   node selftest.mjs --offline  only the checks that need no browser: config, link card rules, self-check, arguments
// Exit 0 = all passed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WATCH = path.join(HERE, 'watch.mjs');
const offline = process.argv.includes('--offline');
let ok = 0; const bad = [];
const check = (name, cond, extra = '') => { if (cond) { ok++; console.log(`  ok   ${name}`); } else { bad.push(name); console.log(`  FAIL ${name}${extra ? ': ' + extra : ''}`); } };
/** A PNG's signature and IHDR chunk for a w×h picture, padded past 1,000 bytes. Enough for the header check. */
function PNG(w, h) {
  const ihdr = Buffer.alloc(25); ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'ascii'); ihdr.writeUInt32BE(w, 8); ihdr.writeUInt32BE(h, 12); ihdr[16] = 8; ihdr[17] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(1200)]);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'page-watch-selftest-'));
const writeCfg = (name, cfg) => { const f = path.join(tmp, name); fs.writeFileSync(f, JSON.stringify(cfg, null, 1)); return f; };
const run = (args, env = {}) => spawnSync(process.execPath, [WATCH, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 300000 });
const runAsync = (args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [WATCH, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('close', (status) => resolve({ status, out }));
});

// ---------- 1. arguments and config
console.log('arguments and config');
check('no mode: usage, exit 2', run([]).status === 2);
check('unknown option: exit 2', run(['--now', '--nope']).status === 2);
check('stray argument: exit 2', run(['--now', 'oops']).status === 2);
check('missing config: exit 2', run(['--check-config', '--config', path.join(tmp, 'none.json')]).status === 2);
{
  const example = run(['--check-config', '--config', path.join(HERE, 'example.page-watch.config.json')]);
  check('the example config is valid', example.status === 0, example.stderr.trim());
  for (const [why, cfg, re] of [
    ['pages as an object', { pages: { url: 'https://a.example/' } }, /pages must be a list/],
    ['a null page', { pages: [null] }, /pages\[0\] must be an object/],
    ['a nested typo', { report: { timezone: 'UTC' }, pages: [{ url: 'https://a.example/', name: 'a' }] }, /report: unknown field "timezone"/],
    ['fit.enabled as text', { fit: { enabled: 'yes' }, pages: [{ url: 'https://a.example/', name: 'a' }] }, /fit.enabled must be true or false/],
    ['links.concurrency 0', { links: { concurrency: 0 }, pages: [{ url: 'https://a.example/', name: 'a' }] }, /links.concurrency must be/],
    ['an unknown service field', { pages: [{ url: 'https://a.example/', name: 'a' }], services: [{ url: 'https://a.example/h', name: 'h', path: 'x', expect: 1, say: 's', colour: 1 }] }, /services\[0\]: unknown field "colour"/],
  ]) { const r = run(['--now', '--config', writeCfg('shape.json', cfg)]); check(`config refused, exit 2, no crash: ${why}`, r.status === 2 && re.test(r.stderr) && !/at .*watch\.mjs/.test(r.stderr), r.stderr.split('\n').slice(0, 2).join(' ')); }
  check('--config with no value: exit 2', run(['--now', '--config']).status === 2);
  check('--only with no value: exit 2', run(['--now', '--only', '--print']).status === 2);
  const f = writeCfg('bad.json', { pages: [{ url: 'http://example.com/', name: 'x' }, { url: 'https://a.example/', name: '', maxAgeMinutes: 1.5, colour: 'red' }], report: { timeZone: 'Mars/Base' }, extra: 1 });
  const r = run(['--check-config', '--config', f]);
  for (const [why, re] of [['plain http off localhost', /must be https/], ['empty name', /name is missing/], ['fractional max age', /maxAgeMinutes must be/], ['unknown page field', /unknown field "colour"/], ['bad time zone', /not a time zone/], ['unknown top-level field', /top level: unknown field "extra"/]]) check(`config refused: ${why}`, r.status === 2 && re.test(r.stderr), r.stderr.split('\n')[0]);
}

// ---------- 2. link card rules (no network)
console.log('link card rules');
{
  const { readCard, judgeCard } = await import('./card.mjs');
  const head = (o) => `<meta property="og:title" content="T"><meta property="og:description" content="Sam's page"><meta property="og:url" content="https://x.example/">${o}`;
  const good = head('<meta property="og:image" content="https://x.example/cards/a.jpg?v=0123456789"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="T"><meta name="twitter:description" content="D"><meta name="twitter:image" content="https://x.example/cards/a.jpg?v=0123456789">');
  const j = (h) => judgeCard(readCard(h));
  check('an apostrophe does not cut the description', readCard(good).description === "Sam's page");
  check('a good card passes with no notes', !j(good).problems.length && !j(good).notes.length);
  check('no image is a problem', j(head('<meta name="twitter:card" content="summary">')).problems.some((p) => /^no link card: og:image, twitter:image\b/.test(p)));
  check('a small card is a problem', j(good.replace('summary_large_image', 'summary')).problems.some((p) => /summary_large_image/.test(p)));
  check('different og and twitter images are a problem', j(good.replace('name="twitter:image" content="https://x.example/cards/a.jpg', 'name="twitter:image" content="https://x.example/cards/b.jpg')).problems.some((p) => /differ/.test(p)));
  check('no twitter:title is a problem', j(good.replace('<meta name="twitter:title" content="T">', '')).problems.some((p) => /twitter:title missing/.test(p)));
  check('a page with no card is one problem, not several', j(head('')).problems.length === 1, JSON.stringify(j(head('')).problems));
  check('a relative og:image is a problem', j(good.replaceAll('https://x.example/cards/a.jpg', '/cards/a.jpg')).problems.some((p) => /relative address/.test(p)));
  const { imageSize } = await import('./card.mjs');
  check('a PNG header gives the picture size', JSON.stringify(imageSize(PNG(1200, 630), 'image/png')) === '{"w":1200,"h":630}');
  check('a PNG signature followed by zeros is not a picture', imageSize(Buffer.concat([PNG(1, 1).subarray(0, 8), Buffer.alloc(3000)]), 'image/png') === null);
  check('a JPEG header gives the picture size', JSON.stringify(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 2, 0x76, 4, 0xb0, 3, 0, 0, 0]), 'image/jpeg')) === '{"w":1200,"h":630}');
  check('an unversioned image is a note', j(good.replaceAll('?v=0123456789', '')).notes.some((n) => /version/.test(n)));
  check('rel=canonical is a note', j(good + '<link rel="canonical" href="https://x.example/">').notes.some((n) => /canonical/.test(n)));
}

// ---------- 3. self-check (no browser)
console.log('self-check');
{
  const out = path.join(tmp, 'sc-report');
  const f = writeCfg('sc.json', { report: { dir: out, staleAfterHours: 26 }, state: { dir: path.join(tmp, 'sc-state') }, pages: [{ url: 'https://example.com/', name: 'x' }] });
  const write = (h) => { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'latest.md'), `---\ntype: page-watch\nran_at: ${new Date(Date.now() - h * 3600e3).toISOString()}\nstatus: all-fresh\n---\n\n# Page watch\n`); };
  write(2); check('a 2 h old report is fine (exit 0)', run(['--self-check', '--config', f]).status === 0);
  write(30); const r = run(['--self-check', '--config', f]); const md = fs.readFileSync(path.join(out, 'latest.md'), 'utf8');
  check('a 30 h old report is flagged (exit 1, warning, status not-running)', r.status === 1 && /has not run since/.test(md) && /^status: not-running$/m.test(md));
  run(['--self-check', '--config', f]);
  check('the warning is not stacked', (fs.readFileSync(path.join(out, 'latest.md'), 'utf8').match(/has not run since/g) || []).length === 1);
  fs.rmSync(out, { recursive: true });
  const never = run(['--self-check', '--config', f]);
  check('no report at all is flagged too', never.status === 1 && /has not run since it was set up/.test(fs.readFileSync(path.join(out, 'latest.md'), 'utf8')));
}

// ---------- 4. a full run against a site served here
if (!offline) {
  console.log('full run against a local site (needs Chromium)');
  const now = new Date().toISOString(), old = new Date(Date.now() - 2 * 3600e3).toISOString();
  const card = (p, img = '/card.png') => `<meta property="og:title" content="${p}"><meta property="og:description" content="d"><meta property="og:url" content="URL"><meta property="og:image" content="BASE${img}?v=1"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${p}"><meta name="twitter:description" content="d"><meta name="twitter:image" content="BASE${img}?v=1">`;
  const future = new Date(Date.now() + 3 * 3600e3).toISOString();
  const page = (title, head, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;
  const routes = {
    // fresh and stale pages use the shipped fresh.js and a /data-status.json, as a real site would
    '/fresh.html': () => page('Fresh', card('Fresh') + '<meta name="data-sources" content="feed"><meta name="data-max-age" content="30"><script src="/fresh.js" defer></script>', '<p data-fresh="line"></p><a href="/ok.html">ok</a> <a href="/walled">walled</a>'),
    '/stale.html': () => page('Stale', card('Stale') + '<meta name="data-sources" content="feed old"><meta name="data-max-age" content="30"><script src="/fresh.js" defer></script>', '<p data-fresh="banner" hidden></p><a href="/fresh.html">fresh</a>'),
    '/unknown.html': () => page('Unknown', card('Unknown') + '<meta name="data-sources" content="nosuch"><meta name="data-max-age" content="30"><script src="/fresh.js" defer></script>', ''),
    '/mismatch.html': () => page('Mismatch', card('Mismatch') + `<meta name="data-max-age" content="60"><meta name="data-updated" content="${now}">`, ''),
    '/broken.html': () => page('Broken', card('Broken'), '<a href="/missing.html">gone</a><script>throw new Error("selftest boom")</script>'),
    '/nocard.html': () => page('No card', '', '<p>no card here</p>'),
    '/ok.html': () => page('Ok', '', 'ok'),
    '/tiny.html': () => page('Tiny', card('Tiny', '/tiny.png'), ''),
    '/future.html': () => page('Future', card('Future') + `<meta name="data-max-age" content="30"><meta name="data-updated" content="${future}">`, ''),
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/fresh.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(HERE, 'fresh.js'))); }
    if (u.pathname === '/data-status.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ sources: { feed: { checkedAt: now }, old: { checkedAt: old } } })); }
    if (u.pathname === '/card.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG(1200, 630)); }
    if (u.pathname === '/tiny.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG(64, 64)); }
    if (u.pathname === '/api/html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<p>maintenance</p>'); }
    if (u.pathname === '/walled') { res.writeHead(403); return res.end('no bots'); }
    if (u.pathname === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ status: 'degraded', reason: 'db slow' })); }
    if (u.pathname === '/api/ok') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ status: 'ok' })); }
    const f = routes[u.pathname];
    if (!f) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('not found'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(f().replace('content="URL"', `content="http://127.0.0.1:${server.address().port}${u.pathname}"`).replaceAll('BASE', `http://127.0.0.1:${server.address().port}`));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const out = path.join(tmp, 'report'), state = path.join(tmp, 'state');
  const f = writeCfg('site.json', { report: { dir: out, timeZone: 'UTC', footer: 'Selftest footer.' }, state: { dir: state }, userAgent: 'page-watch-selftest', pages: [
    { url: `${base}/fresh.html`, name: 'Fresh', maxAgeMinutes: 30 },
    { url: `${base}/stale.html`, name: 'Stale', maxAgeMinutes: 30 },
    { url: `${base}/mismatch.html`, name: 'Mismatch', maxAgeMinutes: 30 },
    { url: `${base}/unknown.html`, name: 'Unknown', maxAgeMinutes: 30 },
    { url: `${base}/broken.html`, name: 'Broken' },
    { url: `${base}/nocard.html`, name: 'No card' },
    { url: `${base}/nocard.html?skip`, name: 'No card, card check off', linkCard: false },
    { url: `${base}/tiny.html`, name: 'Tiny card' },
    { url: `${base}/future.html`, name: 'Future', maxAgeMinutes: 30 },
    { url: `${base}/gone.html`, name: 'Gone' },
  ], services: [
    { url: `${base}/api/health`, name: 'Health', path: 'status', expect: 'ok', say: 'API not healthy', whyPath: 'reason' },
    { url: `${base}/api/ok`, name: 'Health ok', path: 'status', expect: 'ok', say: 'never shown' },
    { url: `${base}/api/html`, name: 'Health html', path: 'status', expect: 'ok', say: 'API answers HTML' },
  ] });
  const r = await runAsync(['--now', '--config', f]);
  const md = fs.existsSync(path.join(out, 'latest.md')) ? fs.readFileSync(path.join(out, 'latest.md'), 'utf8') : '';
  if (/no Chromium/.test(md)) { console.log(`  FAIL ${md.match(/FAILED[^\n]*/)?.[0]}`); bad.push('Chromium'); }
  else {
    const row = (name) => md.split('\n').find((l) => l.startsWith(`| [${name}](`)) || '';
    check('exit 1 when there are problems', r.status === 1, r.out.split('\n').slice(-3).join(' '));
    check('front matter: ran_at, status problems', /^ran_at: \d{4}-/m.test(md) && /^status: problems$/m.test(md));
    check('a fresh page passes', /✓ \|$/.test(row('Fresh')) && /updated \d+ min ago/.test(row('Fresh')), row('Fresh'));
    check('a stale page is a problem, dated from its data time', /\*\*stale:\*\* data last updated/.test(md) && md.includes(`since ${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(old))}`));
    check('fresh.js: a source missing from data-status.json means no data time, a problem', /Unknown\*\* .*\n- \*\*stale:\*\* the page shows no data time/.test(md));
    check('a max age that differs from the config is a problem', /declares data-max-age 60 min; the config says 30/.test(md));
    check('a page error is a problem', /\*\*page-error:\*\* Error: selftest boom/.test(md));
    check('a broken link is a problem, with the page it is on', new RegExp(`${base}/missing.html: 404 · on Broken`).test(md));
    check("a 403 link is 'couldn't verify', not broken", /1 couldn't be verified/.test(md) && !/walled: 403/.test(md));
    check('a page with no card is a problem', /No card\*\* .*\n- \*\*link-card:\*\* no link card/.test(md));
    check('linkCard: false turns the card check off', /✓ \|$/.test(row('No card, card check off')), row('No card, card check off'));
    check('a service reading the wrong value is a problem, with the reason', /API not healthy: status is "degraded", not "ok" \(db slow\)/.test(md));
    check('a card image too small for a large card is a problem', /Tiny card\*\* .*\n- \*\*link-card:\*\* link card image doesn't load: .*64×64: too small/.test(md));
    check('a data time in the future is a problem', /Future\*\* .*\n- \*\*stale:\*\* the page's data time .* in the future/.test(md) && /in the future \(/.test(row('Future')));
    check('a page that 404s is one problem', /Gone\*\* .*\n- \*\*http:\*\* HTTP 404 · since [^\n]*\n\n/.test(md));
    check('a service answering HTML says so, with its HTTP status', /API answers HTML: HTTP 200 but not JSON \(text\/html\)/.test(md));
    check('the report names the browser it used', /Browser: /.test(md));
    check('a service reading right passes', /✓ \|$/.test(row('Health ok')));
    check('the footer and report files are written', md.includes('Selftest footer.') && fs.readdirSync(out).some((x) => /^\d{4}-\d\d-\d\d\.md$/.test(x)));
    const since1 = JSON.parse(fs.readFileSync(path.join(state, 'since.json'), 'utf8'));
    await new Promise((res) => setTimeout(res, 1100));
    const r2 = await runAsync(['--now', '--config', f]);
    const since2 = JSON.parse(fs.readFileSync(path.join(state, 'since.json'), 'utf8'));
    const k = Object.keys(since1).find((x) => x.includes('page-error'));
    check('"since" survives a second run', r2.status === 1 && k && since1[k] === since2[k]);
    const before = fs.readFileSync(path.join(out, 'latest.md'), 'utf8');
    const p = await runAsync(['--now', '--config', f, '--only', '/fresh.html', '--no-cards']);
    const sinceP = JSON.parse(fs.readFileSync(path.join(state, 'since.json'), 'utf8'));
    check('a partial run writes partial.md and leaves latest.md and since.json alone', p.status !== 2 && fs.readFileSync(path.join(out, 'latest.md'), 'utf8') === before && /^type: page-watch-partial$/m.test(fs.readFileSync(path.join(out, 'partial.md'), 'utf8')) && JSON.stringify(sinceP) === JSON.stringify(since2));
    check('--auto after a fresh run only self-checks', /self-check: last full run/.test((await runAsync(['--auto', '--config', f])).out));
    const typo = run(['--now', '--config', f, '--only', 'nothing-matches-this']);
    check('--only that matches nothing: exit 2, report untouched', typo.status === 2 && /^status: problems$/m.test(fs.readFileSync(path.join(out, 'latest.md'), 'utf8')));
    const fail = run(['--now', '--config', f], { PAGE_WATCH_CHROMIUM: path.join(tmp, 'no-such-browser') });
    const fmd = fs.readFileSync(path.join(out, 'latest.md'), 'utf8');
    check('a crash writes status: failed and keeps the last good time', fail.status === 1 && /^status: failed$/m.test(fmd) && /The last good run was/.test(fmd));
    check('the self-check after a failed run exits 1', run(['--self-check', '--config', f]).status === 1);
  }
  server.close();
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nselftest: ${ok} ok, ${bad.length} failed${offline ? ' (offline checks only)' : ''}`);
process.exit(bad.length ? 1 : 0);
