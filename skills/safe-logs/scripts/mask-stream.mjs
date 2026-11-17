// mask-stream.mjs: mask what a Node process writes to a stream, from inside the process. No side effects on import;
// mask-stdio.mjs is the one-line way to put it on stdout and stderr.
//
// Each write() is masked on its own. Text (strings, or Buffers that are valid UTF-8) is masked; anything else
// (binary output, serialized test reports) goes through untouched, because decoding it would corrupt it.
// Limits, by design: a key split across two separate write() calls is not joined (use mask-pipe.mjs for
// output you don't control), and anything that writes to file descriptor 1 or 2 directly (some fast loggers)
// skips the wrapper: give such a logger safeDestination() instead.
import { Buffer, isUtf8 } from 'node:buffer';
import { makeRedactor } from './redact.mjs';

const MARKED = Symbol.for('safe-logs.masked');

export function maskChunk(chunk, redactor) {
  const r = redactor ?? makeRedactor();
  if (typeof chunk === 'string') return r.text(chunk);
  if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) return chunk;
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  if (!isUtf8(buf)) return chunk;
  const text = buf.toString('utf8'), out = r.text(text);
  return out === text ? chunk : out;
}

// Wraps stream.write once (a second call is a no-op). opts as in makeRedactor.
export function maskStream(stream, opts = {}) {
  if (stream[MARKED]) return stream;
  const r = makeRedactor(opts);   // its own state, so a private key block split over writes is still masked
  const write = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => {
    let out;
    try { out = maskChunk(chunk, r); } catch { out = '[safe-logs: output dropped, the mask failed]\n'; }   // fail closed
    return write(out, ...rest);
  };
  stream[MARKED] = true;
  return stream;
}

// For loggers that would otherwise write to fd 1/2 directly: an object with write() that goes through the
// (masked) stream. pino: pino({}, safeDestination())   ·   any logger that accepts { write(s) }.
export const safeDestination = (stream = process.stdout) => ({ write: (s) => stream.write(s) });
