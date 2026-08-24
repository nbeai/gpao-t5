#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const pkg = resolve(process.argv[2] ?? '');
if (!pkg) throw new Error('pkg path is required');
await stat(pkg);
const room = await mkdtemp(join(tmpdir(), 't5-pkg-verify-'));
const expanded = join(room, 'expanded');

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options });
}

async function findApp(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && entry.name === 'GPAO-T5.app') return path;
    if (entry.isDirectory()) {
      const nested = await findApp(path);
      if (nested) return nested;
    }
  }
  return null;
}

async function waitForPort(path, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(path, 'utf8')).port; }
    catch { await new Promise((resolveWait) => setTimeout(resolveWait, 150)); }
  }
  return null;
}

try {
  run('pkgutil', ['--expand-full', pkg, expanded]);
  const app = await findApp(expanded);
  if (!app) throw new Error('GPAO-T5.app is missing from pkg payload');
  const resources = join(app, 'Contents', 'Resources');
  const appRoot = join(resources, 'app');
  const runtime = join(resources, 'runtime', 'bin');
  const required = [
    join(app, 'Contents', 'MacOS', 'GPAO-T5'),
    join(resources, 'GPAO-T5 제거.command'),
    join(runtime, 'node'), join(runtime, 'node-arm64'), join(runtime, 'node-x64'),
    join(appRoot, 'refoundation', 'scripts', 'start-console.mjs'),
    join(appRoot, 'refoundation', 'scripts', 'connect-chatgpt.mjs'),
    join(appRoot, 'refoundation', 'bin', 't5-document.mjs'),
    join(appRoot, 'refoundation', 'skill-packages', 'customer-inquiry-triage', 'SKILL.md'),
    join(appRoot, 'refoundation', 'capabilities', 'asana', 'capability.json'),
    join(appRoot, 'refoundation', 'config', 'skill-catalog.json'),
    join(appRoot, 'refoundation', 'config', 'cli-catalog.json'),
    join(appRoot, 'src', 'surface', 'web', 'index.html'),
    join(appRoot, 'COPYRIGHT'), join(appRoot, 'NOTICE'), join(appRoot, 'THIRD_PARTY_NOTICES.md'),
    join(appRoot, 'docs', '00-product', 'GPAO-T5-FOUNDER-MANIFESTO-ko.md'),
  ];
  for (const path of required) await stat(path);
  const uninstall = join(resources, 'GPAO-T5 제거.command');
  run('/bin/sh', ['-n', uninstall]);
  const uninstallSource = await readFile(uninstall, 'utf8');
  if (!uninstallSource.includes('with administrator privileges')
    || !uninstallSource.includes('pkgutil --forget')) {
    throw new Error('packaged uninstaller does not own the installed app lifecycle');
  }
  for (const forbidden of ['test', 'evidence']) {
    try { await stat(join(appRoot, 'refoundation', forbidden)); throw new Error(`forbidden payload: ${forbidden}`); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  const launcherKind = run('file', ['-b', join(app, 'Contents', 'MacOS', 'GPAO-T5')]);
  if (!launcherKind.includes('universal binary')) throw new Error('launcher is not universal');
  if (!run('file', ['-b', join(runtime, 'node-arm64')]).includes('arm64')) throw new Error('arm64 runtime missing');
  if (!run('file', ['-b', join(runtime, 'node-x64')]).includes('x86_64')) throw new Error('x64 runtime missing');

  const node = join(runtime, 'node');
  const refoundation = join(appRoot, 'refoundation');
  const environment = {
    ...process.env,
    PATH: `${runtime}:${join(refoundation, 'node_modules', '.bin')}:/usr/bin:/bin:/usr/sbin:/sbin`,
  };
  const version = run(node, ['-p', 'process.version+" "+process.arch'], { env: environment }).trim();
  if (!version.includes('v24.14.0')) throw new Error(`unexpected packaged Node: ${version}`);
  run(node, [join(refoundation, 'bin', 't5-document.mjs'), 'help'], { env: environment });

  const home = join(room, 'home');
  const state = join(room, 'state');
  const credentials = join(room, 'credentials', 'model-connection.json');
  const portFile = join(room, 'console-port.json');
  const child = spawn(node, [join(refoundation, 'scripts', 'start-console.mjs'), '--port', '0', '--no-open'], {
    cwd: appRoot,
    env: {
      ...environment, HOME: home, T5_REFOUNDATION_CONSOLE_STATE: state,
      T5_REFOUNDATION_MODEL_CONNECTION_FILE: credentials, T5_REFOUNDATION_PORT_FILE: portFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childStdout = ''; let childStderr = '';
  child.stdout.on('data', (chunk) => { childStdout += chunk; });
  child.stderr.on('data', (chunk) => { childStderr += chunk; });
  const childExit = new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal })));
  try {
    const port = await waitForPort(portFile);
    if (!port) throw new Error(`packaged console did not publish its port: ${childStderr || childStdout}`);
    const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
    if (health?.ok !== true || health?.product !== 'gpao-t5-refoundation') {
      throw new Error('packaged console health is invalid');
    }
    const bootstrap = await fetch(`http://127.0.0.1:${port}/`);
    const html = await bootstrap.text();
    if (!html.includes('GPAO-T5')) throw new Error('packaged console UI is invalid');
    const cookie = bootstrap.headers.get('set-cookie')?.split(';', 1)[0];
    if (!cookie) throw new Error('packaged console did not issue its local identity');
    const unowned = await fetch(`http://127.0.0.1:${port}/sessions`, { method: 'POST' });
    if (unowned.status !== 403) throw new Error('packaged console accepted an unowned write');
    const crossSite = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'text/plain' },
      body: '{}',
    });
    if (crossSite.status !== 403) throw new Error('packaged console accepted a cross-site write');
    const rebinding = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: 'POST', headers: { host: `evil.example:${port}` },
    });
    if (rebinding.status !== 403) throw new Error('packaged console accepted a rebinding host');
    const owned = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: 'POST', headers: { cookie },
    });
    if (owned.status !== 200) throw new Error('packaged console rejected its own UI identity');
  } finally {
    if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM');
    await childExit;
  }

  let secretHits = '';
  try {
    secretHits = run('rg', [
      '-l', '^-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----$', app,
    ], { stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (error) {
    if (error?.status !== 1) throw error;
  }
  if (secretHits) throw new Error(`private key material found in payload: ${secretHits}`);
  console.log(JSON.stringify({ passed: true, pkg, app, node: version }, null, 2));
} finally {
  await rm(room, { recursive: true, force: true });
}
