#!/usr/bin/env node
// honest-agent-guards: checks a talking agent runs on every line before it sends it. Zero dependencies, Node 20+.
// Two kinds of check, one loop around them:
//   1. The banned list (a markdown file you edit): claims no agent may make, and place names that must be on your map.
//   2. The agent's own state: a level or a piece of gear it claims must match what it really has, and it may only say
//      it does what it really does (no invented crafting, trading, owning, other skills or weather).
//   guard(): one redraft with the reason, then drop the bad sentences, else skip. A line is never sent unchecked.
//
//   node guards.mjs check "<line>" [--list list.md] [--state state.json] [--them "<their message>"]
//   node guards.mjs scan <file> [--list list.md] [--state state.json]    one line per line of text, or JSONL with "text"
//   node guards.mjs list [--list list.md]                                 parse your list and show what it holds
// Library: import { checkLine, tell, guard, dropBad, loadList, scan } from './guards.mjs'
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = '0.1.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXAMPLE_LIST = path.join(HERE, 'example-list.md');

// ── the list ────────────────────────────────────────────────────────────────
// ## Claims      - [B01] all: `re` + `re` — tell: … — source: …     (all regexes match one sentence)
//                - [S01] any: `re` unless: `re` echo: `re` — tell: …  (unless: the sentence passes; echo: they said it first)
// ## Places not on the map   - [P01] Central Bank — say: the merchants in Central — source: …
// ## Map                     - <group>: Name, Name, …
// Put "off" after the ID to keep a line but switch it off.
const ticks = (s) => [...String(s ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
function re(src, errors, id) { try { return new RegExp(src, 'i'); } catch (e) { errors.push(`${id}: bad regex (${String(e.message).slice(0, 60)})`); return null; } }
export const normName = (s) => String(s ?? '').toLowerCase().replace(/['’]s\b/g, 's').replace(/['’]/g, '').replace(/[^a-z0-9& ]+/g, ' ').trim().split(/\s+/).filter((w) => w && w !== 'the').map((w) => w.replace(/s$/, ''));
export function parseList(md) {   // pure → { claims, places, map, errors }
  const claims = [], places = [], map = [], errors = [];
  let sec = '';
  for (const raw of String(md ?? '').split('\n')) {
    const line = raw.trim();
    if (/^##\s/.test(line)) { sec = /claim/i.test(line) ? 'claims' : /not on/i.test(line) ? 'places' : /\bmap\b/i.test(line) ? 'map' : ''; continue; }
    if (!line.startsWith('- ')) continue;
    if (sec === 'claims') {
      const m = /^- \[([A-Z]\d+[a-z]?)\]\s+(off\s+)?(all|any):\s+(.*?)\s+—\s+tell:\s+(.*?)(?:\s+—\s+source:\s+(.*))?$/.exec(line);
      if (!m) { errors.push(`unparsed claim line (want "- [B01] any: \`regex\` — tell: …"): ${line.slice(0, 60)}`); continue; }
      const [, id, off, kind, body, tellText, source] = m;
      const uIdx = body.search(/\s(?:unless|echo):\s/);
      const main = uIdx >= 0 ? body.slice(0, uIdx) : body, rest = uIdx >= 0 ? body.slice(uIdx) : '';
      const all = ticks(main).map((s) => re(s, errors, id));
      const unless = ticks((/unless:\s+(`[^`]+`)/.exec(rest) ?? [])[1]).map((s) => re(s, errors, id))[0] ?? null;
      const echo = ticks((/echo:\s+(`[^`]+`)/.exec(rest) ?? [])[1]).map((s) => re(s, errors, id))[0] ?? null;
      if (!all.length || all.some((x) => !x)) { errors.push(`${id}: no usable regex`); continue; }
      if (kind === 'any' && all.length > 1) errors.push(`${id}: "any:" takes one regex; the first is used`);
      if (claims.some((c) => c.id === id)) errors.push(`${id}: used twice; the first one counts`);
      else claims.push({ id, on: !off, all: kind === 'any' ? [all[0]] : all, unless, echo, tell: tellText.trim(), source: (source ?? '').trim() });
    } else if (sec === 'places') {
      const m = /^- \[(P\d+[a-z]?)\]\s+(off\s+)?(.+?)\s+—\s+say:\s+(.*?)(?:\s+—\s+source:\s+(.*))?$/.exec(line);
      if (!m) { if (/^- \[/.test(line)) errors.push(`unparsed place line: ${line.slice(0, 60)}`); continue; }
      places.push({ id: m[1], on: !m[2], name: m[3].trim(), key: normName(m[3]).join(' '), say: m[4].trim() });
    } else if (sec === 'map') {
      const m = /^- [^:]+:\s+(.*)$/.exec(line);
      if (m) for (const n of m[1].split(/,\s+/)) if (n.trim()) map.push(n.trim());
    }
  }
  return { claims, places, map, errors };
}
// The map's lookup keys and lead words, added once to any list (one from parseList() works as well as one from loadList()).
export function prepare(list) {
  if (!list.mapKeys) {
    list.mapKeys = (list.map ?? []).map((n) => normName(n));
    list.leads = [...new Set((list.map ?? []).filter((n) => n.split(/\s+/).length > 1).map((n) => n.split(/\s+/)[0]).filter((w) => /^[A-Z]/.test(w)))];
  }
  return list;
}
const cache = new Map();   // file → list
// Your list, re-read when its modified time changes (edit it while the agent runs). A list that can't be read, or has no
// claims, falls back to the example list shipped next to this file, and says so in its tag.
export function loadList(file = process.env.GUARDS_LIST || EXAMPLE_LIST) {
  let mtime = -1; try { mtime = fs.statSync(file).mtimeMs; } catch { /* missing */ }
  const c = cache.get(file); if (c && c.mtime === mtime) return c;
  let parsed = null, source = file === EXAMPLE_LIST ? 'example' : 'your list';
  if (mtime >= 0) { try { parsed = parseList(fs.readFileSync(file, 'utf8')); } catch { parsed = null; } }
  if (!parsed || !parsed.claims.length) {
    const why = mtime < 0 ? 'not found' : parsed ? 'no claims in it' : 'unreadable';
    try { parsed = parseList(fs.readFileSync(EXAMPLE_LIST, 'utf8')); source = file === EXAMPLE_LIST ? 'example' : `example (your list: ${why})`; }
    catch { parsed = { claims: [], places: [], map: [], errors: ['no list: neither file could be read'] }; source = 'none'; }
  }
  const L = prepare({ file, mtime, ...parsed, source,
    tag: `${source} · ${parsed.claims.filter((x) => x.on).length} claims · ${parsed.places.filter((p) => p.on).length} places · map ${parsed.map.length}${parsed.errors.length ? ` · ${parsed.errors.length} errors` : ''}` });
  cache.set(file, L); return L;
}

// ── sentences and clauses ───────────────────────────────────────────────────
export const sentencesOf = (t) => String(t ?? '').split(/(?<!\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr)\.)(?<=[.!?])\s+/).filter(Boolean);
const clausesOf = (sen) => String(sen ?? '').split(/,\s+|;\s+|\s+(?:and|but|so|while|though|because)\s+/i).filter(Boolean);
const FIRST = /\b(I|I'm|I’m|I've|I’ve|I'll|I’ll|I'd|I’d|[Mm]y|[Mm]e|[Mm]ine|[Mm]yself)\b/;   // "My axe…" at the start of a sentence is first person too
const SECOND = /\b(you|your|you're|you’re|you've|you’ve|yours|yourself)\b/i;
const OTHER_SUBJ = /\b(he|she|they|he's|she's|they're|his|her|their|we|our)\b/i;

// ── listed claims ───────────────────────────────────────────────────────────
export function claimWhy(text, { list = loadList(), them = '' } = {}) {   // → 'banned:<ID>' | null
  const th = String(them ?? '');
  for (const sen of sentencesOf(text)) for (const c of list.claims) {
    if (!c.on || !c.all.every((r) => r.test(sen))) continue;
    if (c.unless && c.unless.test(sen)) continue;
    if (c.echo && c.echo.test(th)) continue;
    return `banned:${c.id}`;
  }
  return null;
}

// ── places ──────────────────────────────────────────────────────────────────
// A capitalized, place-shaped phrase ("the Glow Market", "Central Bank") must be on your map, unless they said it first.
const SUFFIX = 'Forge|Market|Bazaar|Square|District|Exchange|Guild|Hall|Tavern|Docks?|Harbou?r|Quarter|Tower|Mines?|Foundry|Smithy|Workshops?|Plaza|House|Caves?|Caverns?|Bank|Arena|Gardens?|Yard|Station|Depot|Outpost|Vault|Bridge|Port|Wharf|Pier|Mill|Refinery|Lab|Laboratory|Clinic|Shop|Store|Outlet|Vendor|Merchant|Broker|Terminals?|Hub|Center|Centre|Corner|Row|Street|Avenue|Alley|Lane|Ruins|Wilds|Valley|Fields|Ranch|Park|Bar|Club|Kitchen|Recycler|Farm|Plot|Workbench|Generator|Pit|Pool|Reef|Grove|Terrace|Cellar|Weir|Fen|Crater|Junction|Counter|Stall|Booth';
const CAP = "[A-Z][A-Za-z0-9'’&-]*";
const PLACE_RE2 = new RegExp(`\\b(?:${CAP}\\s+){1,3}(?:${SUFFIX})\\b`, 'g');
const SUFFIX_RE = new RegExp(`^(?:${SUFFIX})$`, 'i');
const SKIP_LEAD = /^(?:The|A|An|At|In|On|To|From|By|Near|Inside|Outside|Around|Past|Into|Over|Of|For|With|And|Or|But|So|Try|Head|Check|Hit|Visit|Use|Sell|Buy|Go|Stop|Swing|I|I'm|I’m|I've|My|Your|Their|His|Her|Its|Our|This|That|These|Those|Every|Each|Some|Any|Most|Just|Even|Only|Also|Then|Now|Today|Lately|Mostly|Still|Yes|No|Nice|Good|Great|Fair|True|Sure|Hey|Hi|Hello|Thanks|Well|Honestly|Yeah|Maybe|If|When|While|Where|Once|Since|After|Before|Until|Unless|Though|Although|Because|Plenty|Lots)$/;
const contiguous = (cand, name) => { if (cand.length > name.length) return false; for (let i = 0; i + cand.length <= name.length; i++) if (cand.every((w, k) => w === name[i + k])) return true; return false; };
const onMap = (words, mapKeys) => words.length > 0 && mapKeys.some((n) => contiguous(words, n));
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function placeCandidates(text, leads = []) {   // pure: capitalized place-shaped phrases, leading filler words dropped
  const s = String(text ?? ''), out = [];
  const R = [PLACE_RE2]; if (leads.length) R.unshift(new RegExp(`\\b(?:${leads.map(escRe).join('|')})(?:\\s+${CAP}){1,3}`, 'g'));
  for (const r of R) for (const m of s.matchAll(r)) {
    let words = m[0].split(/\s+/);
    while (words.length && SKIP_LEAD.test(words[0])) words = words.slice(1);
    if (words.length >= 2) out.push(words.join(' '));
  }
  return [...new Set(out)];
}
export function placeWhy(text, { list = loadList(), them = '', name = '' } = {}) {   // → 'banned:<P-id>' | 'banned:place:<Name>' | null
  prepare(list);
  const t = String(text ?? ''), th = `${them ?? ''} ${name ?? ''}`.toLowerCase();
  for (const p of list.places) if (p.on && p.key && new RegExp(`\\b${p.key.split(' ').map((w) => `${escRe(w)}s?`).join('\\s+')}\\b`, 'i').test(t.replace(/['’]/g, ''))) return `banned:${p.id}`;
  if (!list.mapKeys.length) return null;   // no map: only the listed places are checked
  for (const c of placeCandidates(t, list.leads)) {
    if (th.includes(c.toLowerCase())) continue;   // they named it first
    if (new RegExp(`(?:,\\s+|^|\\b(?:hey|hi|hello|thanks|thank you|bye|see you|good luck)\\s+)${escRe(c)}\\s*(?:[.!?,]|$)`, 'i').test(t)) continue;   // "…, Crypto Prophets." is a name, not a place
    let w = normName(c);
    if (onMap(w, list.mapKeys)) continue;
    while (w.length > 1 && !SUFFIX_RE.test(c.split(/\s+/)[w.length - 1] ?? '')) { w = w.slice(0, -1); if (onMap(w, list.mapKeys)) break; }   // "Central Plaza Mo" → "Central Plaza"
    if (w.length > 1 && onMap(w, list.mapKeys) && !SUFFIX_RE.test(c.split(/\s+/).pop())) continue;
    if (list.places.some((p) => !p.on && p.key === normName(c).join(' '))) continue;   // a listed place switched off: allowed
    return `banned:place:${c}`;
  }
  return null;
}
export const bannedWhy = (text, o = {}) => claimWhy(text, o) ?? placeWhy(text, o);

// ── the agent's own state: levels and gear ──────────────────────────────────
// self = { levels: { mining: 12 }, inv: { iron_pickaxe: 1 } | [{ item, qty }], items?: [{ id, name, gear }] }
export const CITY_SKILLS = ['hacking', 'mining', 'smithing', 'woodcutting', 'crafting', 'fishing', 'farming', 'scavenging', 'cooking', 'chemistry', 'energy', 'engineering', 'agility', 'infiltration', 'bounty hunting', 'combat', 'defence', 'defense', 'ranged', 'vitality'];
const NOUNS = { hacker: 'hacking', miner: 'mining', smith: 'smithing', blacksmith: 'smithing', woodcutter: 'woodcutting', crafter: 'crafting', fisher: 'fishing', fisherman: 'fishing', angler: 'fishing', farmer: 'farming', scavenger: 'scavenging', cook: 'cooking', chef: 'cooking', chemist: 'chemistry', engineer: 'engineering', infiltrator: 'infiltration', 'bounty hunter': 'bounty_hunting' };
const skillKey = (w) => { const x = String(w).toLowerCase().replace(/s$/, ''); return NOUNS[x] ?? (x === 'defense' ? 'defence' : x.replace(/ /g, '_')); };
const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30 };
const skillRes = (skills) => {
  const SK = [...skills].sort((a, b) => b.length - a.length).map(escRe).join('|');
  return { SK, ANY: new RegExp(`\\b(${[...skills, ...Object.keys(NOUNS)].sort((a, b) => b.length - a.length).map(escRe).join('|')})s?\\b`, 'gi') };
};
function levelNums(cl, SK) {   // pure: [{ n, at, skill? }] level numbers in a clause
  const out = [], seen = new Set(), add = (n, at, skill = null) => { if (seen.has(at)) return; seen.add(at); out.push({ n: +n, at, skill }); };
  for (const m of cl.matchAll(/\b(?:level|lvl|lv)\.?[\s-]*(\d{1,3})\b/gi)) add(m[1], m.index + m[0].length - m[1].length);
  const UNITS = 'one|two|three|four|five|six|seven|eight|nine', TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  for (const m of cl.matchAll(new RegExp(`\\b(?:level|lvl)\\s+(${Object.keys(TENS).join('|')})[- ](${UNITS})\\b`, 'gi'))) add(TENS[m[1].toLowerCase()] + NUMW[m[2].toLowerCase()], m.index + m[0].length - m[0].split(/\\s+/).slice(1).join(' ').length);   // "level twenty-two" is 22
  for (const m of cl.matchAll(new RegExp(`\\b(?:level|lvl)\\s+(${[...Object.keys(NUMW), ...Object.keys(TENS)].join('|')})\\b(?![- ](?:${UNITS})\\b)`, 'gi'))) add(NUMW[m[1].toLowerCase()] ?? TENS[m[1].toLowerCase()], m.index + m[0].length - m[1].length);
  for (const m of cl.matchAll(/(?<![\w-])L(\d{1,3})\b/g)) add(m[1], m.index + 1);
  for (const m of cl.matchAll(new RegExp(`\\b(${SK})\\s+(\\d{1,3})\\b(?!\\s*(?:%|percent|crystals?|xp|ore|logs?|coins?|bars?|times|minutes|hours|days|items|actions|gathers))`, 'gi'))) add(m[2], m.index + m[0].length - m[2].length, skillKey(m[1]));
  for (const m of cl.matchAll(new RegExp(`(?<![\\d.,])\\b(\\d{1,3})\\s+(${SK})\\b(?![\\s-]+(?:rods?|kits?|rigs?|meters?|nets?|lines?|bait|gear|tools?|spots?|pots?|traps?|boots?|gloves?|packs?|bags?|axes?|picks?|pickaxes?|decoders?|items?))`, 'gi'))) add(m[1], m.index, skillKey(m[2]));   // "1 fishing rod" is an item
  return out;
}
const REQ_BEFORE = /\b(?:needs?|needed|requires?|required|opens?(?: up)?|unlocks?|at least|minimum|min\b\.?|from|starting at|gated at)\s*(?:\w+\s+){0,3}$/i;
const THING_AFTER = /^[\s-]*(?:\w+[\s-]+)?(?:spots?|beds?|banks?|pools?|sources?|veins?|stands?|terminals?|tools?|gear|pickaxes?|axes?|items?|recipes?|contracts?|areas?|zones?|nodes?|kelp|shrimp|reefs?|docks?|traps?|requirement|unlock|work|jobs?|stations?|sites?|plots?)\b/i;
const GOAL_BEFORE = /\b(?:up to|to reach|reach(?:ing)?|get(?:ting)?(?:\s+\w+){0,3}\s+to|push\w*(?:\s+\w+){0,3}\s+to|bring\w*(?:\s+\w+){0,3}\s+to|aim\w*\s+for|work\w*\s+(?:toward|towards|up to)|toward|towards|climb\w*(?:\s+\w+){0,3}\s+to|grind\w*(?:\s+\w+){0,3}\s+to|level\w*(?:\s+\w+){0,2}\s+to|train\w*(?:\s+\w+){0,3}\s+to|next|until|once I|before I|hitting|to hit|close to|almost|nearly|shy of|away from|on (?:my|the) way to)\b[^.!?]{0,30}$/i;
const GOAL_AFTER = /^\s*(?:next|soon|eventually|someday|one day|by (?:tonight|tomorrow|the weekend))\b/i;
const NO_SUBJECT = /^\s*(?:just\s+|still\s+|been\s+)?(?:trying|working|getting|heading|going|aiming|grinding|training|pushing|levell?ing|hoping|planning|saving|climbing|almost|nearly|close)\b/i;   // "Trying to get to level 20."
function selfClause(cl, sen) {   // pure: is this clause about the speaker?
  if (SECOND.test(cl)) return false;
  if (FIRST.test(cl) || (NO_SUBJECT.test(sen) && !OTHER_SUBJ.test(sen) && !SECOND.test(sen))) return true;
  // a clause with no subject of its own carries on from a first-person sentence ("I'm on chemistry, still at level 4")
  return !OTHER_SUBJ.test(cl) && !/^\s*(?:the|a|an|this|that|these|those|it|its|it's|there|here|every|each|some|most|all|[A-Z][a-z]+\s+[a-z]+s\b)/i.test(cl) && FIRST.test(sen) && !SECOND.test(sen);
}
// Gear: tools, weapons, armour, clothing, machines. Coins, ore and logs flow, so their mere mention isn't checked; a count is.
// Without an item catalog only these generic tool words are known (they match City item ids by suffix).
const ALIASES = { pickaxe: /_pickaxe$|^pickaxe$/, axe: /(?<!pick)_axe$|^axe$/, decoder: /_decoder$/, 'fishing rod': /_fishing_rod$|^fishing_rod$/, rod: /_fishing_rod$|^fishing_rod$/, 'climbing rig': /_climbing_rig$/, 'farming kit': /_farming_kit$|^farming_kit$/, 'salvage kit': /_salvage_kit$/, 'infiltration kit': /_infiltration_kit$/, 'energy meter': /_energy_meter$|^energy_meter$/, blade: /_blade$/, sword: /_(?:blade|sword)$/ };
const GEAR_CATS = new Set(['tool', 'weapon', 'armor', 'armour', 'clothing', 'utility_equipment', 'machine']);
const itemCache = new WeakMap(); let noCatalog = null;
function itemIndex(items) {   // items: [{ id, name, gear? , cat? }] or undefined
  const key = Array.isArray(items) ? items : null;
  if (key && itemCache.has(key)) return itemCache.get(key); if (!key && noCatalog) return noCatalog;
  const list = key ?? [], byName = new Map(), allIds = list.map((i) => String(i.id));
  for (const i of list) { const n = String(i.name ?? '').toLowerCase(); if (n) byName.set(n, { ids: [String(i.id)], gear: i.gear ?? GEAR_CATS.has(i.cat), name: n }); }
  for (const [a, r] of Object.entries(ALIASES)) { const ids = allIds.filter((x) => r.test(x)); if (!byName.has(a)) byName.set(a, { ids: ids.length ? ids : [a.replace(/ /g, '_')], idRe: r, gear: true, name: a }); }
  for (const [n, v] of [...byName]) if (!byName.has(`${n}s`)) byName.set(n.endsWith('s') ? n : `${n}s`, v);
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(escRe);
  const I = { byName, re: names.length ? new RegExp(`\\b(${names.join('|')})\\b`, 'gi') : null };
  if (key) itemCache.set(key, I); else noCatalog = I; return I;
}
const invMap = (inv) => (Array.isArray(inv) ? Object.fromEntries(inv.map((x) => [String(x?.item ?? x?.id ?? ''), Number(x?.qty ?? x?.count ?? 1)])) : inv ?? {});
const has = (inv, it) => Object.entries(inv).some(([id, q]) => q > 0 && (it.ids.includes(id) || (it.idRe && it.idRe.test(id))));
const POSSESS = /\b(?:I (?:have|carry|own|hold|keep|use|swing|wield|got|run)|I've (?:got|picked up|bought|forged|made|crafted|built)|I'm (?:carrying|holding|using|swinging|running|packing)|my)\s+(?:(?:own|trusty|new|old|first|spare|current|whole|little|good|best|a|an|the|some|stack of|stacks of|pile of|few|couple of)\s+)*$/i;
const WANT_BEFORE = /\b(?:need|needing|want|wanting|saving (?:up )?for|save (?:up )?for|working (?:toward|towards|on getting|on)|afford|buy|buying|get|getting|forge|forging|craft|crafting|make|making|earn|earning|build|building|dream of|after)\s+(?:up\s+)?(?:for\s+)?(?:an?|my first|a new|one|that|my own|my|a better)\s+$/i;
const NEG_BEFORE = /\b(?:I (?:don't|do not|didn't|never) (?:have|own|carry|hold|use)|I have no|I've got no|I haven't got|I haven't (?:forged|made|built|bought)|I've never had|still (?:need|want|saving for|working toward\w*))\s+(?:an?\s+|any\s+|my first\s+)?$/i;
const COUNT_BEFORE = /\b(?:I (?:have|carry|hold|got|own)|I've got|I'm (?:carrying|holding|sitting on)|my)\s+(?:about\s+|around\s+|over\s+|nearly\s+|almost\s+|exactly\s+)?(\d[\d,]*)\s+$/i;
export function stateWhy(text, self = {}) {   // → 'state:<kind>:<what>' | null
  const lv = self.levels ?? {}, known = Object.keys(lv).length > 0, inv = invMap(self.inv), I = itemIndex(self.items);
  const { SK, ANY } = skillRes(self.skills ?? CITY_SKILLS);
  for (const sen of sentencesOf(text)) for (const cl of clausesOf(sen)) {
    if (!selfClause(cl, sen)) continue;
    for (const x of levelNums(cl, SK)) {
      const before = cl.slice(0, x.at), after = cl.slice(x.at + String(x.n).length);
      if (REQ_BEFORE.test(before.slice(-30)) || THING_AFTER.test(after) || /\b(?:under|below|over|above|past|beyond|than)\s+(?:level\s*|lvl\s*)?$/i.test(before)) continue;   // what a spot needs, or a bound
      const named = x.skill ?? (() => { const b = [...before.matchAll(ANY)].pop(); if (b) return skillKey(b[1]); const a = [...after.matchAll(ANY)][0]; return a ? skillKey(a[1]) : null; })();
      if (GOAL_BEFORE.test(before.slice(-60)) || GOAL_AFTER.test(after)) return `state:goal-level:${named ? `${named.replace(/_/g, ' ')} ` : ''}${x.n}`;
      const cur = named ? lv[named] : null;
      if (!(known && (named ? cur != null && x.n === cur : Object.values(lv).includes(x.n)))) return `state:level:${named ? `${named.replace(/_/g, ' ')} ` : ''}${x.n}`;
    }
    if (!I.re) continue;
    for (const m of cl.matchAll(I.re)) {
      const it = I.byName.get(m[1].toLowerCase()); if (!it) continue;
      const before = cl.slice(0, m.index), cnt = COUNT_BEFORE.exec(before);
      if (cnt) { const n = +cnt[1].replace(/,/g, ''), real = Object.entries(inv).filter(([id]) => it.ids.includes(id) || (it.idRe && it.idRe.test(id))).reduce((s, [, q]) => s + q, 0); if (n !== real) return `state:count:${it.name} ${n}`; continue; }
      if (!it.gear) continue;
      if (NEG_BEFORE.test(before) || WANT_BEFORE.test(before)) { if (has(inv, it)) return `state:owned:${it.name}`; continue; }
      if (POSSESS.test(before) && !/\b(?:forge|make|craft|build|buy|get|earn|afford|someday|one day|dream)\b[^.!?]{0,20}$/i.test(before.replace(POSSESS, '')) && !has(inv, it)) return `state:item:${it.name}`;
    }
  }
  return null;
}

// ── the agent's own state: what it does ─────────────────────────────────────
// self.specialty: the skill it works · self.crafts: what it really crafts · self.trades: what it really sells or buys
// self.ownOk: other things it may say it has ("crew") · its inventory counts too. Weather is invented unless self.world.
const SELF = String.raw`\b(?:I|I'm|I've|I'd|I'll|I am|I have|I had|we|we've|we're)\b`;
const ADV = String.raw`(?:\s+(?:just|also|usually|often|mostly|sometimes|always|still|really|actually|can|could|will|would|do|did|don't|never|even|already|recently|lately|have|had|been|used to|like to|get to|tend to|try to|went to))*`;
const near = (verbs) => new RegExp(`${SELF}${ADV}\\s+(?:[\\w'’-]+\\s+){0,1}?(${verbs})\\b`, 'i');
const CRAFT = near('craft|crafts|crafted|crafting|make|makes|made|making|build|builds|built|building|forge|forges|forged|forging|smelt|smelts|smelted|smelting|smith|smiths|smithed|smithing|cook|cooks|cooked|cooking|brew|brews|brewed|brewing|assemble|assembles|assembled|assembling|repair|repairs|repaired|repairing|refine|refines|refined|refining|upgrade|upgrades|upgraded|upgrading|enchant|enchants|enchanted|sharpen|sharpened|carve|carves|carved|carving');
const TRADE = near('sell|sells|sold|selling|buy|buys|bought|buying|trade|trades|traded|trading|swap|swaps|swapped|deal|deals|dealt|barter|bartered|rent|rented|lend|lent');
const OWN = new RegExp(`(?:${SELF}${ADV}\\s+(?:own|owns|got|carry|carries|carried|keep|keeps|hold|holds|use|uses|used|using|wield|wields|equip|equipped|bring|brought|have|has)|\\bmy)\\s+(?:[\\w'’-]+\\s+){0,3}?(tools?|axes?|pickaxes?|picks?|rods?|kits?|gear|swords?|blades?|knives|knife|armou?r|hammers?|shovels?|saws?|meters?|bars?|ingots?|planks?|ore|gems?|pets?|house|home|shop|stall|plot|land|boat|drones?|workshop|forge|cart|wagon|crew|team|guild)\\b`, 'i');
const SKILL_VERBS = { hacking: 'hack|hacks|hacked|hacking|decrypt|decrypts|decrypted|decrypting', fishing: 'fish|fished|fishing|catch fish|caught fish', mining: 'mine (?:ore|copper|iron|gold|silver|coal|stone|gems?|crystals?|\\w+ ore)|mines (?:ore|copper|iron|gold|coal)|mined|mining', farming: 'farm|farms|farmed|farming|harvest|harvested|harvesting|grow crops|plant|planted', scavenging: 'scavenge|scavenged|scavenging|salvage|salvaged|salvaging',
  agility: 'climb|climbs|climbed|climbing|run the rigging|train agility', energy: 'tap power|work the substation|energy work', woodcutting: 'chop|chops|chopped|chopping|cut wood|cuts wood|fell trees|felled' };
const TOOL = { woodcutting: /^axe$/, mining: /^pick(?:axe)?$/, fishing: /^rod$/, farming: /^kit$/, scavenging: /^kit$/, agility: /^kit$/, energy: /^meter$/ };   // the noun alone: 'pickaxe' is not an axe
const WORLD = /\b(weather|raining|rainy|rainstorms?|storms?|stormy|snow\w*|sunny|foggy|heat ?wave|cold snap|[Rr]ain(?:s|ed|fall)?(?!\s+[A-Z]))\b/;   // "Rain Wheat Deck" (a capital after it) is a name
const sing = (w) => String(w).toLowerCase().replace(/(ves)$/, 'fe').replace(/(es|s)$/, '');
const wordsOf = (list) => (list ?? []).map((x) => String(x).toLowerCase().replace(/_/g, ' ')).filter(Boolean);
export function actionWhy(text, self = {}, list = null) {   // → 'invented:<kind>:<word>' | null · list: its map's names never count as weather
  const sp = String(self.specialty ?? '').toLowerCase(), held = Object.keys(invMap(self.inv)).join(' ').toLowerCase().replace(/_/g, ' ');
  const crafts = wordsOf(self.crafts), trades = wordsOf(self.trades), ownOk = wordsOf(self.ownOk), also = wordsOf(self.also).map((x) => x.replace(/ /g, '_'));
  const skillRe = Object.fromEntries(Object.entries({ ...SKILL_VERBS, ...(self.skillVerbs ?? {}) }).map(([k, v]) => [k, near(v)]));
  for (const s of sentencesOf(text)) {
    if (/\?\s*$/.test(s) && !/\bI\b/.test(s.replace(/^.*?,\s*/, ''))) continue;   // a question to them claims nothing
    const low = s.toLowerCase(); let m;
    if (!self.world) {   // a place on the map ("the rain wheat deck", any case) is not weather
      const w = (list?.map ?? []).reduce((t, n) => t.replace(new RegExp(`\\b${escRe(n)}\\b`, 'gi'), ' '), s);
      const m2 = WORLD.exec(w); if (m2) return `invented:world:${m2[1].toLowerCase()}`;
    }
    if ((m = CRAFT.exec(s)) && !crafts.some((c) => low.includes(c))) return `invented:craft:${m[1].toLowerCase()}`;
    if ((m = TRADE.exec(s)) && !trades.some((c) => new RegExp(`\\b${escRe(c.replace(/s$/, ''))}s?\\b`, 'i').test(low))) return `invented:trade:${m[1].toLowerCase()}`;   // whole words: "Kingofcoins" is not "coins"
    if ((m = OWN.exec(s))) {
      const w = sing(m[1]);
      const own = (TOOL[sp] && TOOL[sp].test(w)) || (w.length >= 3 && held.includes(w)) || ownOk.some((o) => sing(o) === w);
      if (!own) return `invented:own:${w}`;
    }
    for (const [k, r] of Object.entries(skillRe)) if (k !== sp && !also.includes(k) && (m = r.exec(s))) return `invented:skill:${k}`;
  }
  return null;
}

// State keys that aren't read (a typo like "speciality" fails safe but silently): for warnings.
export const STATE_KEYS = ['specialty', 'levels', 'inv', 'items', 'crafts', 'trades', 'ownOk', 'also', 'world', 'skills', 'skillVerbs'];
export const unknownStateKeys = (self) => Object.keys(self ?? {}).filter((k) => !STATE_KEYS.includes(k));

// ── one call for all of it, and the words for a redraft ─────────────────────
// ctx = { list, them, name, self }. self may be null (then only the list is checked).
export function checkLine(text, ctx = {}) {
  const list = ctx.list ?? loadList();
  return claimWhy(text, { list, them: ctx.them }) ?? placeWhy(text, { list, them: ctx.them, name: ctx.name })
    ?? (ctx.self ? stateWhy(text, ctx.self) ?? actionWhy(text, ctx.self, list) : null);
}
const levelsText = (lv) => Object.entries(lv ?? {}).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s.replace(/_/g, ' ')} ${n}`).join(', ');
// Why it was refused, written to finish "Your last try was rejected (it …)". Never gives words to copy.
export function tell(why, ctx = {}) {
  const w = String(why ?? ''), parts = w.split(':'), self = ctx.self ?? {}, list = ctx.list ?? loadList();
  if (parts[0] === 'banned' && parts[1] === 'place') { const ex = [...new Set(list.places.map((p) => p.say))].slice(0, 2); return `names a place that is not on the map ("${parts.slice(2).join(':')}"). Name only places you have really been or seen named${ex.length ? ` (such as ${ex.join(', ')})` : ''}, or leave the place out`; }
  if (parts[0] === 'banned') { const c = list.claims.find((x) => x.id === parts[1]), p = list.places.find((x) => x.id === parts[1]); return c ? c.tell : p ? `names "${p.name}", which is not a real place. Say "${p.say}" instead, or leave it out` : 'makes a claim on the banned list. Leave it out'; }
  if (parts[0] === 'state') {
    const lv = levelsText(self.levels), what = parts.slice(2).join(':');
    return { 'goal-level': `gives yourself a target level (${what}). Never set a target number: say the work without a level, or give your real level (${lv || 'not known'})`,
      level: `gives a level for yourself that is not yours (${what}). Your levels right now: ${lv || 'not known, so give none'}. Use those or leave the number out`,
      owned: `says you are working toward or lack ${what}, which you already carry. Leave it out`,
      item: `says you carry ${what}, which is not in your inventory. Leave it out`,
      count: `gives a count of what you carry (${what}) that is not your real count. Leave the number out` }[parts[1]] ?? 'states something about yourself that your own data does not back. Leave it out';
  }
  if (parts[0] === 'invented') {
    const k = parts[1], x = parts[2], tr = wordsOf(self.trades);
    return { craft: `claimed you ${x} things, but ${self.crafts?.length ? `you only craft ${wordsOf(self.crafts).join(', ')}` : 'you craft nothing'}`,
      trade: `claimed you ${x} things you don't trade${tr.length ? ` (you only trade ${tr.join(', ')})` : ''}`,
      own: `claimed you have a ${x} you don't have`, skill: `claimed you do ${x}, which is not your work${self.specialty ? ` (yours is ${self.specialty})` : ''}`,
      world: `talked about ${x}, which isn't in anything you can see` }[k] ?? 'claimed something you did not do';
  }
  return 'says something its checks refused. Leave it out';
}
// The line without its refused sentences, or null when too little is left (then skip, don't send a fragment).
export function dropBad(text, whyFn, minLen = 25) {
  const kept = sentencesOf(text).filter((s) => !whyFn(s)).join(' ').trim();
  return kept.length >= minLen && kept !== String(text).trim() ? kept : null;
}
// The loop: check; if refused, ask for ONE redraft with the reason; check the redraft against everything; if it is
// still bad, drop the refused sentences; if too little is left, skip. redraft(reason, line) → Promise<string|null>.
// extra(line) → a reason from your own other checks, or null: it is applied to the redraft too, so a redraft can't
// pass one check by breaking another.
export async function guard(line, ctx = {}, { redraft = null, extra = () => null, minLen = 25 } = {}) {
  const why = (l) => checkLine(l, ctx) ?? extra(l);
  const w0 = why(line);
  if (!w0) return { line, how: 'clean' };
  if (redraft) {
    let l2 = null; try { l2 = await redraft(tell(w0, ctx), line); } catch { l2 = null; }
    if (typeof l2 === 'string' && l2.trim() && !why(l2.trim())) return { line: l2.trim(), how: 'redrafted', why: w0 };
  }
  const kept = dropBad(line, why, minLen);
  if (kept) return { line: kept, how: 'trimmed', why: w0 };
  return { skip: true, how: 'skipped', why: w0 };
}
// For a review of lines already sent: every hit, not just the first.
export function scan(lines, ctx = {}) {
  const out = [];
  for (const [i, raw] of lines.entries()) {
    const text = typeof raw === 'string' ? raw : raw?.text ?? '';
    const list = ctx.list ?? loadList(), them = raw?.them ?? ctx.them, self = ctx.self;
    const hits = [...new Set(sentencesOf(text).flatMap((s) => [claimWhy(s, { list, them }), placeWhy(s, { list, them, name: raw?.name ?? ctx.name }), self ? stateWhy(s, self) : null, self ? actionWhy(s, self, list) : null]).filter(Boolean))];
    if (hits.length) out.push({ i, line: raw?.line ?? i + 1, text: text.slice(0, 160), hits });
  }
  return out;
}

// ── command line ────────────────────────────────────────────────────────────
function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--list', '--state', '--them', '--name'].includes(a)) { if (argv[i + 1] === undefined) { console.error(`${a} needs a value`); process.exit(2); } o[a.slice(2)] = argv[++i]; }
    else if (a.startsWith('--')) { console.error(`unknown option ${a} (options: --list, --state, --them, --name)`); process.exit(2); }
    else o._.push(a);
  }
  return o;
}
function readState(file) {
  if (!file) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`--state ${file}: ${e.code === 'ENOENT' ? 'not found' : 'not valid JSON'}`); process.exit(2); }
}
function main() {
  const o = args(process.argv.slice(2)), [cmd, x] = o._;
  const list = loadList(o.list ?? process.env.GUARDS_LIST ?? EXAMPLE_LIST), self = readState(o.state), ctx = { list, self, them: o.them ?? '', name: o.name ?? '' };
  if (cmd && list.source.startsWith('example (')) console.error(`warning: using the EXAMPLE list: ${list.source.replace(/^example \(your list: /, '').replace(/\)$/, '')} (${o.list ?? process.env.GUARDS_LIST})`);
  const unk = unknownStateKeys(self); if (unk.length) console.error(`warning: --state has key(s) the checks don't read: ${unk.join(', ')} (known: ${STATE_KEYS.join(', ')})`);
  if (cmd === 'list') {
    console.log(`list: ${list.tag}${list.source.startsWith('example') ? '' : ` (${path.basename(list.file)})`}`);
    for (const c of list.claims) console.log(`  ${c.on ? '✓' : '–'} ${c.id}${c.echo ? ' (echo)' : ''}${c.unless ? ' (unless)' : ''}: ${c.tell.slice(0, 90)}`);
    for (const p of list.places) console.log(`  ${p.on ? '✓' : '–'} ${p.id}: ${p.name} → ${p.say}`);
    for (const e of list.errors) console.log(`  ✗ ${e}`);
    process.exit(list.errors.length || list.source.startsWith('example (') ? 1 : 0);
  }
  if (cmd === 'check' && x !== undefined) {
    const w = checkLine(x, ctx);
    console.log(w ? `refused: ${w}\n  tell: ${tell(w, ctx)}` : 'ok');
    process.exit(w ? 1 : 0);
  }
  if (cmd === 'scan' && x) {
    let raw; try { raw = fs.readFileSync(x, 'utf8'); } catch { console.error(`no file ${x}`); process.exit(2); }
    let skipped = 0;
    const lines = raw.split('\n').map((l, n) => ({ l, n: n + 1 })).filter(({ l }) => l.trim()).map(({ l, n }) => {
      if (l.trim().startsWith('{')) { try { const j = JSON.parse(l); if (typeof j?.text !== 'string') { skipped++; return null; } return { ...j, line: n }; } catch { /* plain text */ } }
      return { text: l, line: n };
    }).filter(Boolean);
    const hits = scan(lines, ctx);
    for (const h of hits) console.log(`${h.line}: ${h.hits.join(', ')}  ${h.text}`);
    if (skipped) console.error(`warning: ${skipped} JSON line(s) had no "text" field and were not checked`);
    const by = {}; for (const h of hits) for (const k of h.hits) { const key = k.split(':').slice(0, 2).join(':'); by[key] = (by[key] ?? 0) + 1; }
    console.log(`scan: ${hits.length} of ${lines.length} line(s) refused${hits.length ? ` · ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}` : ''} · ${list.tag}`);
    process.exit(0);
  }
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(cmd ? 2 : 0);
}
const direct = () => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && direct()) main();
