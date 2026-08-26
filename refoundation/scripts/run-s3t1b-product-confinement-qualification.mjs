#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { makeExecTool } from '../src/exec-tool.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';

const outIndex = process.argv.indexOf('--out');
const output = outIndex >= 0 ? resolve(process.argv[outIndex + 1]) : null;
const room = await mkdtemp(join(tmpdir(), 't5-s3t1b-product-'));
try {
  const normalRoot = join(room, 'normal'); const protectedRoot = join(room, 't5-credentials');
  await Promise.all([mkdir(normalRoot, { mode: 0o700 }), mkdir(protectedRoot, { mode: 0o700 })]);
  const normal = join(normalRoot, 'brief'); const secret = join(protectedRoot, 'credential');
  const cli = join(normalRoot, 'safe-cli'); const secretValue = 'T5-PRODUCT-SECRET-MUST-NOT-LEAK';
  await Promise.all([
    writeFile(normal, 'VISIBLE-PRODUCT-BRIEF', { mode: 0o600 }),
    writeFile(secret, secretValue, { mode: 0o600 }),
    writeFile(cli, '#!/bin/sh\nprintf SAFE-PRODUCT-CLI', { mode: 0o700 }),
  ]); await chmod(cli, 0o700);
  const adapter = await makeTerminalPlatformAdapter({
    platform: 'darwin', protectedReadRoots: [protectedRoot],
  });
  const tool = makeExecTool({ workspace: room, terminalPlatformAdapter: adapter });
  const read = await tool.execute({
    command: `cat ${JSON.stringify(normal)}; cat ${JSON.stringify(secret)}`, cwd: null,
    effect: { kind: 'observe', summary: 'product confinement', targets: [], reversible: true,
      backupAvailable: false, recipientNew: false, approvalToken: null },
  });
  const safeCli = await tool.execute({
    command: JSON.stringify(cli), cwd: null,
    effect: { kind: 'observe', summary: 'safe CLI', targets: [], reversible: true,
      backupAvailable: false, recipientNew: false, approvalToken: null },
  });
  const keychainCli = await tool.execute({
    command: '/usr/bin/security find-generic-password -s definitely-missing -w', cwd: null,
    effect: { kind: 'observe', summary: 'Keychain CLI boundary', targets: [], reversible: true,
      backupAvailable: false, recipientNew: false, approvalToken: null },
  });
  const evidence = {
    schema: 't5.s3t1b.product-confinement-qualification.v1',
    recordedAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    status: 't5_owned_secret_confinement_wired_registered_cli_broker_open',
    protectedRead: {
      normalReadable: read.stdout.includes('VISIBLE-PRODUCT-BRIEF'),
      secretReadable: read.stdout.includes(secretValue),
      denied: /Operation not permitted/u.test(read.stderr),
      confinement: read.confinement,
    },
    ordinaryCli: { executed: safeCli.stdout.includes('SAFE-PRODUCT-CLI'), exitCode: safeCli.exitCode },
    keychainCli: {
      executed: !/Operation not permitted/u.test(keychainCli.stderr),
      denied: /operation not permitted/iu.test(keychainCli.stderr), exitCode: keychainCli.exitCode,
    },
    modelContextChanged: false,
    effectContractChanged: false,
    actualCredentialUsed: false,
    actualExternalEffect: false,
    remaining: [
      'registered authenticated CLI broker is not wired',
      'personal .ssh and third-party CLI credential roots are not default protected roots',
      'Windows and Linux confinement remain unqualified passthrough',
    ],
    nextCandidate: 'registered_cli_broker_product_integration',
    pass: read.stdout.includes('VISIBLE-PRODUCT-BRIEF') && !read.stdout.includes(secretValue)
      && /operation not permitted/iu.test(read.stderr) && safeCli.stdout.includes('SAFE-PRODUCT-CLI')
      && /operation not permitted/iu.test(keychainCli.stderr),
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (output) {
    await mkdir(dirname(output), { recursive: true }); await writeFile(output, serialized, { mode: 0o600 });
  } else process.stdout.write(serialized);
} finally { await rm(room, { recursive: true, force: true }); }
