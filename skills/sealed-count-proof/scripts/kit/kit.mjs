// kit.mjs: offline tests for a contract that proves something about sealed values. No chain, no proofs, no keys.
// The patterns are hall-cage's (test/dice-proof.test.mjs at e5ce2d1, Apache-2.0), made generic. Read references/kit.md first.
//
//   const w = await makeWorld({ build: './managed/tally', witnesses, args: [...] });
//   w.call(who, 'seal', 0n, commit);              // built and landed
//   const tx = w.build(who, 'proveCount', 0n, 2n); // built against the state of the moment, not landed
//   w.land(tx);                                    // true if the chain would still apply it now
//
//   const ck = makeChecker('./managed/tally');     // the circuit checker over the build's ZKIR: does what was built satisfy the circuit?
//   await ck.passes('proveCount', tx);             // throws if the circuit refuses what was built
//   await ck.refuses('proveCount', cheatTx);       // throws if the circuit accepts it
//
//   const cheat = await cheatBuild('./managed/tally');            // the compiled JavaScript with every assert taken out
//   const evil = await compileChanged('tally.compact', from, to); // a real compile of a changed source: a house running its own circuit
//
// A caller ("who") is the private state your witnesses read. Scratch builds go under <this folder>/managed/, where Node finds the
// runtime this folder installs, wherever your .compact source is.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createConstructorContext, createCircuitContext, sampleContractAddress, QueryContext, CostModel, proofDataIntoSerializedPreimage } from '@midnight-ntwrk/compact-runtime';
import * as zkir from '@midnight-ntwrk/zkir-v2';

const COIN = '00'.repeat(32); // a coin public key; the simulator doesn't check it
const HUGE_GAS = { readTime: 10n ** 12n, computeTime: 10n ** 12n, bytesWritten: 10n ** 9n, bytesDeleted: 10n ** 9n };

export const bytes32 = () => new Uint8Array(randomBytes(32));
export const hex = (u) => Buffer.from(u).toString('hex');
const load = (build) => import(pathToFileURL(path.resolve(build, 'contract/index.js')).href);
// Scratch folders are per process (two test runs at once must not write each other's files) and are removed when the process exits.
const RUN = `${process.pid}-${randomBytes(3).toString('hex')}`;
const KIT = path.dirname(fileURLToPath(import.meta.url));
const scratch = new Set();
process.on('exit', () => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

/**
 * A simulated chain for one deployment.
 * @param {object} o
 * @param {string|object} o.build  folder `compact compile` wrote (holds contract/index.js), or an already imported module
 * @param {object} o.witnesses     your witness functions
 * @param {Array}  [o.args]        constructor arguments
 * @param {object} [o.deployer]    private state for the constructor (default {})
 * @param {string} [o.address]     contract address, hex (default: a sample). Two worlds with two addresses = two deployments
 * @param {bigint} [o.time]        starting block time, seconds (default 1_900_000_000n)
 */
export async function makeWorld({ build, witnesses, args = [], deployer = {}, address = sampleContractAddress(), time = 1_900_000_000n }) {
  const mod = typeof build === 'string' ? await load(build) : build;
  const contract = new mod.Contract(witnesses);
  const init = contract.initialState(createConstructorContext(deployer, COIN), ...args);
  let now = BigInt(time);
  let ctx = createCircuitContext(address, COIN, init.currentContractState.data, deployer, undefined, undefined, Number(now));
  const atNow = (block) => ({ ...block, secondsSinceEpoch: now });
  const w = {
    module: mod,
    address,
    /** This contract's address as the 32 bytes `kernel.self().bytes` gives a circuit. */
    self: new Uint8Array(Buffer.from(address, 'hex')),
    get now() { return now; },
    at(t) { now = BigInt(t); return w; },
    wait(s) { now += BigInt(s); return w; },
    /** Run a circuit as `who` against the current state. Throws if an assert fails. Changes nothing. The result carries `.circuit`. */
    build(who, circuit, ...a) { return w.buildWith(contract, who, circuit, ...a); },
    /** The same, with another contract's code (a cheat build, a changed circuit) on this state: `w.buildWith(new cheat.Contract(witnesses), who, circuit, ...)`. */
    buildWith(c, who, circuit, ...a) {
      const fn = c.impureCircuits[circuit];
      if (!fn) throw new Error(`no circuit ${circuit}`);
      const cc = { ...ctx, currentPrivateState: who };
      cc.currentQueryContext.block = atNow(cc.currentQueryContext.block);
      const r = fn(cc, ...a);
      r.circuit = circuit;
      return r;
    },
    /** Build and land at once. */
    call(who, circuit, ...a) { const r = w.build(who, circuit, ...a); ctx = r.context; return r; },
    /** Replay something built earlier against the state now, as the chain would. true = it applied. */
    land(built) {
      const qc = new QueryContext(ctx.currentQueryContext.state, address);
      qc.block = atNow(ctx.currentQueryContext.block);
      try {
        const after = qc.runTranscript({ gas: HUGE_GAS, effects: built.context.currentQueryContext.effects, program: built.proofData.publicTranscript }, CostModel.initialCostModel());
        ctx = { ...ctx, currentQueryContext: after };
        return true;
      } catch { return false; }
    },
    /** The public ledger, as the compiled `ledger()` reads it. */
    state: () => mod.ledger(ctx.currentQueryContext.state),
  };
  return w;
}

// A misspelt circuit name must fail the test, not count as a refusal.
const setupError = (e) => /^no circuit /.test(String(e?.message ?? e));
const judge = (e, expect) => {
  if (setupError(e)) throw e;
  const msg = String(e?.message ?? e);
  if (expect && !expect.test(msg)) throw new Error(`refused, but not for the expected reason (${expect}): ${msg}`);
  return true;
};
/**
 * true if f() throws: refused by the contract's own code, which is what an honest client sees. Pass `expect`, a regex for the
 * assert's message, so a refusal for some other reason (a wrong argument, a typo) doesn't pass for the one you mean.
 */
export const refused = (f, expect) => { try { f(); return false; } catch (e) { return judge(e, expect); } };
/** The same for async work, e.g. deploying with bad constructor arguments: `await refusedAsync(() => makeWorld({...}), /window/)`. */
export const refusedAsync = async (f, expect) => { try { await f(); return false; } catch (e) { return judge(e, expect); } };

/**
 * The circuit checker over a build's ZKIR. It decides whether what a client built (its inputs, outputs, public transcript and
 * private values) satisfies the circuit. That is the level that matters: a cheat can change their JavaScript, but the chain's
 * verifier keys come from the real circuit. No proving keys are needed (compile with --skip-zk).
 */
export function makeChecker(build) {
  const cache = new Map();
  const file = (name) => path.resolve(build, 'zkir', `${name}.zkir`);
  const ir = (name) => {
    if (!cache.has(name)) cache.set(name, zkir.jsonIrToBinary(readFileSync(file(name), 'utf8')));
    return cache.get(name);
  };
  // Mistakes in the test itself throw, so they can never pass as "the checker refused it".
  const setup = (name, built) => {
    if (!existsSync(file(name))) throw new Error(`no ZKIR for circuit "${name}" in ${build}/zkir`);
    if (built?.circuit && built.circuit !== name) throw new Error(`this transaction was built with ${built.circuit}, not ${name}`);
    if (!built?.proofData) throw new Error('not a built transaction: pass what w.build or w.buildWith returned');
  };
  const provider = {
    async lookupKey(name) { return { ir: ir(name), proverKey: new Uint8Array(), verifierKey: new Uint8Array() }; },
    async getParams() { throw new Error('checking needs no parameters'); },
  };
  const check = (name, built) => {
    setup(name, built);
    const p = built.proofData;
    return zkir.check(proofDataIntoSerializedPreimage(p.input, p.output, p.publicTranscript, p.privateTranscriptOutputs, name), provider);
  };
  return {
    check,
    async passes(name, built) { await check(name, built); },
    async refuses(name, built) {
      setup(name, built);
      let ok = false;
      try { await check(name, built); ok = true; } catch { /* refused, as it should be */ }
      if (ok) throw new Error(`the checker accepted this ${name}: the circuit doesn't enforce what the test expects`);
    },
  };
}

/** The compiled contract with every assert made a no-op: what a cheat gets by editing the client's JavaScript. Default folder: next to the build, removed on exit. */
export async function cheatBuild(build, out) {
  if (!out) { out = path.resolve(build, '..', `.cheat-${path.basename(build)}-${RUN}`); scratch.add(out); }
  const src = readFileSync(path.resolve(build, 'contract/index.js'), 'utf8');
  const stripped = src.replaceAll('__compactRuntime.assert(', '((..._a) => {})(');
  if (stripped === src) throw new Error('found no asserts to take out: the compiled code has changed shape, so this cheat build would prove nothing');
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'index.js'), stripped);
  return import(pathToFileURL(path.join(out, 'index.js')).href);
}

/**
 * A real compile of a changed source, with --skip-zk. Two forms:
 *   compileChanged(source, from, to, { out })          `from` replaced once by `to`
 *   compileChanged(source, [[from, to], ...], { out }) several changes
 * Each `from` must appear exactly once. Returns { module, build }. `out` defaults to <kit>/managed/.changed-*, removed on exit.
 * Build with the changed module, then check against the REAL build's ZKIR: that's a house running its own circuit.
 */
export async function compileChanged(source, from, to, opts) {
  const many = Array.isArray(from);
  const changes = many ? from : [[from, to]];
  const out = (many ? to : opts)?.out;
  let text = readFileSync(source, 'utf8');
  for (const [f, t] of changes) {
    const n = text.split(f).length - 1;
    if (n !== 1) throw new Error(`the change no longer applies: "${f.slice(0, 60)}" appears ${n} times in ${source}, needs exactly 1`);
    text = text.replace(f, t);
  }
  let dir = out;
  if (!dir) { dir = path.join(KIT, 'managed', `.changed-${RUN}-${scratch.size}`); scratch.add(dir); }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'src.compact'), text);
  execFileSync('compact', ['compile', '--skip-zk', path.join(dir, 'src.compact'), path.join(dir, 'out')], { stdio: 'pipe' });
  return { module: await load(path.join(dir, 'out')), build: path.join(dir, 'out') };
}

/** JSON of anything, with bigints and bytes made searchable (bytes as hex). For privacy scans. */
export const scan = (x) => JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? hex(v) : v));

/** The parts of a built transaction that become public: inputs, outputs and the public transcript. */
export const publicPart = (built) => scan({ input: built.proofData.input, output: built.proofData.output, transcript: built.proofData.publicTranscript });
/** The private part: what the prover is told and the chain never sees. Scan it too, so a scan that finds nothing anywhere is caught. */
export const privatePart = (built) => scan(built.proofData.privateTranscriptOutputs);

/**
 * Does `text` (from scan, publicPart or privatePart) contain `secret`? Searches the secret's hex without its trailing zero bytes:
 * with compact-runtime 0.16.0, a Bytes<32> ending in 0x00 shows up in the built proof data without those zeros, so a search for
 * the full hex misses it about 1 time in 256 (and could miss a real leak). Refuses a secret with fewer than 16 non-zero-tail bytes.
 */
export function hasBytes(text, secret) {
  let n = secret.length;
  while (n > 0 && secret[n - 1] === 0) n--;
  if (n < 16) throw new Error(`this secret has only ${n} bytes before its trailing zeros: too little to search for. Use a random 32-byte secret`);
  return text.includes(hex(secret.subarray(0, n)));
}
