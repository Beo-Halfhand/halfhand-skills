#!/usr/bin/env node
// demo.mjs: the guard loop on six made-up drafts, with a stand-in for the model (no network, nothing sent).
//   node demo.mjs                      uses the example list and state.example.json
//   node demo.mjs --list my-list.md --state my-state.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guard, loadList, EXAMPLE_LIST } from './guards.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const list = loadList(arg('--list') ?? EXAMPLE_LIST);
const self = JSON.parse(fs.readFileSync(arg('--state') ?? path.join(HERE, 'state.example.json'), 'utf8'));
const DRAFTS = [
  ['what do you do?', 'I cut wood at the tree stands, mostly. It is steady work.'],
  ['any tips on selling?', 'Merchant prices drift about 15% in a few minutes, so time your sales.'],
  ['nice axe', 'Thanks. I craft cinder axes at the tree stands. Woodcutting is my trade.'],
  ['what level are you?', "I'm level 30 in woodcutting now."],
  ['where should I go?', 'Head to the Glow Market for cheap ore.'],
  ['how is it going?', 'The weather has been rough lately.'],
];
// The stand-in "model": on a redraft it answers the reason it was given. A real one gets the same reason in its prompt.
const redraft = async (reason) => (/percentage|rates/.test(reason) ? 'The Central Crypto Merchant pays the same for meme coins every time I sell.'
  : /level/.test(reason) ? 'I work woodcutting at the tree stands; level 9 for now.' : /place/.test(reason) ? 'The Glow Market has the best ore.' : null);
console.log(`list: ${list.tag}\nself: ${self.specialty}, levels ${JSON.stringify(self.levels)}\n`);
for (const [them, draft] of DRAFTS) {
  const r = await guard(draft, { list, self, them }, { redraft });
  console.log(`them:  ${them}\ndraft: ${draft}\n  → ${r.how}${r.why ? ` (${r.why})` : ''}${r.skip ? ': nothing is sent' : `: "${r.line}"`}\n`);
}
