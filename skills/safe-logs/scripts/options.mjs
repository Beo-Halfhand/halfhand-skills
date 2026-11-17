// options.mjs: masking options from the environment, shared by mask-stdio.mjs and mask-pipe.mjs.
//
//   SAFE_LOGS_EXTRA=<file>          your own terms, one regular expression per line (keep the file outside any repo)
//   SAFE_LOGS_SECRET_VARS=A,B       names of environment variables whose VALUES are masked exactly, wherever they appear
//   SAFE_LOGS_GENERIC=0             turn off the catch-all for long mixed tokens
//   SAFE_LOGS_KEEP_PATHS=1          don't replace home folders with ~
//   SAFE_LOGS_SEED_WORDS=0          don't mask runs of 12+ short words
//   SAFE_LOGS_ANSI=strip            always remove terminal escape codes (default: keep them on lines with nothing to mask)
//   SAFE_LOGS_MARK=<text>           what a masked value becomes (default <masked>)
// Throws on a bad extra-terms file or a missing one, so a caller can refuse to write anything.
import fs from 'node:fs';
import { loadExtra, secretsFromEnv } from './redact.mjs';

export function optionsFromEnv(env = process.env, over = {}) {
  const o = {
    generic: env.SAFE_LOGS_GENERIC !== '0',
    homePaths: env.SAFE_LOGS_KEEP_PATHS !== '1',
    seedWords: env.SAFE_LOGS_SEED_WORDS !== '0',
    ansi: env.SAFE_LOGS_ANSI === 'strip' ? 'strip' : 'keep',
    mark: env.SAFE_LOGS_MARK || undefined,
    extraFile: env.SAFE_LOGS_EXTRA || null,
    secretVars: (env.SAFE_LOGS_SECRET_VARS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    ...over,
  };
  let extra = [];
  if (o.extraFile) {
    let text;
    try { text = fs.readFileSync(o.extraFile, 'utf8'); } catch { throw new Error('cannot read the extra-terms file'); }
    extra = loadExtra(text);
  }
  const { values, skipped } = secretsFromEnv(o.secretVars, env);
  return { opts: { generic: o.generic, homePaths: o.homePaths, seedWords: o.seedWords, ansi: o.ansi, mark: o.mark, extra, secrets: values }, skipped };
}
