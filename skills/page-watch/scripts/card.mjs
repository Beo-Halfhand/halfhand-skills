// card.mjs: the link card check. A page you hand out as a link should have its own card (the picture and title X, Discord,
// Slack and others show), and og:image and twitter:image should be the same file. The page is read the way two crawlers read it
// (Twitterbot and Discordbot user agents, no scripts). A problem when:
//   - the page has no card: og:title, og:description, og:image or twitter:image missing, or twitter:card isn't summary_large_image
//   - twitter:title or twitter:description is missing (all missing tags are one problem)
//   - og:image or twitter:image is a relative address (crawlers need the full https:// address)
//   - og:image and twitter:image name different files
//   - the image doesn't load for a crawler: not 200, redirected, not image/jpeg or image/png, 5 MB or more, marked noindex,
//     or not a readable picture of at least 300×157
// Notes only (not problems): no ?v= on the image address (crawlers keep the old picture), no og:url, and a <link rel="canonical">
// (X files the card under the canonical address, so posting the link with ?v=3 can't show a new card).
// A fetch with a crawler's user agent proves the tags, not that the crawler's own servers get through your firewall or CDN.
// Turn the check off for a page with "linkCard": false, or for a run with --no-cards.
export const CRAWLERS = { X: 'Twitterbot/1.0', Discord: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' };
const MAX_BYTES = 5 * 1024 * 1024;

export function readCard(html) {
  const get = (attr, name) => {
    const tag = html.match(new RegExp(`<meta[^>]*\\b${attr}=["']${name}["'][^>]*>`, 'i'))?.[0];
    if (!tag) return null;
    const c = tag.match(/\bcontent="([^"]*)"/i) || tag.match(/\bcontent='([^']*)'/i);
    return c ? c[1].replace(/&amp;/g, '&') : null;
  };
  return { title: get('property', 'og:title'), description: get('property', 'og:description'), image: get('property', 'og:image'), url: get('property', 'og:url'),
    card: get('name', 'twitter:card'), twitterImage: get('name', 'twitter:image'), twitterTitle: get('name', 'twitter:title'), twitterDescription: get('name', 'twitter:description'),
    canonical: html.match(/<link[^>]*\brel=["']canonical["'][^>]*>/i)?.[0].match(/\bhref=["']([^"']*)["']/i)?.[1] ?? null };
}

/** What is wrong with a page's tags, before any image is fetched. */
export function judgeCard(c) {
  const problems = [], notes = [];
  // one line for everything missing, so a page with no card is one problem, not four
  const missing = [['og:title', c.title], ['og:description', c.description], ['og:image', c.image], ['twitter:image', c.twitterImage], ['twitter:card', c.card], ['twitter:title', c.twitterTitle], ['twitter:description', c.twitterDescription]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) problems.push(`${missing.includes('og:image') || missing.includes('twitter:image') || missing.includes('og:title') ? 'no link card' : 'link card incomplete'}: ${missing.join(', ')} missing${missing.includes('twitter:title') || missing.includes('twitter:description') ? ' (X may show no card without twitter:title and twitter:description)' : ''}`);
  if (c.card && c.card !== 'summary_large_image') problems.push(`small or no picture: twitter:card is "${c.card}", not "summary_large_image"`);
  if (c.image && c.twitterImage && c.image !== c.twitterImage) problems.push(`og:image and twitter:image differ (${c.image} vs ${c.twitterImage}): X and Discord show different pictures`);
  for (const [k, v] of [['og:image', c.image], ['twitter:image', c.twitterImage]]) if (v && !/^https?:\/\//i.test(v)) { problems.push(`${k} is a relative address (${v}): crawlers need the full https:// address`); break; }
  if (c.image && !/[?&]v=[\w-]+/.test(c.image)) notes.push('link card image has no ?v= version: crawlers may keep an old picture');
  if (!c.url) notes.push('no og:url');
  if (c.canonical) notes.push(`rel=canonical (${c.canonical}): X files the card under that address, so a ?v= link can't refresh it`);
  return { problems, notes };
}

/** Width and height from a PNG or JPEG's header, or null if the bytes aren't a picture of that type. */
export function imageSize(buf, type) {
  const b = Buffer.from(buf);
  if (type === 'image/png') {
    if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    return w && h ? { w, h } : null;
  }
  if (type === 'image/jpeg') {
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) { const h = b.readUInt16BE(i + 5), w = b.readUInt16BE(i + 7); return w && h ? { w, h } : null; }
      i += 2 + len;
    }
    return null;
  }
  return null;
}

async function loadImage(u, ua) {
  const res = await fetch(u, { redirect: 'manual', headers: { 'user-agent': ua }, signal: AbortSignal.timeout(20000) });
  if (res.status >= 300 && res.status < 400) return `redirects (${res.status}) to ${res.headers.get('location')}`;
  if (res.status !== 200) return `HTTP ${res.status}`;
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!['image/jpeg', 'image/png'].includes(type)) return `is ${type || 'no content type'}, not image/jpeg or image/png`;
  if (/noindex|noimageindex|none/i.test(res.headers.get('x-robots-tag') || '')) return `is marked x-robots-tag: ${res.headers.get('x-robots-tag')}`;
  const buf = await res.arrayBuffer(), bytes = buf.byteLength;
  if (bytes >= MAX_BYTES) return `is ${(bytes / 1048576).toFixed(1)} MB (5 MB or more)`;
  if (bytes < 1000) return `is only ${bytes} bytes`;
  const size = imageSize(buf, type);
  if (!size) return `isn't a readable ${type === 'image/png' ? 'PNG' : 'JPEG'} (its header has no picture size)`;
  if (size.w < 300 || size.h < 157) return `is ${size.w}×${size.h}: too small for a large card (300×157 at least; 1200×630 is usual)`;
  return null;
}

/** The link card problems and notes for one page URL, as { problems: [{kind, detail}], notes: [string] }. */
export async function checkCard(pageUrl) {
  const problems = new Set(), notes = new Set();
  for (const [who, ua] of Object.entries(CRAWLERS)) {
    let html;
    try {
      const res = await fetch(pageUrl, { redirect: 'follow', headers: { 'user-agent': ua }, signal: AbortSignal.timeout(20000) });
      if (res.status !== 200) { problems.add(`${who}'s crawler gets HTTP ${res.status} for the page`); continue; }
      html = await res.text();
    } catch (e) { problems.add(`${who}'s crawler can't reach the page: ${e.cause?.code || e.message}`); continue; }
    const c = readCard(html), j = judgeCard(c);
    for (const p of j.problems) problems.add(p);
    for (const n of j.notes) notes.add(n);
    for (const img of new Set([c.image, c.twitterImage].filter(Boolean))) {
      let bad;
      try { bad = await loadImage(new URL(img, pageUrl).href, ua); } catch (e) { bad = `can't be reached: ${e.cause?.code || e.message}`; }
      if (bad) problems.add(`link card image doesn't load: ${img} ${bad}`);
    }
  }
  return { problems: [...problems].map((detail) => ({ kind: 'link-card', detail })), notes: [...notes] };
}
