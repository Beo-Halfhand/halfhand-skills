// fleet-dashboard: helpers every page uses. Text always goes in through textContent (never innerHTML).
'use strict';
window.fd = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
    for (const c of kids.flat()) if (c !== null && c !== undefined) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const compact = (n) => { const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M' : a >= 1e4 ? Math.round(n / 1e3) + 'K' : a >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : fmt(Math.round(n)); };
  const nice = (v) => String(v ?? '').replace(/[_-]+/g, ' ').trim();
  let TZ;   // the config's timeZone, or the browser's own
  const setZone = (z) => { TZ = z || undefined; };
  const clock = (t) => new Date(t).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const hourLabel = (t) => new Date(t).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric' });
  const zoneName = () => new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? '';
  const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`; };

  // Sigils: one generated icon per agent, the same style for all (5×5 mirrored pixels). Seeded by the key, so it
  // stays put when a display name changes. The main agent's pixels are brass.
  const sigCache = new Map();
  function sigPath(key) {
    if (sigCache.has(key)) return sigCache.get(key);
    let salt = 0, bits = 0;
    for (;;) {
      let x = 0x811c9dc5; for (const ch of key + '#' + salt) { x ^= ch.charCodeAt(0); x = Math.imul(x, 0x01000193) >>> 0; }
      x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995) >>> 0; x ^= x >>> 15;
      bits = x & 0x7fff; let n = 0; for (let b = bits; b; b >>= 1) n += b & 1;
      if ((n >= 6 && n <= 10 && (bits & 0b11111) && (bits & (0b11111 << 10))) || salt > 40) break;   // not too sparse, not a block, uses both edges
      salt++;
    }
    let d = '';
    for (let col = 0; col < 3; col++) for (let row = 0; row < 5; row++) if (bits & (1 << (col * 5 + row))) for (const c of new Set([col, 4 - col])) d += `M${c + 1} ${row + 1}h1v1h-1z`;
    sigCache.set(key, d); return d;
  }
  const sigil = (a, size) => s('svg', { class: 'sig' + (a.main ? ' main' : ''), viewBox: '0 0 7 7', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' },
    s('rect', { class: 'sig-bg', x: 0, y: 0, width: 7, height: 7, rx: 1.6 }), s('path', { class: 'sig-px', d: sigPath(a.key) }));

  // skill colours come from the server (one colour per skill everywhere); unknown skills share "other"
  let SK = { colors: {}, order: [], other: '#6e6680' };
  const setSkills = (x) => { if (x?.colors) SK = x; };
  const colorOf = (k) => SK.colors[k] ?? SK.other;
  const rank = (k) => { const i = SK.order.indexOf(k); return i < 0 ? SK.order.length : i; };
  const swatch = (k) => { const i = h('i', { class: 'sw', 'aria-hidden': 'true' }); i.style.background = colorOf(k); return i; };

  async function getJSON(url) { const r = await fetch(url, { headers: { 'X-Deck': '1' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Deck': '1' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j;
  }
  // the one fleet read every page shares: every 15 s, and right away when the tab comes back
  function poll(onData, onError) {
    let timer = null;
    const go = async () => { clearTimeout(timer); try { onData(await getJSON('/api/fleet')); } catch (e) { onError?.(e); } timer = setTimeout(go, 15_000); };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) go(); });
    go(); return go;
  }
  const $ = (id) => document.getElementById(id);
  return { h, s, fmt, compact, nice, clock, hourLabel, zoneName, ago, setZone, sigil, setSkills, colorOf, rank, swatch, getJSON, post, poll, $ };
})();
