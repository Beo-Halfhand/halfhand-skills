// config.mjs: reads and checks fleet.json. One file says who the agents are and how to read each one.
// Paths may start with ~/ ; relative paths are taken from the config file's folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseJob, parseLastDid } from './jobs.mjs';

export const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];

export function expand(p, base) {
  if (typeof p !== 'string' || !p) return null;
  if (p === '~' || p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return path.isAbsolute(p) ? p : path.resolve(base, p);
}

// Returns { config, errors }. errors is a list of plain sentences; an empty list means the config is usable.
export function parseConfig(raw, file, adapters) {
  const errors = [];
  const base = path.dirname(path.resolve(file ?? '.'));
  const c = raw && typeof raw === 'object' ? raw : {};
  if (!raw || typeof raw !== 'object') errors.push('the config must be a JSON object');

  const num = (v, d, lo, hi, name) => {
    if (v === undefined) return d;
    if (!Number.isFinite(v) || v < lo || v > hi) { errors.push(`${name} must be a number from ${lo} to ${hi}`); return d; }
    return v;
  };
  const out = {
    title: typeof c.title === 'string' && c.title.trim() ? c.title.trim().slice(0, 60) : 'Fleet dashboard',
    port: num(c.port, 7700, 1024, 65535, 'port'),
    dataDir: expand(c.dataDir ?? './fleet-data', base),
    sampleMinutes: num(c.sampleMinutes, 5, 1, 60, 'sampleMinutes'),
    keepDays: num(c.keepDays, 7, 1, 90, 'keepDays'),
    asksDir: c.asksDir ? expand(c.asksDir, base) : null,
    jobsFile: c.jobsFile ? expand(c.jobsFile, base) : null,
    timeZone: typeof c.timeZone === 'string' && c.timeZone ? c.timeZone : null,
    skillColors: {},
    access: { hosts: [], loginHeader: null, allowLogins: [] },
    showLog: c.showLog !== false,
    agents: [],
  };
  if (out.timeZone) { try { new Intl.DateTimeFormat('en-US', { timeZone: out.timeZone }); } catch { errors.push(`timeZone "${out.timeZone}" is not a time zone name (try "America/New_York")`); out.timeZone = null; } }
  for (const [k, v] of Object.entries(c.skillColors ?? {})) {
    if (/^[a-z0-9_ -]{1,40}$/i.test(k) && /^#[0-9a-f]{6}$/i.test(String(v))) out.skillColors[k] = String(v);
    else errors.push(`skillColors.${k} must be a colour like "#3987e5"`);
  }
  const acc = c.access ?? {};
  if (acc.hosts !== undefined) {
    if (!Array.isArray(acc.hosts) || acc.hosts.some((h) => typeof h !== 'string' || !/^[a-z0-9.-]{1,253}(:\d{1,5})?$/i.test(h))) errors.push('access.hosts must be a list of host names, like ["deck.example.com"]');
    else out.access.hosts = acc.hosts.map((h) => h.toLowerCase()).filter((h) => !LOOPBACK.includes(h.split(':')[0]));
  }
  if (acc.loginHeader !== undefined) {
    if (typeof acc.loginHeader !== 'string' || !/^[a-z0-9-]{1,60}$/i.test(acc.loginHeader)) errors.push('access.loginHeader must be a header name, like "x-user-login"');
    else out.access.loginHeader = acc.loginHeader.toLowerCase();
  }
  if (acc.allowLogins !== undefined) {
    if (!Array.isArray(acc.allowLogins) || acc.allowLogins.some((x) => typeof x !== 'string' || !x)) errors.push('access.allowLogins must be a list of login names');
    else out.access.allowLogins = acc.allowLogins.map((x) => x.toLowerCase());
  }
  if (out.access.hosts.length && (!out.access.loginHeader || !out.access.allowLogins.length)) {
    errors.push('access.hosts is set, so access.loginHeader and access.allowLogins must be set too (who may open the dashboard through that host)');
  }

  if (!Array.isArray(c.agents) || !c.agents.length) errors.push('agents must be a list with at least one agent');
  const seen = new Set();
  for (const [i, a] of (Array.isArray(c.agents) ? c.agents : []).entries()) {
    const at = `agents[${i}]`;
    if (!a || typeof a !== 'object') { errors.push(`${at} must be an object`); continue; }
    const key = String(a.key ?? '').toLowerCase();
    if (!KEY_RE.test(key)) { errors.push(`${at}.key must be 1 to 40 lowercase letters, digits, - or _ (it goes in URLs and file names)`); continue; }
    if (seen.has(key)) { errors.push(`${at}.key "${key}" is used twice`); continue; }
    seen.add(key);
    const name = typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 40) : key;
    const adapterName = String(a.adapter ?? '');
    const adapter = adapters[adapterName];
    if (!adapter) { errors.push(`${at} (${key}): adapter "${adapterName}" is not one of ${Object.keys(adapters).join(', ')}`); continue; }
    const agent = {
      key, name, adapter: adapterName, main: a.main === true,
      log: a.log ? expand(a.log, base) : null,
      pauseFile: a.pauseFile ? expand(a.pauseFile, base) : null,
      staleMinutes: num(a.staleMinutes, 30, 1, 7 * 24 * 60, `${at}.staleMinutes`),
      warnPattern: null, logCounters: {}, links: [],
      job: null, lastDid: [],
      retired: a.retired === true || (typeof a.retired === 'string' && a.retired.trim() && !/^\s*(false|no|0|off)\s*$/i.test(a.retired)) ? (a.retired === true ? true : a.retired.trim().slice(0, 160)) : false,
      retiredFile: a.retiredFile ? expand(a.retiredFile, base) : null,
      opts: a[adapterName] && typeof a[adapterName] === 'object' ? a[adapterName] : {},
      base,
    };
    if (a.warnPattern !== undefined) { try { agent.warnPattern = new RegExp(String(a.warnPattern)); } catch { errors.push(`${at}.warnPattern is not a valid regular expression`); } }
    for (const [k, re] of Object.entries(a.logCounters ?? {})) {
      if (!/^[a-z][a-z0-9_]{0,30}$/i.test(k)) { errors.push(`${at}.logCounters: "${k}" must be a short name`); continue; }
      try { const r = new RegExp(String(re)); if (!/\((?!\?)/.test(String(re))) throw new Error('no group'); agent.logCounters[k] = r; }
      catch { errors.push(`${at}.logCounters.${k} must be a regular expression with one (group) around the number`); }
    }
    if (a.retired !== undefined && ((typeof a.retired !== 'boolean' && typeof a.retired !== 'string') || (typeof a.retired === 'string' && /^\s*(false|no|0|off)\s*$/i.test(a.retired)))) errors.push(`${at}.retired must be true, false or a short note (write false without quotes)`);
    { const j = parseJob(a.job, `${at}.job`); agent.job = j.job; errors.push(...j.errors); }
    { const l = parseLastDid(a.lastDid, `${at}.lastDid`); agent.lastDid = l.rules; errors.push(...l.errors); }
    for (const l of Array.isArray(a.links) ? a.links : []) {
      if (l && typeof l.label === 'string' && /^https:\/\//.test(String(l.url))) agent.links.push({ label: l.label.slice(0, 30), url: String(l.url) });
      else errors.push(`${at}.links: each link needs a label and an https:// url`);
    }
    for (const e of adapter.check?.(agent) ?? []) errors.push(`${at} (${key}): ${e}`);
    out.agents.push(agent);
  }
  if (out.agents.filter((a) => a.main).length > 1) errors.push('only one agent can be "main": true');
  const kinds = new Set(out.agents.map((a) => a.adapter));
  if (kinds.has('fake') && kinds.size > 1) errors.push('the "fake" adapter can\'t be mixed with real agents (its numbers would sit next to real ones)');
  return { config: out, errors };
}

export function loadConfig(file, adapters) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return { config: null, errors: [e.code === 'ENOENT' ? `no config at ${file}` : `${file} is not valid JSON (${e.message})`] }; }
  return parseConfig(raw, file, adapters);
}
