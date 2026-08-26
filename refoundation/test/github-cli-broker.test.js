import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeExecTool } from '../src/exec-tool.js';
import { findExecutable, githubReadAction, makeGitHubCliRegistration } from '../src/github-cli-broker.js';
import { makeTerminalCredentialBroker } from '../src/terminal-credential-broker.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';

const effect = { kind: 'observe', targets: [], confirmation: 'not_applicable' };

test('GitHub CLI broker는 조회만 허용하고 token·web·write·GraphQL을 차단한다', () => {
  assert.equal(githubReadAction(['repo', 'list', '--limit', '10']), 'repo_list');
  assert.equal(githubReadAction(['pr', 'view', '42', '--json', 'title,state']), 'pr_view');
  assert.equal(githubReadAction(['api', 'user']), 'api_get');
  assert.equal(githubReadAction(['api', 'repos/o/r', '--method', 'GET']), 'api_get');
  for (const args of [
    ['auth', 'token'], ['auth', 'status', '--show-token'], ['repo', 'create'],
    ['pr', 'merge', '42'], ['issue', 'close', '7'], ['repo', 'view', '--web'],
    ['api', 'repos/o/r', '--method', 'POST'], ['api', 'graphql', '-f', 'query={}'],
  ]) assert.equal(githubReadAction(args), null, args.join(' '));
});

test('제품 broker는 설치된 gh fixture만 direct argv로 실행하고 미등록 gh 행동을 shell로 우회하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-github-cli-broker-'));
  const bin = join(room, 'bin'); const gh = join(bin, 'gh'); await mkdir(bin);
  await writeFile(gh, '#!/bin/sh\nprintf "ARGS=%s|%s|%s\\nPROMPT=%s PAGER=%s" "$1" "$2" "$3" "$GH_PROMPT_DISABLED" "$GH_PAGER"\n', { mode: 0o700 });
  await chmod(gh, 0o700);
  try {
    const found = await findExecutable('gh', `${bin}:/not/real`);
    assert.match(found, /\/bin\/gh$/u);
    const broker = makeTerminalCredentialBroker({ registrations: [makeGitHubCliRegistration(found)] });
    const tool = makeExecTool({ workspace: room, terminalCredentialBroker: broker });
    const result = await tool.execute({ command: 'gh repo list --limit 10', cwd: null, effect });
    assert.match(result.stdout, /ARGS=repo\|list\|--limit/u);
    assert.match(result.stdout, /PROMPT=1 PAGER=cat/u);
    assert.deepEqual(result.credentialBroker, {
      kind: 'registered_cli', capabilityId: 'github-cli-read', action: 'repo_list',
    });
    await assert.rejects(tool.execute({ command: 'gh auth token', cwd: null, effect }), {
      code: 'T5_REGISTERED_CLI_ACTION_REQUIRED',
    });
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('제품 entry는 발견된 GitHub CLI 등록을 Terminal broker에 주입한다', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(
    new URL('../scripts/start-console.mjs', import.meta.url), 'utf8',
  ));
  assert.match(source, /findExecutable\('gh', terminalEnvironment\.PATH/u);
  assert.match(source, /makeGitHubCliRegistration\(githubCli\)/u);
  assert.match(source, /protectedExecutableNames: githubCli \? \['gh'\] : \[\]/u);
  assert.match(source, /terminalCredentialBroker,/u);
});

test('macOS 일반 shell의 command·절대경로 gh는 막히고 broker direct argv만 실행된다', async (context) => {
  if (process.platform !== 'darwin') return context.skip('macOS Seatbelt qualification');
  const room = await mkdtemp(join(tmpdir(), 't5-github-cli-seatbelt-'));
  const bin = join(room, 'bin'); const gh = join(bin, 'gh'); await mkdir(bin);
  await writeFile(gh, '#!/bin/sh\nprintf SHOULD-NOT-BYPASS\n', { mode: 0o700 }); await chmod(gh, 0o700);
  try {
    const adapter = await makeTerminalPlatformAdapter({ protectedExecutableNames: ['gh'] });
    const ordinary = makeExecTool({ workspace: room, pathPrepend: bin, terminalPlatformAdapter: adapter });
    for (const command of ['command gh auth token', `${JSON.stringify(gh)} auth token`]) {
      const result = await ordinary.execute({ command, cwd: null, effect });
      assert.notEqual(result.exitCode, 0);
      assert.doesNotMatch(result.stdout, /SHOULD-NOT-BYPASS/u);
    }
    const broker = makeTerminalCredentialBroker({ registrations: [makeGitHubCliRegistration(gh)] });
    const registered = makeExecTool({ workspace: room, pathPrepend: bin,
      terminalPlatformAdapter: adapter, terminalCredentialBroker: broker });
    const result = await registered.execute({ command: 'gh repo list', cwd: null, effect });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /SHOULD-NOT-BYPASS/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});
