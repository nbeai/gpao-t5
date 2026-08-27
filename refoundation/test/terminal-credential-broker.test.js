import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeExecTool } from '../src/exec-tool.js';
import { makeTerminalCredentialBroker } from '../src/terminal-credential-broker.js';

test('registered CLI는 exact foreground action만 direct argv로 실행하고 secret output을 가린다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-registered-cli-'));
  const bin = join(room, 'bin'); await mkdir(bin); const cli = join(bin, 'fixture-cli');
  await writeFile(cli, '#!/bin/sh\nprintf "ACCOUNT-9 %s" "$BROKER_TOKEN"', { mode: 0o700 }); await chmod(cli, 0o700);
  const secret = 'BROKER-TOKEN-MUST-NOT-LEAK';
  const broker = makeTerminalCredentialBroker({ registrations: [{
    id: 'fixture-account', executable: 'fixture-cli', program: cli,
    actions: [{ id: 'whoami', matches: (args) => args.length === 1 && args[0] === 'whoami',
      prepare: () => ({ args: [], env: { BROKER_TOKEN: secret }, sensitiveValues: [secret] }) }],
  }], generalTerminalIsolationQualified: true });
  try {
    const tool = makeExecTool({ workspace: room, pathPrepend: bin, terminalCredentialBroker: broker });
    const result = await tool.execute({ command: 'fixture-cli whoami', cwd: null,
      effect: { kind: 'observe', summary: 'broker identity', targets: [], reversible: true,
        backupAvailable: false, recipientNew: false, approvalToken: null } });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'ACCOUNT-9 [REDACTED]');
    assert.deepEqual(result.credentialBroker,
      { kind: 'registered_cli', capabilityId: 'fixture-account', action: 'whoami' });
    assert.doesNotMatch(JSON.stringify(result), /BROKER-TOKEN-MUST-NOT-LEAK/u);
    await assert.rejects(tool.execute({ command: 'fixture-cli token', cwd: null,
      effect: { kind: 'observe', summary: 'denied', targets: [], reversible: true,
        backupAvailable: false, recipientNew: false, approvalToken: null } }),
    (error) => error?.code === 'T5_REGISTERED_CLI_ACTION_REQUIRED');
    await assert.rejects(tool.execute({ command: 'fixture-cli whoami; printf bypass', cwd: null,
      effect: { kind: 'observe', summary: 'compound denied', targets: [], reversible: true,
        backupAvailable: false, recipientNew: false, approvalToken: null } }),
    (error) => error?.code === 'T5_REGISTERED_CLI_ACTION_REQUIRED');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('미등록 CLI는 broker가 가로채지 않고 기존 Terminal launch를 유지한다', async () => {
  const broker = makeTerminalCredentialBroker({ registrations: [] });
  const result = await makeExecTool({ workspace: '/private/tmp', terminalCredentialBroker: broker })
    .execute({ command: 'printf ordinary', cwd: null,
      effect: { kind: 'observe', summary: 'ordinary', targets: [], reversible: true,
        backupAvailable: false, recipientNew: false, approvalToken: null } });
  assert.equal(result.stdout, 'ordinary');
  assert.equal(result.credentialBroker, undefined);
});
