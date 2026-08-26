#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeExecTool } from '../src/exec-tool.js';
import { resolveTerminalShellEnvironment } from '../src/terminal-shell-environment.js';

const outIndex = process.argv.indexOf('--out');
const output = outIndex >= 0 ? resolve(process.argv[outIndex + 1]) : null;
const room = await mkdtemp(join(tmpdir(), 't5-s3t1a-'));
try {
  const home = await (async () => {
    const path = join(room, 'configured-home'); await mkdir(path, { mode: 0o700 }); return path;
  })();
  const bin = join(home, 'user-bin'); await mkdir(bin, { mode: 0o700 });
  const cli = join(bin, 'fixture-cli');
  await writeFile(cli, '#!/bin/sh\nprintf SAFE-CLI-OK', { mode: 0o700 }); await chmod(cli, 0o700);
  const fakeShell = join(room, 'fake-shell');
  await writeFile(fakeShell, [
    '#!/bin/sh', 'flags="$1"', 'shift',
    'case "$flags" in *l*) export HOME=/escaped-user-home ;; esac',
    'exec /bin/sh -c "$1"',
  ].join('\n'), { mode: 0o700 }); await chmod(fakeShell, 0o700);
  const computer = discoverComputerEnvironment({
    platform: 'darwin', userHome: home,
    env: { SHELL: fakeShell, T5_REFOUNDATION_SHELL: fakeShell },
  });
  const basePath = ['/usr/bin', '/bin'].join(delimiter);
  const terminalEnvironment = await resolveTerminalShellEnvironment({
    computer, home, baseEnv: { PATH: basePath },
    capture: async () => `startup-noise\n__T5_SAFE_LOGIN_PATH__=${bin}${delimiter}${basePath}\n`,
  });
  const parentKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'S3T1A-PARENT-KEY-MUST-NOT-LEAK';
  let result;
  try {
    result = await makeExecTool({ workspace: home, computer, env: terminalEnvironment }).execute({
      command: [
        `test "$HOME" = ${JSON.stringify(home)} && printf 'HOME-ISOLATED\\n'`,
        'command -v fixture-cli',
        'fixture-cli',
        'test -z "${OPENAI_API_KEY+x}" && printf "\\nPARENT-SECRET-ABSENT"',
      ].join('; '),
      cwd: null,
      effect: { kind: 'observe', summary: 'S3-T1A qualification', targets: [], reversible: true,
        backupAvailable: false, recipientNew: false, approvalToken: null },
    });
  } finally {
    if (parentKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = parentKey;
  }
  const before = JSON.parse(await readFile(new URL(
    '../evidence/s3-a-terminal-baseline-2026-08-26.json', import.meta.url,
  ), 'utf8'));
  const source = String(result.stdout ?? '');
  const evidence = {
    schema: 't5.s3t1a.login-shell-isolation-qualification.v1',
    recordedAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    status: 'login_shell_isolation_repaired_secret_confinement_still_open',
    before: {
      configuredHomeEscaped: before.fixture.loginShellEscapedConfiguredHome,
      privateFixtureReadable: before.fixture.privateKeyReadable,
      cliCredentialFixtureReadable: before.fixture.cliCredentialReadable,
    },
    after: {
      commandUsesNonLoginShell: computer.commandRuntime.argsFor('x')[0] === '-c',
      configuredHomePreserved: source.includes('HOME-ISOLATED'),
      safeLoginPathPreserved: source.includes(cli),
      safeCliExecuted: source.includes('SAFE-CLI-OK'),
      parentCredentialEnvAbsent: source.includes('PARENT-SECRET-ABSENT'),
      captureSource: terminalEnvironment.source,
      exitCode: result.exitCode,
    },
    userOutcomeChanged: false,
    modelContextChanged: false,
    effectContractChanged: false,
    platformBoundary: {
      macos: 'safe login PATH capture plus non-login command execution',
      windows: 'existing NoProfile command runtime preserved',
      linux: 'same POSIX interface; live qualification not performed',
    },
    remaining: [
      'generic terminal can still read secret files inside an allowed real HOME',
      'credential broker is required before secret-root sandbox can be default',
      'foreground omitted output still has no exact recall handle',
      'effect declaration still requires seven fields',
    ],
    nextCandidate: 'secret_root_sandbox_and_broker_positive_control',
    pass: result.exitCode === 0 && source.includes('HOME-ISOLATED') && source.includes(cli)
      && source.includes('SAFE-CLI-OK') && source.includes('PARENT-SECRET-ABSENT'),
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (output) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, serialized, { mode: 0o600 });
  } else process.stdout.write(serialized);
} finally { await rm(room, { recursive: true, force: true }); }
