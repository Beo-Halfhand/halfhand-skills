# Gates that must reject

A gate is anything that says yes or no before something counts or happens: a bar, a receipt check, a reply filter, a spending guard, a schema validator, a verifier. **A gate that has never rejected anything is not a filter.** It might be one, or it might let everything through, and you can't tell which from the outside: both look like "all clear".

So every gate ships with its proof, and the proof runs every time:

```sh
node xk.mjs gates                              # the kit's own gates
node xk.mjs gates --gates my-gates.mjs         # plus yours. Exit 1 if any gate fails
```

```
gate                    says no to bad  yes to good  mutants killed  result
register-row            7/7             2/2          14/14           ok
reward-guard            4/4             1/1          2/2             ok
receipt-matches-ledger  5/5             2/2          12/12           ok
…
gates: 11 ok, each shown saying no
```

## The shape

```js
// my-gates.mjs
export default [{
  name: 'receipt-matches-ledger',
  why: 'a sale counts only when the market ledger has the same receipt',
  accept: (claim) => receiptMatches(claim),               // true = let it through. Throwing counts as "no"
  good: [{ label: 'the sale as the ledger has it', input: { receipt: 'M-7301', agent: 'scout-a', item: 'nets', qty: 10, coins: 40 } }],
  bad: [
    { label: 'a receipt the ledger never issued', input: { …, receipt: 'M-9999' } },
    { label: 'the right receipt, more coins', input: { …, coins: 400 } },
    { label: 'a receipt counted twice', input: { …, alreadyUsed: true } },
  ],
  mutants: [['receipt', 'flip'], ['receipt', 'drop'], ['coins', 'bump'], ['agent', 'flip']],
}];
```

The full example is [`scripts/examples/receipt-gate.mjs`](../scripts/examples/receipt-gate.mjs).

A gate **fails** when:

- it has **no known-bad case** (never shown to reject);
- it has **no known-good case** (a gate that refuses everything is no filter either, and is the usual result of a check that is missing an input it needs);
- it lets a known-bad case through, or refuses a known-good one;
- a **mutant survives**.

## Mutants

Known-bad cases are the ones you thought of. Mutants find the ones you didn't: the runner takes each good case, changes one thing, and the gate must say no.

| Op | Change | Catches a gate that… |
|---|---|---|
| `flip` | one character in the middle of a string | compares a prefix, or doesn't compare that field at all |
| `drop` | removes the field | treats a missing field as fine (or as zero) |
| `zero`, `negate` | the number becomes 0 or −n | doesn't check sign or presence |
| `bump` | the number goes up by 1% + 1 | checks "roughly" or only the order of magnitude |
| `future`, `past` | a time (ms or ISO) moves 30 days | doesn't check when |

Paths can be nested: `bar.min`, `rows.0.barWrittenAt`, `reads.2`. A mutant that survives is reported with the field: "mutant survived: flip receipt on 'the sale as the ledger has it' was let through" means the gate never looks at the receipt id.

Only list mutants that **must** be refused. If a field legitimately doesn't matter to the gate, don't mutate it.

## The kit's own gates

`xk.mjs gates` runs these first, so the kit shows it can say no before you trust any readout from it:

| Gate | Must refuse |
|---|---|
| `register-row` | a bar written after go-live, no minimum sample, an agent in both groups, a backstop before go-live, no control, no bar, one agent in two open rows |
| `outcome-record` | a time in the future, confirmed with no proof, confirmed left out, a missing value, an unknown arm |
| `score-confirmed-only` | a claim, an empty proof, an unmeasured window, a value that isn't a number |
| `reward-guard` | a value 45× the agent's own median, a negative, a missing value, NaN |
| `confirm-before-log` | an A→B→A flap, a value seen once, two different candidates, alternating copies |
| `bar-lift` | no difference, +5% under a +15% bar, +40% on 12 a side, a short control, claims only, everything measured before go-live |
| `bar-paired` | −12% after 25 pairs (stop), +4% in heavy noise (bound under 0), too few pairs, half of every pair missing |
| `bar-rate` | 2% fallbacks under a 1% bar, one harmful disagreement, too few decisions |
| `raw-output-check` | nothing in 24 h, 12 identical values, all zeros, a third unmeasured, a quarter unconfirmed |
| `decide` | KEEP on half the sample with no reason, deciding a closed row, CLOSE with no reason, a made-up verdict |

## Where gates come from

Write one whenever something you trust says "yes" for you:

- **Before an outcome counts:** a receipt or transaction lookup, a signature check, "the second read agreed".
- **Before an agent acts:** a spending cap, an allow list, a reply filter that blocks claims you don't want made.
- **Before a result is believed:** the bar itself, and any "too clean?" check.

Then run `gates` in CI next to your tests. A change that quietly turns a gate into "always yes" fails the build on the bad cases, not three weeks later in the data.

## Also show the good path

A verifier called without one of its inputs (an optional root, a key, a time window) can return `false` for everything, including good records. That gate "rejects" perfectly and is useless. The known-good cases are there to catch it: run them with the inputs exactly as production passes them.
