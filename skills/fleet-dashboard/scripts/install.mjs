#!/usr/bin/env node
// install.mjs: keeps the dashboard running after you close the terminal and across restarts.
//
//   node install.mjs --launchd --config ~/fleet/fleet.json            macOS: print the LaunchAgent it would write
//   node install.mjs --launchd --config ~/fleet/fleet.json --write    …write it to ~/Library/LaunchAgents
//   node install.mjs --launchd --config ~/fleet/fleet.json --start    …write it and start it now
//   node install.mjs --systemd --config ~/fleet/fleet.json [--write | --start]   Linux: a systemd user service
//   node install.mjs --launchd|--systemd --uninstall                  print the commands that stop and remove it
// Options: --name <name> (default fleet-dashboard; launchd label local.<name>).
// It checks the config first and never runs as root. Nothing is started unless you pass --start.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS } from './adapters/index.mjs';
import { loadConfig } from './lib/config.mjs';

const DECK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'deck.mjs');
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// WorkingDirectory= takes no quotes (a quoted path is "not absolute", a fatal unit error): escape instead.
const sdPath = (s) => String(s).replace(/\\/g, '\\\\').replace(/ /g, '\\x20').replace(/%/g, '%%');
const sdq = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;   // systemd: quoted, % escaped

export function launchdPlist({ label, node, deck, config, workdir, out, pathEnv }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(deck)}</string><string>--config</string><string>${xml(config)}</string></array>
  <key>WorkingDirectory</key><string>${xml(workdir)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(pathEnv)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(out)}</string>
  <key>StandardErrorPath</key><string>${xml(out)}</string>
</dict></plist>
`;
}

export function systemdUnit({ name, node, deck, config, workdir, pathEnv }) {
  return `[Unit]
Description=${name}: agent fleet dashboard (127.0.0.1 only)
After=network-online.target

[Service]
Type=simple
ExecStart=${sdq(node)} ${sdq(deck)} --config ${sdq(config)}
WorkingDirectory=${sdPath(workdir)}
Environment=${sdq(`PATH=${pathEnv}`)}
Restart=always
RestartSec=30
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=default.target
`;
}

function main() {
  const a = process.argv.slice(2), has = (f) => a.includes(f), val = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : null);
  const kind = has('--launchd') ? 'launchd' : has('--systemd') ? 'systemd' : null;
  if (!kind || has('--help')) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 10).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(kind ? 0 : 2); }
  if (process.getuid?.() === 0) { console.error('run this as your own user, not root: the dashboard needs no special rights'); process.exit(2); }
  const name = val('--name') ?? 'fleet-dashboard';
  if (!/^[a-z0-9][a-z0-9.-]{0,40}$/.test(name)) { console.error('--name: lowercase letters, digits, dots and dashes'); process.exit(2); }
  const label = `local.${name}`, uid = process.getuid?.();
  const target = kind === 'launchd' ? path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`) : path.join(os.homedir(), '.config/systemd/user', `${name}.service`);

  if (has('--uninstall')) {
    console.log(kind === 'launchd'
      ? `launchctl bootout gui/${uid}/${label}\nrm ${JSON.stringify(target)}`
      : `systemctl --user disable --now ${name}.service\nrm ${JSON.stringify(target)}\nsystemctl --user daemon-reload`);
    console.log('# your config, history and asks folders are left alone');
    return;
  }
  const cfgArg = val('--config');
  if (!cfgArg) { console.error('--config <path to fleet.json> is required'); process.exit(2); }
  const config = path.resolve(cfgArg.replace(/^~(?=\/|$)/, os.homedir()));
  const r = loadConfig(config, ADAPTERS);
  if (r.errors.length) { console.error(`fleet.json has ${r.errors.length} problem(s); fix them first (node deck.mjs --config ${cfgArg} --check):\n- ${r.errors.join('\n- ')}`); process.exit(2); }
  if (r.config.agents.some((x) => x.adapter === 'fake')) console.error('note: this config uses the fake adapter (made-up agents).');
  const opts = { label, name, node: process.execPath, deck: DECK, config, workdir: path.dirname(config), out: path.join(r.config.dataDir, 'service.out'),
    pathEnv: [path.dirname(process.execPath), '/usr/local/bin', '/usr/bin', '/bin'].filter((x, i, l) => l.indexOf(x) === i).join(':') };
  const text = kind === 'launchd' ? launchdPlist(opts) : systemdUnit(opts);

  if (!has('--write') && !has('--start')) {
    console.log(`# would write ${target}\n# (add --write to write it, --start to write it and start it)\n`);
    process.stdout.write(text); return;
  }
  if (kind === 'systemd' && has('--start')) {
    try { execFileSync('systemctl', ['--user', 'show-environment'], { stdio: 'ignore' }); } catch {
      console.error('install.mjs: no systemd user manager here (a container, WSL or a minimal VM), so nothing was written.\nRun it in the background instead: see references/always-on.md, "No service manager".');
      process.exit(1);
    }
  }
  if (fs.existsSync(target) && !fs.readFileSync(target, 'utf8').includes(DECK)) { console.error(`${target} exists and isn't ours; pick another --name`); process.exit(1); }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(r.config.dataDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, text, { mode: 0o644 });
  console.log(`wrote ${target}`);
  if (kind === 'launchd') try { execFileSync('plutil', ['-lint', target], { stdio: 'ignore' }); } catch { console.error('plutil says the plist is not valid'); process.exit(1); }
  if (!has('--start')) {
    console.log(kind === 'launchd' ? `start it: launchctl bootstrap gui/${uid} ${JSON.stringify(target)}` : `start it: systemctl --user daemon-reload && systemctl --user enable --now ${name}.service`);
    return;
  }
  const run = (cmd, args) => { console.log(`$ ${cmd} ${args.join(' ')}`); execFileSync(cmd, args, { stdio: 'inherit' }); };
  if (kind === 'launchd') {
    try { execFileSync('launchctl', ['bootout', `gui/${uid}/${label}`], { stdio: 'ignore' }); } catch { /* wasn't loaded */ }
    run('launchctl', ['bootstrap', `gui/${uid}`, target]);
  } else {
    run('systemctl', ['--user', 'daemon-reload']);
    run('systemctl', ['--user', 'enable', '--now', `${name}.service`]);
    run('systemctl', ['--user', 'restart', `${name}.service`]);
    console.log('to keep it running while you are logged out: loginctl enable-linger');
  }
  console.log(`open http://localhost:${r.config.port} (give it a few seconds)`);
}

// Run only when started directly. Node resolves symlinks for the module (/tmp on macOS, a linked folder) but not
// in argv[1], so compare real paths, or a linked path would silently do nothing.
const startedDirectly = () => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && startedDirectly()) main();
