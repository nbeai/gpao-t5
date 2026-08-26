#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  makeFixtureCredentialBroker, runMacosConfinedCommand,
} from '../test/helpers/s3t-secret-confinement-candidate.js';

const outIndex = process.argv.indexOf('--out');
const output = outIndex >= 0 ? resolve(process.argv[outIndex + 1]) : null;
const room = await mkdtemp(join(tmpdir(), 't5-s3t-secret-candidate-'));
try {
  const normalRoot = join(room, 'normal'); const secretRoot = join(room, 'secret');
  await Promise.all([mkdir(normalRoot, { mode: 0o700 }), mkdir(secretRoot, { mode: 0o700 })]);
  const normal = join(normalRoot, 'brief'); const secret = join(secretRoot, 'token');
  const secretValue = 'S3T-FIXTURE-SECRET-MUST-NOT-SURVIVE';
  await Promise.all([
    writeFile(normal, 'VISIBLE-BRIEF', { mode: 0o600 }),
    writeFile(secret, secretValue, { mode: 0o600 }),
  ]);
  const generic = await runMacosConfinedCommand({
    command: `cat ${JSON.stringify(normal)}; cat ${JSON.stringify(secret)}`,
    cwd: room, env: { PATH: '/usr/bin:/bin', HOME: room }, secretRoots: [secretRoot],
  });
  const cli = join(room, 'brokered-cli');
  await writeFile(cli, [
    '#!/bin/sh',
    'token=$(cat "$1")',
    'printf "BROKERED-ACCOUNT-7 %s" "$token"',
  ].join('\n'), { mode: 0o700 }); await chmod(cli, 0o700);
  const broker = makeFixtureCredentialBroker({ capabilities: {
    'fixture-cli': {
      program: cli, actions: { whoami: [secret] }, secretValues: [secretValue],
      cwd: room, env: { PATH: '/usr/bin:/bin', HOME: room },
    },
  } });
  const brokered = await broker.execute({ capabilityId: 'fixture-cli', action: 'whoami' });
  let forbiddenActionRejected = false;
  try { await broker.execute({ capabilityId: 'fixture-cli', action: 'token' }); }
  catch { forbiddenActionRejected = true; }
  const evidence = {
    schema: 't5.s3t.secret-confinement-candidate.v1',
    recordedAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    status: 'candidate_qualified_product_not_wired',
    genericTerminal: {
      normalFileReadable: generic.stdout.includes('VISIBLE-BRIEF'),
      secretFileReadable: generic.stdout.includes(secretValue),
      deniedBeforeSecretOutput: /Operation not permitted/u.test(generic.stderr),
      exitCode: generic.exitCode,
    },
    brokeredCli: {
      safeIdentityReturned: brokered.stdout.includes('BROKERED-ACCOUNT-7'),
      secretRedacted: !brokered.stdout.includes(secretValue) && brokered.stdout.includes('[REDACTED]'),
      forbiddenActionRejected,
      exitCode: brokered.exitCode,
    },
    actualExternalEffect: false,
    actualCredentialUsed: false,
    productCodeChanged: false,
    limitations: [
      'macOS sandbox-exec candidate is not yet a cross-platform TerminalPlatformAdapter',
      'exact-value redaction requires credential ownership and does not replace output classification',
      'registered CLI actions need per-capability qualification before product wiring',
      'generic secret roots need current-user policy and symlink countertests',
    ],
    nextCandidate: 'terminal_platform_secret_policy_and_registered_cli_broker_contract',
    pass: generic.stdout.includes('VISIBLE-BRIEF') && !generic.stdout.includes(secretValue)
      && /Operation not permitted/u.test(generic.stderr)
      && brokered.stdout.includes('BROKERED-ACCOUNT-7') && !brokered.stdout.includes(secretValue)
      && forbiddenActionRejected,
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (output) {
    await mkdir(dirname(output), { recursive: true }); await writeFile(output, serialized, { mode: 0o600 });
  } else process.stdout.write(serialized);
} finally { await rm(room, { recursive: true, force: true }); }
