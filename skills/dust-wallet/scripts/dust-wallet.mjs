#!/usr/bin/env node
// dust-wallet.mjs: a self-funded Midnight wallet that pays its own fees in DUST (Ledger 9 stack, wallet SDK 2).
//
//   node dust-wallet.mjs init    <name>          make a seed (mode 600) and write the funding address to a file
//   node dust-wallet.mjs address <name>          write the funding address to a file again (no network)
//   node dust-wallet.mjs balance <name>          sync (the first time from genesis), save, print tNIGHT / DUST / registration
//   node dust-wallet.mjs dust    <name>          dry run: sync, show what a registration would do and cost, send nothing
//   node dust-wallet.mjs dust    <name> --send   register the wallet's NIGHT for DUST (one transaction), wait for spendable DUST
//   node dust-wallet.mjs self-test               offline checks: refusals, masking, lock, seed file mode
//
// Env (no defaults, no public fallback; put them in a .env and run `node --env-file=.env dust-wallet.mjs …`):
//   MIDNIGHT_NETWORK      preprod (default) or preview. mainnet is refused.
//   MIDNIGHT_NODE_WS      node websocket, wss://…
//   MIDNIGHT_INDEXER      indexer GraphQL over https://…
//   MIDNIGHT_INDEXER_WS   indexer GraphQL over wss://…
//   MIDNIGHT_PROOF_SERVER optional http://host:port of a Ledger 9 proof server; without it the wallet proves in-process (WASM)
//   DUST_WALLET_DIR       optional, default ./.dust-wallet (one folder per wallet name, mode 700)
//   DUST_PER_CALL         optional, DUST per contract call for the "about N calls" line (default 0.3)
//
// Never printed: the seed, keys, endpoint URLs (only their hosts), query strings. All output passes a mask first.
// One process per wallet: a lock file stops a second process opening the same wallet.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { inspect } from 'node:util';
import { fileURLToPath } from 'node:url';

// ---------- 1. mask everything this process writes (installed before any SDK module loads) ----------
const MASKS = [
  [/([?&](?:project_id|api[_-]?key|apikey|key|token|secret)(?:=|%3D))[^&\s"'<>]+/gi, '$1***'],
  [/night(preprod|preview|mainnet)[A-Za-z0-9]{32}/g, 'night$1***'],
  [/(\/\/[^/\s:@]+:)[^@\s/]+@/g, '$1***@'],
  [/\bmn_[a-z_]+1[02-9ac-hj-np-z]{20,}/g, 'mn_***'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'uuid-***'],
  [/\b((?:wss?|https?):\/\/[^/\s'"?#]+)[/?#][^\s'")]*/g, '$1/…'], // any URL: host only, path and query hidden (keys can sit in a path)
];
export const mask = (s) => MASKS.reduce((t, [re, to]) => t.replace(re, to), String(s));
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => write(typeof chunk === 'string' || Buffer.isBuffer(chunk) ? mask(chunk.toString()) : chunk, ...rest);
}

const t0 = Date.now();
const log = (m) => console.log(`${new Date().toISOString()} [${Math.round((Date.now() - t0) / 1000)}s] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (b) => Buffer.from(b).toString('hex');
const DUST_UNIT = 10n ** 15n; // SPECK per DUST
const fmtDust = (speck) => (Number(speck / 10n ** 12n) / 1000).toFixed(3);
const fmtNight = (star) => (Number(star) / 1e6).toFixed(6).replace(/\.?0+$/, '');
const FEE_OVERHEAD = 300_000_000_000_000n; // 0.3 DUST of headroom on every fee estimate, as the hall-cage scripts use

// ---------- 2. config and refusals ----------
const NETWORKS = ['preprod', 'preview'];
export function config(env = process.env) {
  const network = (env.MIDNIGHT_NETWORK || 'preprod').toLowerCase();
  if (network === 'mainnet' || !NETWORKS.includes(network)) throw new Error(`refusing: MIDNIGHT_NETWORK must be preprod or preview (got ${network}). This tool never touches mainnet.`);
  const c = { network, node: env.MIDNIGHT_NODE_WS, indexer: env.MIDNIGHT_INDEXER, indexerWS: env.MIDNIGHT_INDEXER_WS, proofServer: env.MIDNIGHT_PROOF_SERVER || null };
  const missing = ['MIDNIGHT_NODE_WS', 'MIDNIGHT_INDEXER', 'MIDNIGHT_INDEXER_WS'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`not set: ${missing.join(', ')} (no public fallback; see references/endpoints.md)`);
  const scheme = { node: /^wss?:$/, indexer: /^https?:$/, indexerWS: /^wss?:$/, proofServer: /^https?:$/ };
  for (const k of ['node', 'indexer', 'indexerWS', 'proofServer']) {
    if (!c[k]) continue;
    let u; try { u = new URL(c[k]); } catch { throw new Error(`${k}: not a URL`); }
    if (!scheme[k].test(u.protocol)) throw new Error(`${k}: wrong scheme ${u.protocol}`);
    if (/mainnet/i.test(c[k])) throw new Error(`refusing: the ${k} endpoint names mainnet`);
    const named = u.hostname.toLowerCase().match(/preprod|preview|testnet|devnet/);
    if (named && named[0] !== network) throw new Error(`refusing: the ${k} host names ${named[0]} but MIDNIGHT_NETWORK is ${network}`);
  }
  return c;
}
export const describe = (c) => ['node', 'indexer', 'indexerWS', 'proofServer'].map((k) => `${k.padEnd(11)} ${c[k] ? new URL(c[k]).host : k === 'proofServer' ? '(in-process WASM prover)' : '-'}`);
const httpOf = (wsUrl) => { const u = new URL(wsUrl); u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:'; return u.toString().replace(/\/$/, ''); };

// ---------- 3. files: seed (600), state (600), address (644), lock ----------
const ROOT = path.resolve(process.env.DUST_WALLET_DIR || '.dust-wallet');
export function filesOf(name, root = ROOT) {
  if (!/^[a-z0-9_-]{1,32}$/i.test(name ?? '')) throw new Error('wallet name: 1-32 letters, digits, - or _');
  const dir = path.join(root, name);
  return { dir, seed: path.join(dir, 'seed'), state: path.join(dir, 'state.json'), address: path.join(dir, 'address'), lock: path.join(dir, 'lock') };
}
function readSeed(f) {
  if (!fs.existsSync(f.seed)) throw new Error(`no seed for this wallet: run init first`);
  const mode = fs.statSync(f.seed).mode & 0o777;
  if (mode & 0o077) throw new Error(`seed file mode is ${mode.toString(8)}; run chmod 600 on it first`);
  const s = fs.readFileSync(f.seed, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/i.test(s)) throw new Error('seed file is not 64 hex characters');
  return Uint8Array.from(Buffer.from(s, 'hex'));
}
export function makeSeed(f) {
  fs.mkdirSync(f.dir, { recursive: true, mode: 0o700 }); fs.chmodSync(f.dir, 0o700);
  if (fs.existsSync(f.seed)) return false; // never overwrite a seed
  fs.writeFileSync(f.seed, crypto.randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 });
  return true;
}
export function lock(f) {
  const take = () => fs.writeFileSync(f.lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  try { take(); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pid = Number(fs.readFileSync(f.lock, 'utf8'));
    let alive = false; try { process.kill(pid, 0); alive = true; } catch (k) { alive = k.code === 'EPERM'; }
    if (alive && pid !== process.pid) throw new Error(`wallet is in use by process ${pid}: one process per wallet. Wait for it, or stop it.`);
    fs.unlinkSync(f.lock); take();
  }
  const release = () => { try { if (fs.readFileSync(f.lock, 'utf8').trim() === String(process.pid)) fs.unlinkSync(f.lock); } catch { /* gone */ } };
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => process.exit(128 + ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1 })[sig]));
  return release;
}

// ---------- 4. wallet ----------
let SDK;
const sdk = async () => (SDK ??= {
  W: await import('@midnightntwrk/wallet-sdk'),
  L: await import('@midnightntwrk/ledger-v9'),
});
async function keysOf(f, network) {
  const { W } = await sdk();
  const seeds = W.WalletSeeds.fromMasterSeed(readSeed(f)); // account 0; Zswap, NightExternal and Dust keys at index 0
  const ks = W.createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, network);
  return { seeds, ks };
}
async function writeAddress(f, network) {
  const { ks } = await keysOf(f, network);
  fs.writeFileSync(f.address, `${ks.getBech32Address()}\n`, { mode: 0o644 });
}

const nightOf = (s, L) => s.unshielded.balances?.[L.unshieldedToken().raw] ?? 0n;
const dustOf = (s) => s.dust.balance(new Date());
const coinsOf = (s) => s.unshielded.availableCoins ?? [];
const registered = (s) => coinsOf(s).filter((c) => c.meta?.registeredForDustGeneration === true);
function balanceLine(s, L) {
  const per = Number(process.env.DUST_PER_CALL || 0.3);
  const dust = Number(fmtDust(dustOf(s)));
  return `tNIGHT ${fmtNight(nightOf(s, L))} · DUST ${dust.toFixed(3)} (about ${per > 0 ? Math.floor(dust / per) : '?'} calls at ${per} DUST) · NIGHT coins ${coinsOf(s).length}, registered for DUST ${registered(s).length}`;
}

async function reachable(c) {
  try {
    const r = await fetch(c.indexer, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '{ __typename }' }), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) { throw new Error(`cannot reach the indexer at ${new URL(c.indexer).host} (${e?.message ?? e}). Check MIDNIGHT_INDEXER, the network and any key it needs.`); }
}

export async function openWallet(f, c) {
  await reachable(c);
  const { W, L } = await sdk();
  const { WebSocket } = await import('ws');
  globalThis.WebSocket ??= WebSocket;
  const { seeds, ks } = await keysOf(f, c.network);
  const saved = fs.existsSync(f.state) ? JSON.parse(fs.readFileSync(f.state, 'utf8')) : null;
  const configuration = W.WalletFacade.resolveConfiguration({
    networkId: c.network,
    relayURL: new URL(c.node),
    indexerClientConnection: { indexerHttpUrl: c.indexer, indexerWsUrl: c.indexerWS },
    provers: { v9: c.proofServer ? { kind: 'server', url: new URL(c.proofServer) } : { kind: 'wasm' } },
    txHistoryStorage: new W.InMemoryTransactionHistoryStorage(W.WalletEntrySchema, W.mergeWalletEntries),
    costParameters: { additionalFeeOverhead: FEE_OVERHEAD, feeBlocksMargin: 5 },
  });
  const wallet = await W.WalletFacade.init({
    configuration,
    shielded: () => (saved ? W.ShieldedWallet(configuration).restore(saved.shielded) : W.ShieldedWallet(configuration).startWithSeed(seeds.shielded)),
    unshielded: () => (saved ? W.UnshieldedWallet(configuration).restore(saved.unshielded) : W.UnshieldedWallet(configuration).startWithPublicKey(W.PublicKey.fromKeyStore(ks))),
    dust: () => (saved ? W.DustWallet(configuration).restore(saved.dust) : W.DustWallet(configuration).startWithSeed(seeds.dust)),
  });
  await wallet.start(seeds);
  describe(c).forEach((l) => log(l));
  log(saved ? `restored from ${path.basename(f.state)} (saved ${saved.savedAt}), catching up…` : 'no saved state: full sync from genesis. Expect an hour or more; progress every 30 s.');
  const save = async () => {
    const tmp = `${f.state}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), shielded: await wallet.shielded.serializeState(), unshielded: await wallet.unshielded.serializeState(), dust: await wallet.dust.serializeState() }), { mode: 0o600 });
    fs.renameSync(tmp, f.state);
  };
  const prog = (p) => { if (!p || typeof p !== 'object') return '?'; const a = p.appliedIndex ?? p.appliedId, t = p.highestRelevantWalletIndex ?? p.highestTransactionId ?? p.highestIndex; return `${a ?? '?'}/${t ?? '?'}`; };
  let last = null;
  const sub = wallet.state().subscribe({ next: (x) => { last = x; }, error: (e) => log(`state stream error: ${inspect(e, { depth: 3 }).slice(0, 600)}`) });
  const tick = setInterval(() => log(last ? `syncing · shielded ${prog(last.shielded?.progress)} · unshielded ${prog(last.unshielded?.progress)} · dust ${prog(last.dust?.progress)}` : 'connecting…'), 30_000);
  // No progress for SYNC_STALL_MIN minutes (default 5) means an endpoint is down or refusing us: stop instead of hanging.
  const stallMs = Number(process.env.SYNC_STALL_MIN || 5) * 60_000;
  let seen = '', movedAt = Date.now(), stallTimer;
  const stalled = new Promise((_, reject) => { stallTimer = setInterval(() => {
    const now = last ? `${prog(last.shielded?.progress)} ${prog(last.unshielded?.progress)} ${prog(last.dust?.progress)}` : '';
    if (now !== seen) { seen = now; movedAt = Date.now(); }
    else if (Date.now() - movedAt > stallMs) reject(new Error(`no sync progress for ${stallMs / 60_000} min: the node or indexer is unreachable or refusing requests (check the endpoints, the network, your request quota). State so far is not saved; run balance again later.`));
  }, 10_000); });
  let synced;
  try {
    synced = await Promise.race([wallet.waitForSyncedState(), stalled]);
    // From genesis, the first "synced" can fire before the DUST wallet has caught up. Wait once more.
    if (!saved) { await sleep(5_000); synced = await Promise.race([wallet.waitForSyncedState(), stalled]); }
  } catch (e) { await wallet.stop().catch(() => {}); throw e; }
  finally { clearInterval(tick); clearInterval(stallTimer); sub.unsubscribe(); }
  if (synced.unshielded.address?.data && hex(synced.unshielded.address.data) !== String(ks.getAddress()).toLowerCase()) throw new Error('the saved state belongs to a different seed; move state.json away and sync again');
  await save();
  log(`synced · protocol ${synced.activeProtocolVersion} · ${balanceLine(synced, L)} · state saved (600)`);
  return { wallet, ks, save, synced, L, W };
}
const latest = async (wallet) => { const { firstValueFrom } = await import('rxjs'); return firstValueFrom(wallet.state()); };

// ---------- 5. submit once, never resend blind ----------
async function probeLanded(c, id) {
  const query = `{ transactions(offset:{identifier:"${id}"}) { hash block { height } ... on RegularTransaction { transactionResult { status } } } }`;
  try {
    const r = await fetch(c.indexer, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const t = (await r.json())?.data?.transactions?.[0];
    if (t?.block?.height == null) return null;
    return { hash: t.hash, height: t.block.height, status: t.transactionResult?.status ?? '?' };
  } catch { return null; }
}
async function waitLanded(c, id, ms) { const end = Date.now() + ms; for (;;) { const x = await probeLanded(c, id); if (x || Date.now() > end) return x; await sleep(6_000); } }

function sendRaw(c, extrinsicHex, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const ws = new globalThis.WebSocket(c.node); let done = false;
    const settle = (fn, v) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch { /* gone */ } fn(v); };
    const lost = (m) => settle(reject, Object.assign(new Error(m), { transport: true }));
    const timer = setTimeout(() => lost(`no reply in ${timeoutMs / 1000}s`), timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'author_submitExtrinsic', params: [extrinsicHex] }));
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m?.id !== 1) return;
      if (m.error) settle(reject, Object.assign(new Error(`node refused: ${m.error.code} ${m.error.message}`), { code: m.error.code }));
      else settle(resolve, String(m.result)); };
    ws.onerror = () => lost('websocket error during submit');
    ws.onclose = (ev) => lost(`socket closed before the reply (${ev?.code ?? '?'})`);
  });
}
export async function submitOnce(c, w, tx) {
  const bytes = tx.serialize();
  const id = String(w.L.Transaction.deserialize('signature', 'proof', 'binding', bytes).identifiers().at(-1));
  const { ApiPromise, HttpProvider } = await import('@polkadot/api');
  const api = await ApiPromise.create({ provider: new HttpProvider(httpOf(c.node)), noInitWarn: true });
  let xt;
  try { xt = api.tx.midnight.sendMnTransaction('0x' + hex(bytes)).toHex(); }
  catch (e) { await w.wallet.revert(tx).catch(() => {}); throw new Error(`could not encode the transaction (nothing sent): ${e?.message ?? e}`); }
  finally { await api.disconnect().catch(() => {}); }
  log(`submitting ${id.slice(0, 16)}… once`);
  try { await sendRaw(c, xt); return id; }
  catch (e) {
    if (/\b1013\b|already imported/i.test(String(e.message))) { log('node: already in the pool, so the first send worked'); return id; }
    if (e.transport) {
      log(`${e.message}. NOT resending; asking the indexer for 90 s`);
      if (await waitLanded(c, id, 90_000)) return id;
      throw new Error(`outcome unknown for ${id}: it may still land. Run balance before any retry; do not resend.`);
    }
    await w.wallet.revert(tx).catch(() => {});
    throw new Error(`${e.message}. Refused before the pool: nothing spent.`);
  }
}

// ---------- 6. commands ----------
export async function cmdDust(f, c, send) {
  const release = lock(f);
  const w = await openWallet(f, c);
  try {
    let s = w.synced;
    if (nightOf(s, w.L) === 0n) throw new Error('no tNIGHT yet: fund the address in the address file from the faucet, then run balance until it shows');
    const todo = coinsOf(s).filter((x) => x.meta?.registeredForDustGeneration !== true);
    if (!todo.length) log('all NIGHT coins are already registered for DUST: nothing to send');
    else {
      const { fee } = await w.wallet.estimateRegistration(todo);
      log(`${todo.length} NIGHT coin(s) not registered · registration fee about ${fmtDust(fee)} DUST, paid from the DUST those coins generate first`);
      if (!send) { log('dry run: nothing sent. Run again with --send to register.'); return; }
      const register = () => w.wallet.registerNightUtxosForDustGeneration(todo, w.ks.getPublicKey(), (d) => w.ks.signDataAsync(d));
      const recipe = await register().catch(async (e) => {
        if (!w.W.isInsufficientDustForFeeError(e) || e.estimate?._tag !== 'Reachable') throw e;
        const ms = Number(e.estimate.seconds) * 1000 + 60_000;
        log(`not enough DUST generated for the fee yet; waiting up to ${Math.round(ms / 1000)} s`);
        await w.wallet.waitForGeneratedDust(todo, e.fee, { timeoutMs: ms });
        return register();
      });
      const tx = await w.wallet.finalizeRecipe(recipe);
      const id = await submitOnce(c, w, tx);
      const landed = await waitLanded(c, id, 240_000);
      log(`TX dust-register · id ${id.slice(0, 16)}… · block ${landed?.height ?? '?'} · ${landed?.status ?? 'not on the indexer after 4 min; run balance later'}`);
      await w.save();
    }
    if (!send && todo.length) return;
    const limit = Number(process.env.DUST_WAIT_MIN || 30) * 60_000, end = Date.now() + limit;
    log('waiting for spendable DUST…');
    for (;;) {
      s = await latest(w.wallet);
      if (s.isSynced && dustOf(s) > 0n) break;
      if (Date.now() > end) throw new Error(`no spendable DUST after ${limit / 60_000} min; run balance later (generation is gradual)`);
      await sleep(10_000);
    }
    await w.save();
    log(`DUST READY · ${balanceLine(s, w.L)}`);
  } finally { await w.wallet.stop().catch(() => {}); release(); }
}

function selfTest() {
  let ok = 0, failed = 0;
  const t = (name, fn) => { try { fn(); ok++; console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); } };
  const refuses = (env) => { try { config(env); return false; } catch { return true; } };
  const GOOD = { MIDNIGHT_NODE_WS: 'wss://node.preprod.example.org/', MIDNIGHT_INDEXER: 'https://indexer.preprod.example.org/api/v4/graphql', MIDNIGHT_INDEXER_WS: 'wss://indexer.preprod.example.org/api/v4/graphql/ws' };
  t('preprod endpoints accepted', () => { if (refuses(GOOD)) throw new Error('refused'); });
  t('MIDNIGHT_NETWORK=mainnet refused', () => { if (!refuses({ ...GOOD, MIDNIGHT_NETWORK: 'mainnet' })) throw new Error('accepted'); });
  t('mainnet node host refused', () => { if (!refuses({ ...GOOD, MIDNIGHT_NODE_WS: 'wss://rpc.mainnet.example.org/' })) throw new Error('accepted'); });
  t('preview host on preprod refused', () => { if (!refuses({ ...GOOD, MIDNIGHT_INDEXER: 'https://indexer.preview.example.org/' })) throw new Error('accepted'); });
  t('missing endpoint refused', () => { if (!refuses({ MIDNIGHT_NODE_WS: GOOD.MIDNIGHT_NODE_WS })) throw new Error('accepted'); });
  t('http node refused (must be ws/wss)', () => { if (!refuses({ ...GOOD, MIDNIGHT_NODE_WS: 'https://node.preprod.example.org/' })) throw new Error('accepted'); });
  const fakeId = 'night' + 'preprod' + 'A'.repeat(32);
  t('mask: query-string key', () => { const m = mask(`wss://x.example/?project_id=${'z'.repeat(20)}&a=1`); if (/z{20}/.test(m)) throw new Error(m); });
  t('mask: bare project id', () => { if (mask(`id ${fakeId}`).includes('A'.repeat(32))) throw new Error('kept'); });
  t('mask: bech32 address', () => { const a = 'mn_addr_preprod1' + 'q'.repeat(50); if (mask(a).includes('q'.repeat(50))) throw new Error('kept'); });
  t('mask: user:pass@host', () => { if (mask('https://me:' + 'p'.repeat(12) + '@h.example/').includes('p'.repeat(12))) throw new Error('kept'); });
  t('mask: key in a URL path', () => { const m = mask('disconnected from wss://rpc.example.org/v1/' + 'K'.repeat(20) + ': 1006'); if (m.includes('KKKK') || !m.includes('rpc.example.org')) throw new Error(m); });
  t('describe() shows hosts only', () => { const d = describe(config({ ...GOOD, MIDNIGHT_NODE_WS: GOOD.MIDNIGHT_NODE_WS + '?project_id=' + 'k'.repeat(16) })).join(' '); if (d.includes('kkkk') || d.includes('/api/')) throw new Error(d); });
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'dust-wallet-test-'));
  const f = filesOf('t1', tmp);
  t('seed: written 600 in a 700 folder', () => { makeSeed(f); const m = fs.statSync(f.seed).mode & 0o777, d = fs.statSync(f.dir).mode & 0o777; if (m !== 0o600 || d !== 0o700) throw new Error(`${m.toString(8)} ${d.toString(8)}`); });
  t('seed: never overwritten', () => { const a = fs.readFileSync(f.seed, 'utf8'); if (makeSeed(f) !== false || fs.readFileSync(f.seed, 'utf8') !== a) throw new Error('overwritten'); });
  t('seed: refused when group/other can read it', () => { fs.chmodSync(f.seed, 0o644); try { readSeed(f); throw new Error('accepted'); } catch (e) { if (e.message === 'accepted') throw e; } finally { fs.chmodSync(f.seed, 0o600); } });
  t('lock: second holder refused', () => { fs.writeFileSync(f.lock, String(process.ppid)); try { lock(f); throw new Error('accepted'); } catch (e) { if (!/in use/.test(e.message)) throw e; } finally { fs.unlinkSync(f.lock); } });
  t('lock: stale lock taken over', () => { fs.writeFileSync(f.lock, '999999'); const r = lock(f); r(); if (fs.existsSync(f.lock)) throw new Error('not released'); });
  t('wallet name checked', () => { try { filesOf('../x'); throw new Error('accepted'); } catch (e) { if (e.message === 'accepted') throw e; } });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`self-test: ${ok} ok, ${failed} failed`);
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, name, ...flags] = process.argv.slice(2);
try {
  if (cmd === 'self-test') process.exitCode = selfTest();
  else if (cmd === 'init' || cmd === 'address') {
    const f = filesOf(name), network = config({ ...process.env, MIDNIGHT_NODE_WS: 'wss://x', MIDNIGHT_INDEXER: 'https://x', MIDNIGHT_INDEXER_WS: 'wss://x' }).network;
    if (cmd === 'init') log(makeSeed(f) ? `new seed written (mode 600) in ${path.relative(process.cwd(), f.dir) || '.'}` : 'seed already exists: kept, not overwritten');
    await writeAddress(f, network);
    log(`${network} funding address (unshielded, for tNIGHT) written to ${path.relative(process.cwd(), f.address)}. Paste it into the ${network} faucet.`);
  } else if (cmd === 'balance' || cmd === 'sync') {
    const f = filesOf(name), c = config(), release = lock(f);
    const w = await openWallet(f, c);
    await w.wallet.stop(); release();
  } else if (cmd === 'dust') {
    await cmdDust(filesOf(name), config(), flags.includes('--send') || process.env.LIVE === '1');
  } else {
    console.log('usage: dust-wallet.mjs init|address|balance|dust <name> [--send] | self-test');
    process.exitCode = 2;
  }
} catch (e) {
  log(`FAILED: ${e?.message ?? e}`);
  if (process.env.DEBUG) console.error(inspect(e, { depth: 4 }).slice(0, 2000));
  process.exitCode = 1;
}
if (cmd !== 'self-test') process.exit();
}
