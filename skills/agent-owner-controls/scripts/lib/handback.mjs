// handback.mjs: "while you were away" notes. Whoever held the agent files one line before letting go; the driver
// reads them in when the pause ends and keeps a short "recent self" block for its prompts.
//
//   events.jsonl   append-only, one JSON line per note: { at, by, text, pin }
//
// It's the one control file with more than one writer, so it is append-only: every writer adds a whole line in one
// write and nobody edits or deletes lines. Text is one line, second person, outcome first, no ids, paths or keys
// (it may be said to strangers), at most 300 characters.
import { appendLine, readLines, oneLine } from './files.mjs';
import { mask } from '../../../fleet-dashboard/scripts/lib/mask.mjs';

export const TEXT_MAX = 300;

export function fileHandback(eventsFile, by, text, { pin = false, now = Date.now() } = {}) {
  const t = oneLine(mask(text), TEXT_MAX);
  if (!t) throw new Error('a handback needs text');
  const row = { at: new Date(now).toISOString(), by: oneLine(by, 40) || 'unknown', text: t, pin: Boolean(pin) };
  appendLine(eventsFile, row);
  return row;
}

const hhmm = (ms, timeZone) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));

/**
 * Call when a pause ends. Returns the notes filed since the pause began. If there are none, files an honest
 * placeholder itself ("details unknown"), so a hold never leaves no trace and nothing is made up.
 */
export function ingestHandbacks(eventsFile, { since, by = 'someone', now = Date.now(), timeZone = 'UTC' } = {}) {
  const found = readLines(eventsFile).filter((e) => Date.parse(e.at) >= since);
  if (found.length) return { events: found, placeholder: false };
  const zone = timeZone === 'UTC' ? ' UTC' : '';
  const row = fileHandback(eventsFile, 'driver', `You were held by ${oneLine(by, 40)} from ${hhmm(since, timeZone)} to ${hhmm(now, timeZone)}${zone}; details unknown.`, { now });
  return { events: [row], placeholder: true };
}

/** The "recent self" lines for a prompt: newest first, last 24 h (pinned notes 72 h), a few lines at most. */
export function recentSelf(eventsFile, { now = Date.now(), max = 5, hours = 24, pinHours = 72 } = {}) {
  return readLines(eventsFile)
    .filter((e) => typeof e.text === 'string' && now - Date.parse(e.at) < (e.pin ? pinHours : hours) * 3_600_000 && Date.parse(e.at) <= now)
    .slice(-max)
    .reverse()
    .map((e) => `- ${e.text}`);
}

export const promptBlock = (lines) => (lines.length ? `YOUR REAL NEWS (true and recent; mention only if it fits):\n${lines.join('\n')}` : '');
