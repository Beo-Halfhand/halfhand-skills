#!/usr/bin/env node
// page-watch: no stale or broken public pages without you hearing about it. For every page in your config it checks:
//   data age vs its max (the page's own <meta name="data-updated"> and <meta name="data-max-age">)
//   HTTP status · broken internal and external links · page errors · its link card (card.mjs) · optionally fit (fit-check)
// plus "services": a JSON value that must read a given way. It writes <report dir>/latest.md and <report dir>/YYYY-MM-DD.md:
// "All fresh", or what is stale or broken and since when.
//
//   node watch.mjs --now [--config <file>]    a full run
//   node watch.mjs --auto                      for a scheduler: a full run if the last one is 20+ h old, else only the self-check
//   node watch.mjs --self-check                if the last full run is older than staleAfterHours, say so at the top of latest.md
//   node watch.mjs --check-config              validate the config and exit
//   --no-links, --no-fit, --no-cards, --print, --only <substring>
//
// Config: --config <file>, else $PAGE_WATCH_CONFIG, else ./page-watch.config.json. Relative paths in it are relative to the
// config file. No secrets: it reads public pages only. It never fails silently: a crash writes status: failed to latest.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { checkCard } from './card.mjs';

export const VERSION = '0.2.0';
const FLAGS = new Set(['--now', '--auto', '--self-check', '--check-config', '--no-links', '--no-fit', '--no-cards', '--print', '--only', '--config']);
const USAGE = 'usage: node watch.mjs --now | --auto | --self-check | --check-config   [--config <file>] [--no-links] [--no-fit] [--no-cards] [--print] [--only <substring>]';

// ---------- config
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isLocal = (u) => { try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(u).hostname); } catch { return false; } };
const okUrl = (u) => typeof u === 'string' && (/^https:\/\//.test(u) || (/^http:\/\//.test(u) && isLocal(u)));
const SHAPE = {
  top: ['$schema', 'about', 'report', 'state', 'userAgent', 'fit', 'links', 'pages', 'services'],
  report: ['dir', 'staleAfterHours', 'timeZone', 'footer', 'retryHint'],
  state: ['dir'], fit: ['enabled', 'widths', 'command'], links: ['concurrency', 'skip'],
  page: ['url', 'name', 'source', 'maxAgeMinutes', 'linkCard', 'note'],
  service: ['url', 'name', 'source', 'path', 'expect', 'say', 'whyPath', 'note'],
};

/** Problems with a parsed config, as strings. Empty = valid. Checks shape, types and unknown fields at every level. */
export function validateRaw(raw) {
  const bad = [];
  if (!isObj(raw)) return ['the config must be a JSON object'];
  const unknown = (o, allowed, where) => { for (const k of Object.keys(o)) if (!allowed.includes(k)) bad.push(`${where}: unknown field "${k}"`); };
  const str = (v, where) => { if (v !== undefined && typeof v !== 'string') bad.push(`${where} must be text`); };
  unknown(raw, SHAPE.top, 'top level');
  for (const k of ['report', 'state', 'fit', 'links']) if (raw[k] !== undefined && !isObj(raw[k])) bad.push(`${k} must be an object`);
  const r = isObj(raw.report) ? raw.report : {}, st = isObj(raw.state) ? raw.state : {}, f = isObj(raw.fit) ? raw.fit : {}, l = isObj(raw.links) ? raw.links : {};
  if (isObj(raw.report)) unknown(r, SHAPE.report, 'report');
  if (isObj(raw.state)) unknown(st, SHAPE.state, 'state');
  if (isObj(raw.fit)) unknown(f, SHAPE.fit, 'fit');
  if (isObj(raw.links)) unknown(l, SHAPE.links, 'links');
  str(r.dir, 'report.dir'); str(r.timeZone, 'report.timeZone'); str(r.footer, 'report.footer'); str(r.retryHint, 'report.retryHint'); str(st.dir, 'state.dir'); str(raw.userAgent, 'userAgent'); str(raw.about, 'about');
  if (r.staleAfterHours !== undefined && !(typeof r.staleAfterHours === 'number' && r.staleAfterHours > 0)) bad.push('report.staleAfterHours must be a number above 0');
  if (typeof r.timeZone === 'string') { try { new Intl.DateTimeFormat('en-US', { timeZone: r.timeZone }); } catch { bad.push(`report.timeZone is not a time zone: ${r.timeZone}`); } }
  if (f.enabled !== undefined && typeof f.enabled !== 'boolean') bad.push('fit.enabled must be true or false');
  if (f.widths !== undefined && !(Array.isArray(f.widths) && f.widths.length && f.widths.every((n) => Number.isInteger(n) && n > 0))) bad.push('fit.widths must be a list of widths in px');
  if (f.command !== undefined && f.command !== null && !(Array.isArray(f.command) && f.command.length && f.command.every((x) => typeof x === 'string'))) bad.push('fit.command must be null or a list of strings, e.g. ["node", "/path/to/fit-check.mjs"]');
  if (l.concurrency !== undefined && !(Number.isInteger(l.concurrency) && l.concurrency >= 1 && l.concurrency <= 32)) bad.push('links.concurrency must be a whole number from 1 to 32');
  if (l.skip !== undefined) { if (!Array.isArray(l.skip)) bad.push('links.skip must be a list of regular expressions'); else for (const x of l.skip) { try { new RegExp(x); } catch { bad.push(`links.skip: not a regular expression: ${x}`); } } }
  if (!Array.isArray(raw.pages) || !raw.pages.length) bad.push('pages must be a list with at least one page');
  if (raw.services !== undefined && !Array.isArray(raw.services)) bad.push('services must be a list');
  const urls = new Set();
  for (const [i, p] of (Array.isArray(raw.pages) ? raw.pages : []).entries()) {
    const w = `pages[${i}]`;
    if (!isObj(p)) { bad.push(`${w} must be an object`); continue; }
    unknown(p, SHAPE.page, w);
    if (!okUrl(p.url)) bad.push(`${w}.url must be https:// (http:// only for localhost): ${p.url}`);
    else if (urls.has(p.url)) bad.push(`${w}.url is listed twice: ${p.url}`); else urls.add(p.url);
    if (!p.name || typeof p.name !== 'string') bad.push(`${w}.name is missing`);
    str(p.source, `${w}.source`); str(p.note, `${w}.note`);
    if (p.maxAgeMinutes !== undefined && p.maxAgeMinutes !== null && !(Number.isInteger(p.maxAgeMinutes) && p.maxAgeMinutes > 0)) bad.push(`${w}.maxAgeMinutes must be a whole number above 0, or null for a static page`);
    if (p.linkCard !== undefined && typeof p.linkCard !== 'boolean') bad.push(`${w}.linkCard must be true or false`);
  }
  for (const [i, sv] of (Array.isArray(raw.services) ? raw.services : []).entries()) {
    const w = `services[${i}]`;
    if (!isObj(sv)) { bad.push(`${w} must be an object`); continue; }
    unknown(sv, SHAPE.service, w);
    if (!okUrl(sv.url)) bad.push(`${w}.url must be https:// (http:// only for localhost)`);
    for (const k of ['name', 'path', 'say']) if (!sv[k] || typeof sv[k] !== 'string') bad.push(`${w}.${k} is missing`);
    if (sv.expect === undefined) bad.push(`${w}.expect is missing`);
    str(sv.whyPath, `${w}.whyPath`);
  }
  return bad;
}

/** Read and validate a config file. Throws with every problem listed; returns the resolved settings. */
export function loadConfig(file) {
  const abs = path.resolve(file);
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { throw new Error(`cannot read config ${file}: ${e.code || e.message}`); }
  const bad = validateRaw(cfg);
  if (bad.length) throw new Error(`config ${abs} has ${bad.length} problem(s):\n- ${bad.join('\n- ')}`);
  const base = path.dirname(abs);
  const at = (p, dflt) => { const v = (p ?? dflt).replace(/^~(?=\/|$)/, os.homedir()); return path.isAbsolute(v) ? v : path.join(base, v); };
  const staleH = cfg.report?.staleAfterHours ?? 26;
  return {
    file: abs,
    pages: cfg.pages, services: cfg.services ?? [],
    reportDir: process.env.PAGE_WATCH_OUT || at(cfg.report?.dir, './page-watch-report'),
    stateDir: process.env.PAGE_WATCH_STATE || at(cfg.state?.dir, './.page-watch-state'),
    staleH,
    autoH: Math.min(20, staleH * 0.75), // --auto does a full run when the last one is at least this old
    timeZone: cfg.report?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    footer: cfg.report?.footer ?? '',
    retryHint: cfg.report?.retryHint ?? '',
    userAgent: cfg.userAgent || `page-watch/${VERSION}`,
    fit: { enabled: cfg.fit?.enabled === true, widths: cfg.fit?.widths ?? [390, 1440], command: cfg.fit?.command ?? null },
    linkConcurrency: cfg.links?.concurrency ?? 6,
    skipLinks: (cfg.links?.skip ?? []).map((x) => new RegExp(x)),
  };
}

// ---------- time words
function timeWords(tz) {
  const pt = (d) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(d));
  const day = (d) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(d)).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };
  return { pt, day };
}
const why = (e) => e?.cause?.code || e?.cause?.errors?.[0]?.code || (e?.name === 'TimeoutError' ? 'timed out' : e?.cause?.message || e?.message || String(e));
const ago = (ms) => { const m = Math.round(ms / 60000); return m < 90 ? `${m} min` : m < 48 * 60 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} days`; };

// ---------- the run
export async function main(argv = process.argv.slice(2)) {
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  for (const [i, a] of argv.entries()) {
    if (a.startsWith('-') && !FLAGS.has(a)) { console.error(`unknown option ${a}\n${USAGE}`); return 2; }
    if (['--only', '--config'].includes(a) && (argv[i + 1] === undefined || argv[i + 1].startsWith('-'))) { console.error(`${a} needs a value\n${USAGE}`); return 2; }
    if (!a.startsWith('-') && !['--only', '--config'].includes(argv[i - 1])) { console.error(`unexpected argument ${a}\n${USAGE}`); return 2; }
  }
  if (!['--now', '--auto', '--self-check', '--check-config'].some(has)) { console.error(USAGE); return 2; }

  const cfgFile = val('--config') || process.env.PAGE_WATCH_CONFIG || 'page-watch.config.json';
  let C;
  try { C = loadConfig(cfgFile); } catch (e) { console.error(e.message.startsWith('config ') ? e.message : `FAILED: ${e.message}`); return 2; }
  if (has('--check-config')) { console.log(`config ok: ${C.pages.length} page(s), ${C.services.length} service(s); report to ${C.reportDir}`); return 0; }

  const { pt, day } = timeWords(C.timeZone);
  const only = val('--only');
  if (has('--only') && (!only || ![...C.pages, ...C.services].some((x) => x.url.includes(only)))) { console.error(`--only ${only ?? ''} matches no page or service in ${C.file}`); return 2; }
  const log = (m) => { const line = `${new Date().toISOString()} ${m}\n`; process.stdout.write(line); try { fs.mkdirSync(C.stateDir, { recursive: true }); fs.appendFileSync(path.join(C.stateDir, 'watch.log'), line); } catch {} };
  const latest = path.join(C.reportDir, 'latest.md');
  const lastRun = () => { try { const m = fs.readFileSync(latest, 'utf8').match(/^ran_at: (\S+)$/m); return m ? Date.parse(m[1]) : null; } catch { return null; } };
  const retry = C.retryHint || `node watch.mjs --now --config ${C.file}`;

  function writeFailed(err) {
    const now = new Date(), prev = lastRun();
    const msg = String(err?.message || err).split('\n')[0].slice(0, 300);
    log('FAILED: ' + msg);
    try {
      fs.mkdirSync(C.reportDir, { recursive: true });
      fs.writeFileSync(partial ? path.join(C.reportDir, 'partial.md') : latest, ['---', partial ? 'type: page-watch-partial' : 'type: page-watch', `ran_at: ${prev ? new Date(prev).toISOString() : ''}`, 'status: failed', `updated: ${day(now)}`, `summary: "FAILED: ${msg.replace(/"/g, "'")}"`, '---', '', '# Page watch: FAILED', '', `- FAILED ${pt(now)}: ${msg}`, prev ? `- The last good run was ${pt(prev)}.` : '- No earlier run.', '', `Retry: \`${retry}\`. Log: \`${path.join(C.stateDir, 'watch.log')}\`.`, ''].join('\n'));
    } catch (e) { log('could not write latest.md either: ' + e.message); }
    if (has('--print')) { try { process.stdout.write('\n' + fs.readFileSync(latest, 'utf8')); } catch {} }
    return 1;
  }

  function selfCheck() {
    const prev = lastRun(), now = Date.now();
    let failedNow = false; try { failedNow = /^status: failed$/m.test(fs.readFileSync(latest, 'utf8')); } catch {}
    if (prev && now - prev <= C.staleH * 3600e3) { log(`self-check: last full run ${ago(now - prev)} ago${failedNow ? ', but the latest attempt FAILED (see latest.md)' : ', fine'}`); return failedNow ? 1 : 0; }
    let body = ''; try { body = fs.readFileSync(latest, 'utf8'); } catch {}
    const warn = `> ⚠ **page-watch has not run since ${prev ? pt(prev) : 'it was set up'}** (${prev ? ago(now - prev) : 'never'}; checked ${pt(now)}). Everything below may be out of date. Check the scheduler and \`${path.join(C.stateDir, 'watch.log')}\`.\n\n`;
    body = body.replace(/^> ⚠ \*\*page-watch has not run since[\s\S]*?\n\n/m, '');
    if (!body) body = ['---', 'type: page-watch', 'ran_at: ', 'status: not-running', '---', '', '# Page watch', ''].join('\n');
    const i = body.indexOf('\n---\n', 4);
    body = i > 0 ? body.slice(0, i + 5) + '\n' + warn + body.slice(i + 5).replace(/^\n/, '') : warn + body;
    body = body.replace(/^status: .*$/m, 'status: not-running');
    fs.mkdirSync(C.reportDir, { recursive: true }); fs.writeFileSync(latest, body);
    log(`self-check: NOT RUNNING, last full run ${prev ? ago(now - prev) + ' ago' : 'never'}; latest.md flagged`);
    return 1;
  }

  let browserUsed = 'none (no pages)';
  async function launchBrowser() {
    const { chromium } = await import('playwright-core');
    if (process.env.PAGE_WATCH_CHROMIUM) { browserUsed = `PAGE_WATCH_CHROMIUM (${process.env.PAGE_WATCH_CHROMIUM})`; return chromium.launch({ executablePath: process.env.PAGE_WATCH_CHROMIUM }); }
    try { const b = await chromium.launch(); browserUsed = `playwright-core's own (${b.version()})`; return b; } catch (e) {
      const alt = newestHeadlessShell();
      if (!alt) throw new Error('no Chromium for playwright-core: run `npx playwright-core install chromium-headless-shell` in the scripts folder, or set PAGE_WATCH_CHROMIUM');
      const b = await chromium.launch({ executablePath: alt });
      browserUsed = `a fallback, not the version playwright-core expects: ${alt} (${b.version()}). Install the matching one with npx playwright-core install chromium-headless-shell`;
      log(`browser: ${browserUsed}`);
      return b;
    }
  }

  async function checkPage(browser, pg) {
    const r = { url: pg.url, name: pg.name, problems: [], notes: [], links: [] };
    try { const res = await fetch(pg.url, { redirect: 'follow', headers: { 'user-agent': C.userAgent }, signal: AbortSignal.timeout(20000) }); r.http = res.status; if (res.status >= 400) r.problems.push({ kind: 'http', detail: `HTTP ${res.status}` }); }
    catch (e) { r.http = 0; r.problems.push({ kind: 'http', detail: `unreachable: ${why(e)}` }); return r; }
    if (r.http >= 400) return r; // one problem for a page that isn't there, not three
    if (!has('--no-cards') && pg.linkCard !== false) { const c = await checkCard(pg.url); r.problems.push(...c.problems); r.notes.push(...c.notes); }
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errs = [], failed = [], consoleErr = [], host = new URL(pg.url).host;
    page.on('pageerror', (e) => errs.push(String(e).split('\n')[0].slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error') consoleErr.push(m.text().slice(0, 160)); });
    page.on('response', (x) => { try { if (x.status() >= 400 && new URL(x.url()).host === host && x.url() !== pg.url) failed.push(`${x.status()} ${new URL(x.url()).pathname}`); } catch {} });
    try {
      await page.goto(pg.url, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => { if (!/Timeout/.test(String(e))) throw e; });
      await page.waitForTimeout(1500); // the page's own freshness script and data fetches
      const info = await page.evaluate(() => ({
        updated: document.querySelector('meta[name="data-updated"]')?.content || null,
        maxAge: document.querySelector('meta[name="data-max-age"]')?.content ?? null,
        links: [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /^https?:/.test(h)),
      }));
      r.links = [...new Set(info.links.map((h) => h.replace(/#.*$/, '')))].filter((u) => !C.skipLinks.some((re) => re.test(u)));
      for (const e of new Set(errs)) r.problems.push({ kind: 'page-error', detail: e });
      for (const f of new Set(failed)) r.problems.push({ kind: 'failed-request', detail: f });
      if (consoleErr.length) r.notes.push(`${consoleErr.length} console error(s), e.g. "${consoleErr[0].slice(0, 100)}"`);
      if (pg.maxAgeMinutes) {
        r.maxAge = pg.maxAgeMinutes;
        if (Number(info.maxAge) !== pg.maxAgeMinutes) r.problems.push({ kind: 'config', detail: `the page declares data-max-age ${info.maxAge ?? 'none'} min; the config says ${pg.maxAgeMinutes}` });
        if (!info.updated || Number.isNaN(Date.parse(info.updated))) r.problems.push({ kind: 'stale', detail: `the page shows no data time (data-updated ${info.updated ? 'unreadable' : 'empty'})` });
        else {
          r.dataUpdated = info.updated; r.ageMin = (Date.now() - Date.parse(info.updated)) / 60000;
          if (r.ageMin < -5) r.problems.push({ kind: 'stale', detail: `the page's data time ${info.updated} is ${ago(-r.ageMin * 60000)} in the future: a clock or time zone is wrong where the data is written` });
          else if (r.ageMin > pg.maxAgeMinutes) r.problems.push({ kind: 'stale', detail: `data last updated ${pt(info.updated)} (${ago(r.ageMin * 60000)} ago, max ${ago(pg.maxAgeMinutes * 60000)})`, since: info.updated });
        }
      }
    } catch (e) { r.problems.push({ kind: 'load', detail: String(e.message || e).split('\n')[0].slice(0, 160) }); }
    await ctx.close();
    return r;
  }

  const dig = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  async function checkService(sv) {
    const r = { url: sv.url, name: sv.name, problems: [], notes: [], links: [] };
    try {
      const res = await fetch(sv.url, { headers: { 'user-agent': C.userAgent, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      r.http = res.status;
      if (!res.ok) { r.problems.push({ kind: 'service', detail: `${sv.say}: HTTP ${res.status}` }); return r; }
      const text = await res.text(); let body;
      try { body = JSON.parse(text); } catch { r.problems.push({ kind: 'service', detail: `${sv.say}: HTTP ${res.status} but not JSON (${(res.headers.get('content-type') || 'no content type').split(';')[0]})` }); return r; }
      const got = dig(body, sv.path);
      if (got !== sv.expect) r.problems.push({ kind: 'service', detail: `${sv.say}: ${sv.path} is ${JSON.stringify(got ?? null)}, not ${JSON.stringify(sv.expect)}${sv.whyPath && dig(body, sv.whyPath) ? ` (${dig(body, sv.whyPath)})` : ''}` });
    } catch (e) { r.http = 0; r.problems.push({ kind: 'service', detail: `${sv.say}: unreachable: ${why(e)}` }); }
    return r;
  }

  async function checkLinks(urls) {
    const out = new Map(); let i = 0;
    const one = async (u) => {
      const tryIt = (method) => fetch(u, { method, redirect: 'follow', headers: { 'user-agent': C.userAgent, accept: 'text/html,*/*' }, signal: AbortSignal.timeout(15000) });
      try {
        let res = await tryIt('HEAD'); if ([400, 403, 404, 405, 501].includes(res.status)) res = await tryIt('GET');
        const s = res.status;
        out.set(u, s < 400 ? { ok: true, status: s } : [401, 403, 429, 999].includes(s) ? { ok: null, status: s } : { ok: false, status: s });
      } catch (e) { out.set(u, { ok: false, status: 0, error: why(e) }); }
    };
    await Promise.all(Array.from({ length: C.linkConcurrency }, async () => { while (i < urls.length) await one(urls[i++]); }));
    return out;
  }

  function runFit(urls) {
    const list = path.join(C.stateDir, 'fit-urls.txt'), out = path.join(C.stateDir, 'fit');
    fs.writeFileSync(list, urls.join('\n') + '\n'); fs.rmSync(out, { recursive: true, force: true });
    const args = ['--quiet', '--widths', C.fit.widths.join(','), '--urls-file', list, '--out', out];
    const [cmd, ...pre] = C.fit.command || ['npx', '--yes', 'github:Beo-Halfhand/fit-check#v0.1.3'];
    const res = spawnSync(cmd, [...pre, ...args], { encoding: 'utf8', timeout: 20 * 60000 });
    try { return JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')).results; }
    catch { return { error: (res.error?.message || res.stderr || res.stdout || 'fit-check did not run').trim().split('\n').pop().slice(0, 200) }; }
  }

  function writeReport(now, results, linkMap, fit, prevRun) {
    const sinceF = path.join(C.stateDir, 'since.json'); let since = {}; try { since = JSON.parse(fs.readFileSync(sinceF, 'utf8')); } catch {}
    const nowSince = {}, keyOf = (u, p) => `${u}|${p.kind}|${p.detail.replace(/\d+(\.\d+)? (min|h|days) ago/g, '').replace(/\(.*?\)/g, '').slice(0, 120)}`;
    const all = [];
    for (const r of results) for (const p of r.problems) { const k = keyOf(r.url, p); nowSince[k] = since[k] || p.since || now.toISOString(); all.push({ url: r.url, name: r.name, ...p, since: nowSince[k] }); }
    const brokenLinks = [...linkMap].filter(([, v]) => v.ok === false), blocked = [...linkMap].filter(([, v]) => v.ok === null);
    const linkSince = {}; for (const [u] of brokenLinks) { const k = 'link|' + u; linkSince[u] = since[k] || now.toISOString(); nowSince[k] = linkSince[u]; }
    if (!partial) fs.writeFileSync(sinceF, JSON.stringify(nowSince, null, 1));
    const fitHits = Array.isArray(fit) ? fit.flatMap((x) => x.hits.map((h) => ({ url: x.url, ...h }))) : [];
    const fitErr = Array.isArray(fit) ? null : fit.error;
    const total = all.length + brokenLinks.length + fitHits.length + (fitErr ? 1 : 0);
    const status = total ? 'problems' : 'all-fresh';
    const kinds = [...new Set([...all.map((p) => p.kind), ...(brokenLinks.length ? ['broken-link'] : []), ...(fitHits.length || fitErr ? ['fit'] : [])])];
    const L = ['---', partial ? 'type: page-watch-partial' : 'type: page-watch', `${partial ? 'checked_at' : 'ran_at'}: ${now.toISOString()}`, `status: ${status}`, `updated: ${day(now)}`,
      `summary: "${total ? `${total} problem(s): ${kinds.join(', ')}` : `all fresh: ${results.length} checked`}"`, '---', '',
      `# Page watch, ${day(now)}`, '',
      partial ? `**Partial run at ${pt(now)} (${partialWhy.join(', ')}).** Not the scheduled report: latest.md, the daily file and the "since" times are unchanged.` : `**Ran at ${pt(now)}.** **If this line is more than ${C.staleH} h old, page-watch has stopped running.**`, ''];
    if (prevRun && now - prevRun > C.staleH * 3600e3) L.push(`⚠ The run before this one was ${ago(now - prevRun)} earlier (${pt(prevRun)}): page-watch missed at least one run.`, '');
    const checked = [has('--no-cards') ? null : 'link cards', has('--no-links') ? null : `links (${linkMap.size})`, fitOn ? `fit at ${C.fit.widths.join(' and ')} px` : null].filter(Boolean);
    if (!total) L.push('## ✅ All fresh', '', `${results.length} checked: every live-data page is within its max age, every page loads (HTTP < 400, no page errors), every service reads as expected${checked.length ? `, and no problems in ${checked.join(', ')}` : ''}.`, '');
    else {
      L.push(`## ⚠ ${total} problem(s)`, '');
      const byPage = new Map(); for (const p of all) { if (!byPage.has(p.url)) byPage.set(p.url, []); byPage.get(p.url).push(p); }
      for (const [u, ps] of byPage) { L.push(`**${ps[0].name}** (${u})`); for (const p of ps) L.push(`- **${p.kind}:** ${p.detail} · since ${pt(p.since)}`); L.push(''); }
      if (brokenLinks.length) { L.push('**Broken links**'); for (const [u, v] of brokenLinks) { const on = results.filter((r) => r.links.includes(u)).map((r) => r.name); L.push(`- ${u}: ${v.status || v.error} · on ${on.slice(0, 4).join(', ')}${on.length > 4 ? ' …' : ''} · since ${pt(linkSince[u])}`); } L.push(''); }
      if (fitHits.length) { L.push('**Fit (fit-check)**'); for (const h of fitHits) L.push(`- ${h.url}: ${h.kind} at ${h.widths.join(', ')} px: \`${h.selector.slice(0, 90)}\` "${String(h.text).slice(0, 60)}"`); L.push(''); }
      if (fitErr) L.push(`**fit-check did not run:** ${fitErr}`, '');
    }
    L.push('## Every page', '', '| Page | HTTP | Data | Problems |', '|---|---|---|---|');
    for (const r of results) {
      const data = r.maxAge ? (r.dataUpdated ? (r.ageMin < -5 ? `in the future (${ago(-r.ageMin * 60000)})` : `updated ${ago(Math.max(0, r.ageMin) * 60000)} ago (max ${ago(r.maxAge * 60000)})`) : 'no data time') : r.service ? 'service' : 'static';
      const n = r.problems.length + fitHits.filter((h) => h.url === r.url).length + brokenLinks.filter(([u]) => r.links.includes(u)).length;
      L.push(`| [${r.name.replace(/\|/g, '/')}](${r.url}) | ${r.http || '—'} | ${data} | ${n ? '⚠ ' + n : '✓'} |`);
    }
    L.push('', `Links: ${linkMap.size} checked, ${brokenLinks.length} broken, ${blocked.length} couldn't be verified (the site answered 401, 403 or 429 to a bot: ${[...new Set(blocked.map(([u]) => new URL(u).host))].join(', ') || 'none'}).`);
    const notes = results.filter((r) => r.notes.length); if (notes.length) { L.push('', 'Notes (not counted as problems):'); for (const r of notes) for (const n of r.notes) L.push(`- ${r.name}: ${n}`); }
    L.push('', '---', '', `page-watch ${VERSION}. Config: \`${path.basename(C.file)}\`. Browser: ${browserUsed}.${C.footer ? ' ' + C.footer : ''}`, '');
    const md = L.join('\n');
    fs.mkdirSync(C.reportDir, { recursive: true });
    if (partial) fs.writeFileSync(path.join(C.reportDir, 'partial.md'), md);
    else { fs.writeFileSync(path.join(C.reportDir, `${day(now)}.md`), md); fs.writeFileSync(latest, md); }
    return { status, total, md };
  }

  const fitOn = C.fit.enabled && !has('--no-fit');
  // A run that leaves something out (--only, --no-links, --no-cards, or --no-fit with fit on) is for setting up and debugging.
  // It writes partial.md only: latest.md, the dated file, ran_at and since.json stay as the last full run left them.
  const partialWhy = [only ? `--only ${only}` : null, has('--no-links') ? '--no-links' : null, has('--no-cards') ? '--no-cards' : null, C.fit.enabled && has('--no-fit') ? '--no-fit' : null].filter(Boolean);
  const partial = partialWhy.length > 0;
  async function fullRun() {
    const now = new Date(), prevRun = lastRun();
    fs.mkdirSync(C.stateDir, { recursive: true });
    const pages = C.pages.filter((p) => !only || p.url.includes(only));
    const results = [];
    if (pages.length) {
      const browser = await launchBrowser();
      let i = 0;
      try { await Promise.all(Array.from({ length: 3 }, async () => { while (i < pages.length) { const pg = pages[i++]; const r = await checkPage(browser, pg); results.push(r); log(`${r.problems.length ? '⚠' : '✓'} ${pg.url} (${r.problems.length} problem(s))`); } })); }
      finally { await browser.close(); }
    }
    results.sort((a, b) => pages.findIndex((p) => p.url === a.url) - pages.findIndex((p) => p.url === b.url));
    for (const sv of C.services.filter((x) => !only || x.url.includes(only))) { const r = await checkService(sv); r.service = true; results.push(r); log(`${r.problems.length ? '⚠' : '✓'} service ${sv.name}`); }
    const linkMap = has('--no-links') ? new Map() : await checkLinks([...new Set(results.flatMap((r) => r.links))]);
    log(`links: ${linkMap.size} checked`);
    const fit = fitOn && pages.length ? runFit(pages.map((p) => p.url)) : [];
    const rep = writeReport(now, results, linkMap, fit, prevRun);
    log(`done: ${rep.status}, ${rep.total} problem(s); wrote ${partial ? path.join(C.reportDir, 'partial.md') + ' (partial run)' : latest}`);
    if (has('--print')) process.stdout.write('\n' + rep.md);
    return rep.total ? 1 : 0;
  }

  try {
    if (has('--self-check')) return selfCheck();
    if (has('--auto')) { const prev = lastRun(); return prev && Date.now() - prev < C.autoH * 3600e3 ? selfCheck() : await fullRun(); }
    return await fullRun();
  } catch (e) { return writeFailed(e); }
}

function newestHeadlessShell() {
  for (const root of [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), 'Library/Caches/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright')].filter(Boolean)) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root).filter((d) => /^chromium_headless_shell-\d+$/.test(d)).sort((a, b) => Number(b.split('-').pop()) - Number(a.split('-').pop()));
    for (const d of dirs) for (const rel of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell', 'chrome-headless-shell-linux64/chrome-headless-shell']) { const p = path.join(root, d, rel); if (fs.existsSync(p)) return p; }
  }
  return null;
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) main().then((code) => { process.exitCode = code; });
