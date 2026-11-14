// The tally arithmetic in plain JavaScript, with nothing from the Midnight packages. A client, a page or a checker can compute seals and
// counts with this. It has to match tally.compact to the bit, and tally.test.mjs holds the two together.
// What the test shows for compactc 0.31.1: persistentHash is SHA-256 of the fields in order. Bytes<N> as they are; Uint<8> as one byte;
// a Vector as its elements one after another. hall-cage shows a Uint<32> is 4 bytes little-endian. Check your own types the same way.
import { createHash } from 'node:crypto';

const sha = (...parts) => { const h = createHash('sha256'); for (const p of parts) h.update(p); return new Uint8Array(h.digest()); };
const b32 = (b) => { if (!(b instanceof Uint8Array) || b.length !== 32) throw new Error('expected 32 bytes'); return b; };
const u8 = (n) => { const v = Number(n); if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`${n} is not a Uint<8>`); return Uint8Array.of(v); };
const tag = (s) => { const out = new Uint8Array(32); out.set(new TextEncoder().encode(s)); return out; }; // pad(32, s)

export const keyId = (sk) => sha(tag('tally:key:v1'), b32(sk));
export const commitOf = (hand, slot, self) => {
  if (hand.values.length !== 5) throw new Error('five values');
  return sha(tag('tally:commit:v1'), b32(hand.nonce), ...hand.values.map(u8), u8(slot), b32(self));
};
export const countOf = (values, t) => values.filter((v) => BigInt(v) === BigInt(t)).length;
