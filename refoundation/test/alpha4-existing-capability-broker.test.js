import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';
import { makeRegisteredCliConnectionInspector } from '../src/existing-capability-inspectors.js';
import { makeGitHubCliRegistration, githubCliCredentialRoots } from '../src/github-cli-broker.js';
import { discoverLocalSyncRoots, makeLocalSyncCapability } from '../src/local-sync-capability.js';
import { makeNativeComputerInspector, makeNativeComputerTool } from '../src/native-computer-tool.js';
import { makeTerminalCredentialBroker } from '../src/terminal-credential-broker.js';

const observe = { kind: 'observe', targets: [], confirmation: 'not_applicable', rollbackOfToolCallId: null };

function githubProbe(_program, args) {
  if (args[0] === 'api') return Promise.resolve({
    code: 0, stdout: '{"id":42,"login":"local-owner"}\n', stderr: '',
  });
  return Promise.resolve({
    code: 0,
    stdout: JSON.stringify({ hosts: { 'github.com': [{
      login: 'local-owner', active: true, scopes: 'repo, read:org', token: 'MUST-NOT-ESCAPE',
    }] } }),
    stderr: '',
  });
}

test('GitHub 기존 로그인은 account·scope만 관측하고 token 원문은 truth와 Receipt에 없다', async () => {
  const registration = makeGitHubCliRegistration('/fixture/gh', { execute: githubProbe });
  const broker = makeTerminalCredentialBroker({ registrations: [registration],
    generalTerminalIsolationQualified: true });
  const [truth] = await broker.inspect('github-cli-read');
  assert.equal(truth.state, 'ready');
  assert.equal(truth.identity.accountId, '42');
  assert.equal(truth.identity.accountLabel, 'local-owner');
  assert.deepEqual(truth.identity.permissions, ['repo', 'read:org']);
  assert.equal(truth.credential.rawExposedToModel, false);
  assert.equal(truth.credential.rawExposedToGeneralTerminal, false);
  assert.doesNotMatch(JSON.stringify(truth), /MUST-NOT-ESCAPE/u);

  const inspector = makeRegisteredCliConnectionInspector({
    broker, capabilityId: 'github-cli-read', label: 'GitHub CLI',
  });
  const connection = await inspector.inspect();
  assert.equal(connection.state, 'ready');
  assert.match(connection.userSafeSummary, /local-owner/u);
});

test('GitHub CLI credential root는 macOS·Windows에서 일반 Terminal 보호 입력으로 계산된다', () => {
  assert.deepEqual(githubCliCredentialRoots({
    platform: 'darwin', home: '/Users/person', env: { XDG_CONFIG_HOME: '/Users/person/.xdg' },
  }), [
    '/Users/person/.xdg/gh', '/Users/person/.config/gh',
    '/Users/person/Library/Application Support/GitHub CLI',
  ]);
  assert.deepEqual(githubCliCredentialRoots({
    platform: 'win32', home: 'C:\\Users\\person', env: {
      APPDATA: 'C:\\Users\\person\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\person',
    },
  }), [
    'C:\\Users\\person\\AppData\\Roaming\\GitHub CLI',
  ]);
});

test('Windows 물리 격리가 오기 전에는 기존 credential CLI를 사용 가능하다고 꾸미지 않는다', async () => {
  const broker = makeTerminalCredentialBroker({
    registrations: [makeGitHubCliRegistration('/fixture/gh.exe', {
      execute: githubProbe,
    })],
    generalTerminalIsolationQualified: false,
  });
  const [truth] = await broker.inspect('github-cli-read');
  assert.equal(truth.state, 'needs_attention');
  assert.equal(truth.reason, 'registered_cli_terminal_isolation_unavailable');
  const prepared = await broker.prepare({ managed: false, commandExplanation: {
    ok: true, operators: [], steps: [{ executable: 'gh', argv: ['gh', 'pr', 'list'] }],
  } });
  assert.equal(prepared.allowed, false);
});

test('동기화 폴더는 로컬 파일 reality로만 보이고 계정·원격 sync 성공을 꾸미지 않는다', async () => {
  const home = '/Users/person';
  const existing = new Set([
    `${home}/Library/CloudStorage/GoogleDrive-user@example.com`, `${home}/Dropbox`,
  ]);
  const capability = makeLocalSyncCapability({
    platform: 'darwin', home, ttlMs: 60_000,
    readDirectory: async () => [{ name: 'GoogleDrive-user@example.com', isDirectory: () => true }],
    inspect: async (path) => {
      if (!existing.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { isDirectory: () => true };
    },
    canonicalize: async (path) => path,
  });
  const truth = await capability.inspect();
  assert.equal(truth.state, 'ready');
  assert.equal(truth.capabilities.remote_sync_observed, false);
  assert.deepEqual(truth.identity.permissions, ['read', 'write']);
  assert.doesNotMatch(JSON.stringify(truth), /user@example\.com/u);
  const used = await capability.attributeCommand({
    cwd: '/tmp', declaredEffect: observe,
    commandExplanation: { steps: [{ argv: ['cat', `${home}/Dropbox/brief.md`] }] },
  });
  assert.equal(used[0].kind, 'local_file');
  assert.equal(used[0].capabilityAdmission.credential.owner, 'none');
});

test('제품이 이미 관측한 iCloud Drive root는 일반 Library 없이 computer 파일 범위에 결속할 수 있다', async () => {
  const home = '/Users/person';
  const cloud = `${home}/Library/Mobile Documents/com~apple~CloudDocs`;
  const roots = await discoverLocalSyncRoots({ platform: 'darwin', home,
    readDirectory: async () => [],
    inspect: async (path) => { if (path !== cloud) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { isDirectory: () => true }; },
    canonicalize: async (path) => path });
  assert.deepEqual(roots.map((item) => ({ providerId: item.providerId, path: item.path })), [
    { providerId: 'icloud-drive', path: cloud },
  ]);
  const source = await readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8');
  assert.match(source, /observedLocalSyncRoots[\s\S]*\.map\(\(item\) => item\.path\)[\s\S]*standardComputerFileRoots/u);
});

test('OS 파일 관리자는 fixed action만 실행하고 경로를 capability Receipt에 복사하지 않는다', async () => {
  const calls = [];
  const tool = makeNativeComputerTool({ platform: 'darwin', revealPath: async (path) => {
    calls.push(path); return { openedPath: path, targetType: 'file' };
  } });
  const result = await tool.execute({ action: 'reveal', path: '/private/tmp/report.pdf' });
  assert.deepEqual(calls, ['/private/tmp/report.pdf']);
  assert.equal(result.capabilityReceipts[0].kind, 'os_native');
  assert.equal(result.capabilityReceipts[0].execution.state, 'succeeded');
  assert.doesNotMatch(JSON.stringify(result.capabilityReceipts), /private\/tmp/u);
  assert.equal((await makeNativeComputerInspector({ platform: 'win32' }).inspect()).capabilities.reveal, true);
});

test('한 사용자 목적에서 local file·기존 GitHub 로그인·공식 원격 연결·Finder를 조합한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-alpha4-purpose-'));
  const dropbox = join(room, 'Dropbox'); const brief = join(dropbox, 'brief.txt');
  const bin = join(room, 'bin'); const gh = join(bin, 'gh');
  await mkdir(dropbox); await mkdir(bin); await writeFile(brief, 'LOCAL-BRIEF');
  await writeFile(gh, '#!/bin/sh\nprintf "PR-17"\n', { mode: 0o700 }); await chmod(gh, 0o700);
  const localSync = makeLocalSyncCapability({ platform: 'darwin', home: room });
  const terminalBroker = makeTerminalCredentialBroker({ registrations: [
    makeGitHubCliRegistration(gh, { execute: githubProbe }),
  ], generalTerminalIsolationQualified: true });
  const revealed = [];
  const remoteService = {
    id: 'notion', label: 'Notion', category: 'workspace', toolName: 'notion_lookup',
    async inspect() { return {
      state: 'connected', reason: 'verified_official_api', userSafeSummary: 'Notion 연결됨',
      capabilities: { read: true }, routes: [],
      identity: { ownerApplication: 'T5', transport: 'official_remote_mcp',
        accountId: 'workspace-1', accountLabel: '업무공간', permissions: ['read'], resources: [], observed: true },
    }; },
    async makeTool() { return {
      name: 'notion_lookup', description: 'Read the connected Notion workspace for exact project facts.',
      searchTerms: ['notion workspace project facts'],
      parameters: { type: 'object', additionalProperties: false, properties: {
        query: { type: 'string' }, effect: { type: 'object' },
      }, required: ['query', 'effect'] },
      async execute() { return { state: 'found', text: 'REMOTE-NOTE' }; },
    }; },
    async close() {},
  };
  let turn = 0;
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room,
    terminalEnvironment: { PATH: `${bin}:/usr/bin:/bin`, HOME: room },
    terminalCredentialBroker: terminalBroker,
    terminalCapabilityAttribution: (facts) => localSync.attributeCommand(facts),
    workspaceConnectionInspectors: [
      localSync, makeNativeComputerInspector({ platform: 'darwin' }),
      makeRegisteredCliConnectionInspector({ broker: terminalBroker,
        capabilityId: 'github-cli-read', label: 'GitHub CLI' }),
    ],
    workspaceConnectionServices: [remoteService],
    revealPath: async (path) => { revealed.push(path); return { openedPath: path, targetType: 'file' }; },
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond(input) {
      turn += 1;
      if (turn === 1) return { text: '', toolCalls: [{ id: 'truth', name: 'connection',
        args: { action: 'list', id: null, actionId: null } }] };
      if (turn === 2) {
        const listed = JSON.parse(input.messages.at(-1).content).result.connections;
        const byId = new Map(listed.map((item) => [item.id, item]));
        for (const id of ['model', 'telegram', 't5-browser', 'local-sync-files',
          'native-file-manager', 'github-cli-read', 'notion']) assert.ok(byId.has(id));
        assert.equal(byId.get('notion').state, 'connected');
        assert.equal(byId.get('coupang-wing').state, 'not_connected');
        return { text: '', toolCalls: [{ id: 'local', name: 'exec', args: {
          command: `cat ${JSON.stringify(brief)}`, cwd: null, effect: observe,
        } }] };
      }
      if (turn === 3) {
        const local = JSON.parse(input.messages.at(-1).content);
        assert.match(local.result.stdout, /LOCAL-BRIEF/u);
        assert.ok(local.result.capabilityReceipts, `local receipt missing: ${JSON.stringify(local.result)}`);
        assert.equal(local.result.capabilityReceipts[0].kind, 'local_file');
        return { text: '', toolCalls: [{ id: 'github', name: 'exec', args: {
          command: 'gh pr list', cwd: null, effect: observe,
        } }] };
      }
      if (turn === 4) {
        const github = JSON.parse(input.messages.at(-1).content);
        assert.ok(github.result.capabilityReceipts, `github receipt missing: ${JSON.stringify(github.result)}`);
        assert.equal(github.result.capabilityReceipts[0].kind, 'authenticated_cli');
        assert.equal(github.result.capabilityReceipts[0].authority.accountLabel, 'local-owner');
        return { text: '', toolCalls: [{ id: 'find-notion', name: 'tool_search',
          args: { query: 'notion workspace project facts' } }] };
      }
      if (turn === 5) {
        assert.ok(input.tools.some((tool) => tool.name === 'notion_lookup'));
        return { text: '', toolCalls: [{ id: 'remote', name: 'notion_lookup', args: {
          query: 'project', effect: observe,
        } }] };
      }
      if (turn === 6) {
        const remote = JSON.parse(input.messages.at(-1).content);
        assert.ok(remote.result.capabilityReceipts, `remote receipt missing: ${JSON.stringify(remote.result)}`);
        assert.equal(remote.result.capabilityReceipts[0].kind, 'remote_connection');
        return { text: '', toolCalls: [{ id: 'finder', name: 'native_computer', args: {
          action: 'reveal', path: brief,
        } }] };
      }
      const native = JSON.parse(input.messages.at(-1).content);
      assert.ok(native.result.capabilityReceipts, `native receipt missing: ${JSON.stringify(native.result)}`);
      assert.equal(native.result.capabilityReceipts[0].kind, 'os_native');
      return { text: '기존 컴퓨터 능력으로 모두 확인하고 파일 위치를 열었어요.', toolCalls: [] };
    } }),
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen);
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const answer = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '내 Dropbox 기획서와 GitHub PR, Notion을 확인하고 파일도 보여줘' })
    }).then((response) => response.json());
    assert.equal(answer.error, undefined, JSON.stringify(answer));
    assert.match(answer.reply, /모두 확인/u); assert.deepEqual(revealed, [brief]);
  } finally {
    server.closeWakeStreams(); await server.closeMessengers();
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(room, { recursive: true, force: true });
  }
});
