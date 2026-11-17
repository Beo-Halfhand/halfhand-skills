#!/usr/bin/env node
// selftest.mjs: checks every rule, both ways in (inside a process, and as a pipe), the log files, the import
// contract and count-copies. No network. Every fake secret is built at run time, so secret scanners have nothing
// to flag in this file.
//   node selftest.mjs        expect "selftest: N ok, 0 failed"
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { redact, redactDeep, makeRedactor, loadExtra, stripAnsi } from './redact.mjs';
import { maskPipe, createMaskTransform } from './mask-pipe.mjs';
import { countIn } from './count-copies.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIPE = path.join(HERE, 'mask-pipe.mjs'), STDIO = path.join(HERE, 'mask-stdio.mjs'), COUNT = path.join(HERE, 'count-copies.mjs');
const TEMPS = []; const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-logs-')); TEMPS.push(d); return d; };
let ok = 0, failed = 0;
const check = (name, cond, extra = '') => { cond ? ok++ : failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !extra ? '' : `  (${shown(extra)})`}`); };
const rep = (s, n) => s.repeat(n);
const shown = (s) => String(s).replace(/[A-Za-z0-9]{12,}/g, '<long>').slice(0, 200);   // a failure never prints a fake key whole
const pipe = (input, args = [], env = {}) => spawnSync(process.execPath, [PIPE, ...args], { input, encoding: 'utf8', env: { ...process.env, ...env } });
const node = (code, env = {}, input) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, ...env }, input });

// fakes, built here
const PID = ['pre', 'prod'].join('') + rep('Zq7', 10) + 'Ab';              // network-prefixed project id (32 after the network)
const PID2 = 'xy' + ['pre', 'view'].join('') + rep('Q7', 16);              // with a short service prefix
const GH = ['gh', 'p_'].join('') + rep('Zx9', 12);
const AI = ['sk', 'ant', 'api03', rep('A', 24)].join('-');
const PAY = ['sk', 'live', 'ABCDEFGHIJKLMNOP1234'].join('_');
const JWT = ['ey' + 'JhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'c2lnbmF0dXJlMTIz'].join('.');
const HEX = rep('a1b2c3d4', 8);
const GEN = rep('Kp4m', 7);                                                // 28 chars, upper+lower+digit, no prefix
const LONGQ = rep('z9', 10);                                               // 20-char value under an ordinary query name
const NM = ['API', 'KEY'].join('_');
const PW = 'hunter22x9';
const HOME_EX = ['', 'Users', 'someone'].join('/') + '/projects/app.log';
const WORDS = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
const SECRETS = [PID, PID2, GH, AI, PAY, JWT, HEX, GEN, LONGQ, PW, 'someone'];
const leaks = (s) => SECRETS.filter((v) => s.includes(v));

// ── the rules, one by one ──
const cases = [
  ['url-query: a key in a websocket URL, host kept', `RPC-CORE: disconnected from wss://rpc.example.com/?project_id=${PID}: 1000:: Normal Closure`, `RPC-CORE: disconnected from wss://rpc.example.com/?project_id=<masked>: 1000:: Normal Closure`],
  ['url-query: any query name with a long value', `https://h.example.com/x?a=1&sig=${LONGQ}#frag`, `https://h.example.com/x?a=1&sig=<masked>#frag`],
  ['url-query: percent-encoded', `https://h.example.com/x%3Fproject_id%3D${LONGQ}%26a%3D1`, `https://h.example.com/x%3Fproject_id%3D<masked>%26a%3D1`],
  ['url-query: a short value under a secret name', 'GET /v0?token=abc&page=2', 'GET /v0?token=<masked>&page=2'],
  ['url-password', `https://deploy:${PW}@git.example.com/repo`, 'https://deploy:<masked>@git.example.com/repo'],
  ['name-value: JSON', `{"project_id": "${LONGQ}", "ok": false}`, '{"project_id": "<masked>", "ok": false}'],
  ['name-value: an env line', `${NM}=${GEN}`, `${NM}=<masked>`],
  ['name-value: MY_SERVICE_TOKEN: value', 'MY_SERVICE_TOKEN: hunter22x9', 'MY_SERVICE_TOKEN: <masked>'],
  ['name-value + auth header: Authorization: Bearer …', `Authorization: Bearer ${GH}`, 'Authorization: <masked>'],
  ['auth-header alone', `curl -H "X: Bearer ${LONGQ}x"`, 'curl -H "X: Bearer <masked>"'],
  ['known-shape: code host token by its prefix', `pushed with ${GH} ok`, 'pushed with <masked> ok'],
  ['known-shape: AI provider key', `key ${AI}`, 'key <masked>'],
  ['known-shape: payment-style key', `Error: 401 for ${PAY}`, 'Error: 401 for <masked>'],
  ['known-shape: JSON web token', `jwt ${JWT} end`, 'jwt <masked> end'],
  ['known-shape: 64 hex (a private key or seed)', `key 0x${HEX} loaded`, 'key <masked> loaded'],
  ['known-shape: a bare network-prefixed project id', `Error: invalid project token ${PID}`, 'Error: invalid project token <masked>'],
  ['known-shape: with a short service prefix', `id ${PID2}.`, 'id <masked>.'],
  ['catch-all: a long mixed token with no known shape', `using ${GEN} for this run`, 'using <masked> for this run'],
  ['seed-words: 12 short words in a row', `restore: ${WORDS}`, 'restore: <masked> (words)'],
  ['home-path: whose machine this is', `wrote ${HOME_EX}`, 'wrote ~/projects/app.log'],
  ['home-path: Windows', 'C:\\Users\\someone\\app\\x.log', '~\\app\\x.log'],
];
for (const [name, input, want] of cases) { const got = redact(input); check(name, got === want, got); }

const kept = [
  'commit 3f2a9c1e5b7d4f6a8c0e2b4d6f8a0c2e4b6d8f0a done', 'pip install requests==2.31.0', 'Password: ',
  'GET https://example.com/a/b?page=2&sort=asc 200', '13:05:55 build step 41 done', '~/projects/app/src/index.ts:42:7',
  'prove "clean>=10 disputes=0 active>=30"', 'tx 0087cb60 · block 3461175 · SucceedEntirely', 'job 6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b finished',
  'the agent went to the market to buy some fish and sold it later today', 'mailto someone@example.com', 'tokens: 5 used', '',
  `already masked: ?project_id=<masked> and ${NM}=<masked>`,
];
check('ordinary lines come back unchanged (git sha, package, prompt, plain URL, time, path, uuid, prose, a count, masked text)', kept.every((l) => redact(l) === l), kept.find((l) => redact(l) !== l));
check('masking twice changes nothing more', cases.every(([, i]) => redact(redact(i)) === redact(i)));
check('every fake value is gone after masking', cases.every(([, i]) => !leaks(redact(i)).length || i.includes('someone') && !redact(i).includes('someone')));

// ── colours, carriage returns, private keys ──
check('colours kept on a line with nothing to mask', redact('\x1b[32mok\x1b[0m build done') === '\x1b[32mok\x1b[0m build done');
check('a key split by a colour code is still caught (that line loses its colours)', redact(`id=\x1b[1m${PID.slice(0, 3)}\x1b[0m${PID.slice(3)}`) === 'id=<masked>');
check('ansi: strip removes escape codes everywhere', makeRedactor({ ansi: 'strip' }).text('\x1b[31mred\x1b[0m') === 'red' && stripAnsi('\x1b]0;title\x07x') === 'x');
check('\\r redraws: each piece masked, line endings kept', redact(`connecting…\rfailed ?key=${PID}\r\n`) === 'connecting…\rfailed ?key=<masked>\r\n');
const pem = ['-----BEGIN OPENSSH ', 'PRIVATE', ' KEY-----'].join('') + '\nAAAAB3Nza\nmore\n' + ['-----END OPENSSH ', 'PRIVATE', ' KEY-----'].join('') + '\nafter';
check('private-key: every line of the block, text after it kept', redact(pem) === '<masked> (private key)\n<masked> (private key)\n<masked> (private key)\n<masked> (private key)\nafter', redact(pem));
check('makeRedactor counts the lines it changed and names the rules', (() => { const r = makeRedactor(); r.text(`a ?token=${PID}\nb\nc ${GH}`); return r.changed === 2 && r.hits['url-query'] === 1 && r.hits['known-shape'] === 1; })());

// ── options ──
check('generic: false turns the catch-all off', redact(`using ${GEN}`, { generic: false }) === `using ${GEN}`);
check('homePaths: false keeps paths', redact(`x ${HOME_EX}`, { homePaths: false }) === `x ${HOME_EX}`);
check('seedWords: false keeps word runs', redact(WORDS, { seedWords: false }) === WORDS);
check('seed-words: a repeated word is not a phrase', redact(rep('word ', 30).trim()) === rep('word ', 30).trim());
check('mark: your own placeholder', redact(`?token=${PID}`, { mark: '***' }) === '?token=***');
check('exact: a secret with no shape and no name is masked when you name it', redact('the password is tulip4242', { secrets: ['tulip4242'] }) === 'the password is <masked>');
check('exact: values under 6 characters are ignored (too risky to mask everywhere)', redact('a b c abc', { secrets: ['abc'] }) === 'a b c abc');
check('extra: your own terms, case-insensitive', redact('ssh my-desk-box and BUILD-7.corp', { extra: loadExtra('# hosts\nmy-desk-box\nbuild-\\d+\\.corp\n') }) === 'ssh <masked> and <masked>');
check('extra: a bad line says which line, not what it says', (() => { try { loadExtra('ok\n(unclosed secretword\n'); return false; } catch (e) { return /line 2/.test(e.message) && !e.message.includes('secretword'); } })());
check('redactDeep: strings inside objects and arrays', JSON.stringify(redactDeep({ a: [`?token=${PID}`, 3], b: { c: GH }, d: null })) === JSON.stringify({ a: ['?token=<masked>', 3], b: { c: '<masked>' }, d: null }));

// ── the pipe, as a command ──
let r = pipe(`one ?token=${PID}\nplain\npartial ${GH}`, ['--count']);
check('pipe: masks stdin to stdout, keeps a last line with no newline', r.status === 0 && r.stdout === 'one ?token=<masked>\nplain\npartial <masked>', r.stdout);
check('pipe: --count prints masked-lines=N on stderr, never a value', r.stderr.trim() === 'masked-lines=2' && !leaks(r.stderr).length);
check('pipe: --cr-to-nl turns redraws into lines', pipe('connecting…\rfailed ?key=' + 'abc' + '123\n', ['--cr-to-nl']).stdout === 'connecting…\nfailed ?key=<masked>\n');
check('pipe: --strip-ansi', pipe('\x1b[31mred\x1b[0m\n', ['--strip-ansi']).stdout === 'red\n');
const d0 = tmp(); fs.writeFileSync(path.join(d0, 'extra'), 'my-desk-box\n'); fs.writeFileSync(path.join(d0, 'bad'), '(unclosed\n');
check('pipe: --extra and SAFE_LOGS_EXTRA', pipe('ssh my-desk-box\n', ['--extra', path.join(d0, 'extra')]).stdout === 'ssh <masked>\n' && pipe('ssh my-desk-box\n', [], { SAFE_LOGS_EXTRA: path.join(d0, 'extra') }).stdout === 'ssh <masked>\n');
r = pipe(`x ?token=${PID}\n`, ['--extra', path.join(d0, 'bad')]);
check('pipe: a bad extra-terms file stops it before anything is written (exit 2)', r.status === 2 && r.stdout === '' && /line 1/.test(r.stderr));
check('pipe: a missing extra-terms file stops it too', pipe('x\n', [], { SAFE_LOGS_EXTRA: path.join(d0, 'nope') }).status === 2);
r = pipe('login with tulip4242 now\n', ['--secret-vars', 'FAKE_PW,FAKE_SHORT,FAKE_MISSING'], { FAKE_PW: 'tulip4242', FAKE_SHORT: 'abc' });
check('pipe: --secret-vars masks those values; names it couldn\'t use are listed, values never', r.stdout === 'login with <masked> now\n' && /FAKE_SHORT, FAKE_MISSING/.test(r.stderr) && !r.stderr.includes('abc') && !r.stderr.includes('tulip'));
check('pipe: SAFE_LOGS_GENERIC=0 and --no-generic', pipe(`${GEN}\n`, [], { SAFE_LOGS_GENERIC: '0' }).stdout === `${GEN}\n` && pipe(`${GEN}\n`, ['--no-generic']).stdout === `${GEN}\n`);
check('pipe: an unknown option exits 2 and writes nothing', (() => { const x = pipe('a\n', ['--bogus']); return x.status === 2 && x.stdout === ''; })());
const split = spawnSync('sh', ['-c', `printf 'a ?project_id=${PID.slice(0, 14)}'; sleep 0.3; printf '${PID.slice(14)} b\\n'; sleep 0.3; printf 'c ${GH.slice(0, 9)}'; sleep 0.3; printf '${GH.slice(9)}\\n' | cat`], { encoding: 'utf8' });
r = spawnSync('sh', ['-c', `{ printf 'a ?project_id=${PID.slice(0, 14)}'; sleep 0.3; printf '${PID.slice(14)} b\\n'; sleep 0.3; printf 'c ${GH.slice(0, 9)}'; sleep 0.3; printf '${GH.slice(9)}\\n'; } | "${process.execPath}" "${PIPE}"`], { encoding: 'utf8' });
check('pipe: a key split across two reads is joined before matching', split.status === 0 && r.stdout === 'a ?project_id=<masked> b\nc <masked>\n', r.stdout);
r = pipe(rep('word ', 20000) + `?token=${PID} end\n`);
check('pipe: a line over 64 KB with no newline still gets masked', !r.stdout.includes(PID) && r.stdout.endsWith('?token=<masked> end\n') && r.stdout.length > 100000);
check('pipe: a private key block across reads', (() => { const x = spawnSync('sh', ['-c', `{ printf '%s\\n' '${pem.split('\n').slice(0, 2).join("' '")}'; sleep 0.3; printf '%s\\n' '${pem.split('\n').slice(2).join("' '")}'; } | "${process.execPath}" "${PIPE}"`], { encoding: 'utf8' }); return x.stdout.split('\n').filter((l) => l === '<masked> (private key)').length === 4 && x.stdout.includes('after'); })());
r = spawnSync('sh', ['-c', `yes 'line ?token=abcdef' | head -n 200000 | "${process.execPath}" "${PIPE}" | head -n 2`], { encoding: 'utf8' });
check('pipe: a reader that stops early (| head) is not an error', r.status === 0 && r.stdout === 'line ?token=<masked>\nline ?token=<masked>\n' && !/EPIPE|Error/.test(r.stderr), r.stderr);
const big = Buffer.alloc(5 * 1024 * 1024, 'build output line 42 ok\n'); const t0 = Date.now();
r = spawnSync(process.execPath, [PIPE], { input: big, maxBuffer: 20 * 1024 * 1024 });
check(`pipe: 5 MB in ${((Date.now() - t0) / 1000).toFixed(1)} s, byte for byte when nothing needs masking`, r.status === 0 && Buffer.compare(r.stdout, big) === 0 && Date.now() - t0 < 20_000);

// ── the pipe, as a log file ──
{
  const d = tmp(), logs = path.join(d, 'logs');
  pipe(`one ?token=${PID}\n\x1b[31mtwo\x1b[0m\n\nthree\rfour\n`, ['--log', logs, 'tabA']);
  const day = (() => { const x = new Date(); return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}`; })();
  const f = path.join(logs, `tabA-${day}.log`);
  check('log: <dir>/<name>-YYYYMMDD.log (local date)', fs.existsSync(f));
  check('log: masked, colours and blank lines dropped, \\r split', fs.existsSync(f) && fs.readFileSync(f, 'utf8') === 'one ?token=<masked>\ntwo\nthree\nfour\n', fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  const mode = (p) => fs.statSync(p).mode & 0o777;
  check('log: file 600, folder 700', fs.existsSync(f) && mode(f) === 0o600 && mode(logs) === 0o700);
  pipe('more\n', ['--log', logs, 'tabA']);
  check('log: appends', fs.readFileSync(f, 'utf8').endsWith('four\nmore\n'));
  pipe('x\n', ['--log', logs, '../we/ird name']);
  check('log: a name can\'t leave the folder', fs.existsSync(path.join(logs, `___we_ird_name-${day}.log`)) && fs.readdirSync(d).length === 1);
  pipe(rep('line of build output here\n', 6000), ['--log', logs, 'big', '--max-mb', '0.05']);
  const parts = fs.readdirSync(logs).filter((x) => x.startsWith(`big-${day}`));
  check(`log: past --max-mb it rolls (${parts.length} parts), every part 600`, parts.length >= 2 && parts.every((x) => mode(path.join(logs, x)) === 0o600) && parts.includes(`big-${day}.2.log`));
  r = pipe(`x ?token=${PID}\n`, ['--log', path.join(d, 'bad'), 'b', '--extra', path.join(d0, 'bad')]);
  check('log: bad options → exit 2 and no file at all', r.status === 2 && !fs.existsSync(path.join(d, 'bad')));
  r = pipe('x\n', ['--log', '/dev/null/nope', 'b']);
  check('log: a folder it can\'t make → exit 2, nothing written', r.status === 2);
}

// ── the pipe, imported ──
{
  const chunks = [`a ?token=${PID.slice(0, 10)}`, `${PID.slice(10)}\nb `, `${GH}\n`];
  let out = ''; const w = new Writable({ write(c, _e, cb) { out += c; cb(); } });
  const res = await maskPipe(Readable.from(chunks), w);
  check('import: maskPipe(readable, writable) masks across chunks and reports a count', out === 'a ?token=<masked>\nb <masked>\n' && res.masked === 2, out);
  const t = createMaskTransform({ crToNl: true }); let o2 = ''; t.on('data', (c) => { o2 += c; });
  await new Promise((res2) => { t.on('end', res2); t.end(`x\ry ?key=${PID}`); });
  check('import: createMaskTransform with options', o2 === 'x\ny ?key=<masked>');
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import ${JSON.stringify(PIPE)}; console.log('imported');`], { stdio: ['pipe', 'pipe', 'pipe'] });
  let co = ''; child.stdout.on('data', (c) => { co += c; });
  const code = await new Promise((res3) => { const tm = setTimeout(() => { child.kill(); res3('hung'); }, 5000); child.on('close', (c) => { clearTimeout(tm); res3(c); }); });
  check('import: importing mask-pipe.mjs runs nothing and leaves stdin alone (no hang)', code === 0 && co === 'imported\n', String(code));
}

// ── inside a process: mask-stdio ──
{
  const lib = path.join(tmp(), 'chatty-lib.mjs');   // a library that logs on its own
  fs.writeFileSync(lib, `export function connect() { console.error('RPC-CORE: disconnected from wss://rpc.example.com/?project_id=' + process.env.FAKE_PID + ': 1006'); }\n`);
  r = node(`import ${JSON.stringify(STDIO)}; const { connect } = await import(${JSON.stringify(lib)}); connect(); console.log('token=' + process.env.FAKE_PID); process.stdout.write(Buffer.from('buf ${GH}\\n'));`, { FAKE_PID: PID });
  check('stdio: a library\'s console.error, console.log and Buffer writes are masked', r.status === 0 && !leaks(r.stdout + r.stderr).length && r.stderr.includes('wss://rpc.example.com/?project_id=<masked>') && r.stdout.includes('buf <masked>'), r.stdout + r.stderr);
  r = node(`import ${JSON.stringify(STDIO)}; process.stdout.write(Buffer.from([0xff, 0x0f, 0x80, 0xc3]));`);
  check('stdio: bytes that aren\'t text go through untouched', r.status === 0 && Buffer.compare(Buffer.from(r.stdout, 'latin1'), Buffer.from([0xff, 0x0f, 0x80, 0xc3])) === 0 || spawnSync(process.execPath, ['--input-type=module', '-e', `import ${JSON.stringify(STDIO)}; process.stdout.write(Buffer.from([0xff, 0x0f, 0x80, 0xc3]));`]).stdout.equals(Buffer.from([0xff, 0x0f, 0x80, 0xc3])));
  const direct = `import fs from 'node:fs'; import ${JSON.stringify(STDIO)}; fs.writeSync(1, 'direct ?token=' + process.env.FAKE_PID + '\\n');`;
  r = node(direct, { FAKE_PID: PID });
  check('stdio: a write straight to fd 1 is NOT caught (the documented limit)', r.stdout.includes(PID));
  r = spawnSync('sh', ['-c', `"${process.execPath}" --input-type=module -e "$CODE" | "${process.execPath}" "${PIPE}"`], { encoding: 'utf8', env: { ...process.env, CODE: direct, FAKE_PID: PID } });
  check('stdio: …and the pipe catches it', r.stdout === 'direct ?token=<masked>\n', r.stdout);
  r = node(`import { safeDestination } from ${JSON.stringify(STDIO)}; const log = { dest: safeDestination() }; log.dest.write('{"level":30,"msg":"url ?token=' + process.env.FAKE_PID + '"}\\n');`, { FAKE_PID: PID });
  check('stdio: safeDestination() routes a logger through the mask', r.stdout === '{"level":30,"msg":"url ?token=<masked>"}\n', r.stdout);
  r = node(`import ${JSON.stringify(STDIO)}; console.log('pw tulip4242 and ?token=' + process.env.FAKE_PID);`, { FAKE_PID: PID, SAFE_LOGS_SECRET_VARS: 'FAKE_TULIP', FAKE_TULIP: 'tulip4242' });
  check('stdio: SAFE_LOGS_SECRET_VARS', r.stdout === 'pw <masked> and ?token=<masked>\n', r.stdout);
  r = node(`import ${JSON.stringify(STDIO)}; console.log('?token=' + process.env.FAKE_PID);`, { FAKE_PID: PID, SAFE_LOGS_EXTRA: path.join(d0, 'bad') });
  check('stdio: broken options → default rules still on, one note on stderr', r.stdout === '?token=<masked>\n' && /using the default rules only/.test(r.stderr));
  r = node(`import ${JSON.stringify(STDIO)}; import ${JSON.stringify(path.join(HERE, 'mask-stdio.mjs?again'))}; console.log('?token=x1y2z3');`);
  check('stdio: importing twice wraps once', r.stdout === '?token=<masked>\n', r.stdout);
}

// ── shell: run a whole script through the pipe, keeping its exit code (references/shell.md) ──
{
  const d = tmp(), sh = path.join(d, 'job.sh');
  fs.writeFileSync(sh, `#!/usr/bin/env bash
if [ -z "\${SAFE_LOGS_PIPED:-}" ]; then
  export SAFE_LOGS_PIPED=1
  "$0" "$@" 2>&1 | "${process.execPath}" "${PIPE}"
  exit "\${PIPESTATUS[0]}"
fi
echo "connecting to wss://rpc.example.com/?project_id=$FAKE_PID"
echo "oops ?token=$FAKE_PID" >&2
exit 7
`, { mode: 0o755 });
  r = spawnSync(sh, [], { encoding: 'utf8', env: { ...process.env, FAKE_PID: PID } });
  check('shell: rerun-through-the-pipe keeps the exit code and masks stdout and stderr', r.status === 7 && !r.stdout.includes(PID) && r.stdout.includes('?project_id=<masked>') && r.stdout.includes('oops ?token=<masked>'), `${r.status} ${r.stdout}`);
}

// ── count-copies ──
{
  const d = tmp(); fs.mkdirSync(path.join(d, 'logs')); fs.mkdirSync(path.join(d, '.git'));
  fs.writeFileSync(path.join(d, 'logs', 'a.log'), `x ${PID}\ny ${PID}\nz ${PID.slice(0, 15)}…\n`);
  fs.writeFileSync(path.join(d, 'logs', 'clean.log'), 'nothing here\n');
  fs.writeFileSync(path.join(d, '.git', 'objects'), PID);
  const envDir = tmp(); fs.writeFileSync(path.join(envDir, 'app.env'), `# app\nexport FAKE_PID="${PID}"\n`);
  r = spawnSync(process.execPath, [COUNT, '--var', 'FAKE_PID', d], { encoding: 'utf8', env: { ...process.env, FAKE_PID: PID } });
  check('count-copies: counts whole and cut-off copies, exit 1', r.status === 1 && /2 whole ·\s+3 first-12 .*a\.log/.test(r.stdout) && /2 whole cop/.test(r.stdout), r.stdout);
  check('count-copies: never prints the value or a line of the file; skips .git', !r.stdout.includes(PID.slice(0, 12)) && !r.stderr.includes(PID.slice(0, 12)) && !r.stdout.includes('objects') && !r.stdout.includes('clean.log'));
  r = spawnSync(process.execPath, [COUNT, '--var', 'FAKE_PID', '--env-file', path.join(envDir, 'app.env'), path.join(d, 'logs')], { encoding: 'utf8', env: { ...process.env, FAKE_PID: '' } });
  check('count-copies: reads the value from an env file (export, quotes)', r.status === 1 && /2 whole cop/.test(r.stdout));
  check('count-copies: no copies → exit 0', spawnSync(process.execPath, [COUNT, '--var', 'FAKE_PID', path.join(d, 'logs', 'clean.log')], { encoding: 'utf8', env: { ...process.env, FAKE_PID: PID } }).status === 0);
  check('count-copies: an unset or short value → exit 2', spawnSync(process.execPath, [COUNT, '--var', 'NOPE_NOT_SET', d], { encoding: 'utf8' }).status === 2 && spawnSync(process.execPath, [COUNT, '--var', 'FAKE_S', d], { encoding: 'utf8', env: { ...process.env, FAKE_S: 'short' } }).status === 2);
  check('count-copies: countIn on a Buffer', JSON.stringify(countIn(Buffer.from(`${PID}${PID}`), PID)) === '{"whole":2,"head":2}');
}

for (const d of TEMPS) fs.rmSync(d, { recursive: true, force: true });
console.log(`\nselftest: ${ok} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
