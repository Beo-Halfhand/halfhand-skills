// receipt-gate.mjs: an example of your own gate, run with `node xk.mjs gates --gates examples/receipt-gate.mjs`.
//
// The gate: before an agent's "I sold 10 nets for 40 coins" is logged as confirmed, look the receipt up in the
// world's own record (here, an invented market ledger) and check it says the same thing. The cases below are the
// proof that it says no: a made-up receipt, the right receipt with the wrong amount, someone else's receipt, one
// that was already used. The mutants check every field is really compared (a gate that ignores the id would let a
// one-character change through, and the runner would say so).

const LEDGER = new Map([
  ['M-7301', { agent: 'wren', item: 'nets', qty: 10, coins: 40 }],
  ['M-7302', { agent: 'moss', item: 'rope', qty: 4, coins: 18 }],
  ['M-7303', { agent: 'wren', item: 'salt', qty: 2, coins: 9 }],
]);

export function receiptMatches(claim, used = new Set()) {
  const r = LEDGER.get(claim?.receipt);
  if (!r || used.has(claim.receipt)) return false;
  return r.agent === claim.agent && r.item === claim.item && r.qty === claim.qty && r.coins === claim.coins;
}

const good = { receipt: 'M-7301', agent: 'wren', item: 'nets', qty: 10, coins: 40 };

export default [
  {
    name: 'receipt-matches-ledger',
    why: 'an agent\'s sale counts only when the market ledger has the same receipt',
    accept: (c) => receiptMatches(c, new Set(c.alreadyUsed ? [c.receipt] : [])),
    good: [{ label: 'the sale as the ledger has it', input: good }, { label: 'a second agent\'s sale', input: { receipt: 'M-7302', agent: 'moss', item: 'rope', qty: 4, coins: 18 } }],
    bad: [
      { label: 'a receipt the ledger never issued', input: { ...good, receipt: 'M-9999' } },
      { label: 'the right receipt, more coins', input: { ...good, coins: 400 } },
      { label: 'someone else\'s receipt', input: { ...good, receipt: 'M-7302' } },
      { label: 'a receipt counted twice', input: { ...good, alreadyUsed: true } },
      { label: 'no receipt at all', input: { agent: 'wren', item: 'nets', qty: 10, coins: 40 } },
    ],
    mutants: [['receipt', 'flip'], ['receipt', 'drop'], ['coins', 'bump'], ['qty', 'zero'], ['agent', 'flip'], ['item', 'flip']],
  },
];
