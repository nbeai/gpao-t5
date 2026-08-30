import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

const effect = (summary) => ({
  kind: 'local_change', summary, targets: ['T5 관리 도구 폴더'],
  confirmation: 'not_applicable', rollbackOfToolCallId: null,
});
const observe = (summary) => ({
  kind: 'observe', summary, targets: [], confirmation: 'not_applicable', rollbackOfToolCallId: null,
});

test('필요한 CLI를 검증해 준비하고 같은 Run 즉시 사용한 뒤 새 Session에서 재설치 없이 재사용한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-cli-console-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  const catalogFile = join(room, 'cli-catalog.json');
  const bytes = Buffer.from('#!/bin/sh\nprintf managed-json-ok\n');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await mkdir(workspace, { recursive: true });
  await writeFile(catalogFile, JSON.stringify({
    schema: 't5.cli-catalog.v1', packages: [{
      id: 'json-tool', title: 'JSON Tool', command: 'json-tool', description: 'fixture',
      exposure: 'path', verifyTimeoutMs: 5000,
      officialSource: 'https://example.test/json-tool', license: { spdx: 'MIT', url: 'https://example.test/license' },
      defaultVersion: '1.0.0', versions: { '1.0.0': { releaseUrl: 'https://example.test/releases/1.0.0', assets: {
        [`${process.platform}-${process.arch}`]: { url: 'https://example.test/json-tool-1.0.0', sha256, bytes: bytes.length },
      } } },
    }],
  }));
  let downloads = 0;
  const modelFactory = ({ sessionId }) => {
    let turn = 0;
    return { async respond(input) {
      const userText = input.messages.findLast((message) => message.role === 'user')?.content ?? '';
      if (userText.includes('사용 기록')
        && !input.tools.some((tool) => tool.name === 'capability_evidence')) return {
        text: '', toolCalls: [{
          id: 'find-capability-evidence', name: 'tool_search',
          args: { query: 'observed use of prepared managed commands evidence' },
        }],
      };
      if (!userText.includes('사용 기록') && !userText.includes('새 대화')
        && !input.tools.some((tool) => tool.name === 'cli_prepare')) return {
        text: '', toolCalls: [{
          id: 'find-cli-prepare', name: 'tool_search',
          args: { query: 'prepare trusted managed CLI capability' },
        }],
      };
      turn += 1;
      const last = input.messages.at(-1);
      if (userText.includes('사용 기록')) {
        if (turn === 1) return { text: '', toolCalls: [{ id: 'evidence', name: 'capability_evidence', args: { action: 'inspect', kind: 'cli', id: 'json-tool' } }] };
        const evidence = JSON.parse(last.content); assert.equal(evidence.result.capability.usageRuns, 2);
        assert.equal(evidence.result.interpretationBoundary.runCompletionIsNotPurposeAchievement, true);
        return { text: '두 대화에서 실제 사용됐지만 이것만으로 품질이나 계속 보유 가치를 단정하지 않았어요.', toolCalls: [] };
      }
      if (userText.includes('새 대화')) {
        if (turn === 1) return { text: '', toolCalls: [{ id: 'reuse', name: 'exec', args: { command: 'command -v json-tool; json-tool', cwd: null, effect: observe('준비된 도구 재사용') } }] };
        const receipt = JSON.parse(last.content); assert.equal(receipt.result.stdout, `${join(stateDir, 'managed-cli/bin/json-tool')}\nmanaged-json-ok`);
        assert.equal(receipt.result.capabilitiesUsed[0].id, 'json-tool');
        return { text: '새 대화에서도 준비된 도구를 바로 사용했어요.', toolCalls: [] };
      }
      if (turn === 1) {
        return { text: '', toolCalls: [{ id: 'search', name: 'cli_prepare', args: { action: 'search', id: 'json', version: null, effect: null } }] };
      }
      const receipt = JSON.parse(last.content);
      if (turn === 2) {
        assert.equal(receipt.result.packages[0].id, 'json-tool');
        return { text: '', toolCalls: [{ id: 'install', name: 'cli_prepare', args: { action: 'install', id: 'json-tool', version: null, effect: effect('검증된 JSON 도구 준비') } }] };
      }
      if (turn === 3) {
        assert.equal(receipt.result.state, 'installed'); assert.match(receipt.result.sha256, /^[a-f0-9]{64}$/u);
        return { text: '', toolCalls: [{ id: 'use', name: 'exec', args: { command: 'json-tool', cwd: null, effect: observe('준비된 도구 사용') } }] };
      }
      assert.equal(receipt.result.stdout, 'managed-json-ok'); assert.equal(receipt.result.capabilitiesUsed[0].version, '1.0.0');
      return { text: '필요한 도구를 안전하게 준비해 바로 사용했어요.', toolCalls: [] };
    } };
  };
  let server = makeConsoleServer({
    stateDir, workspace, cliCatalogFile: catalogFile, managedCliRoot: join(stateDir, 'managed-cli'), modelFactory,
    cliFetchImpl: async () => { downloads += 1; return new Response(bytes, { status: 200 }); },
    cliVerifyExecutable: async ({ expectedVersion }) => ({ version: expectedVersion }),
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'cli-model' }),
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let base = `http://127.0.0.1:${server.address().port}`;
  try {
    const first = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const firstReply = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: first.id, text: 'JSON을 정리할 수단이 없으면 검증된 도구를 준비해서 처리해줘' }) }).then((response) => response.json());
    assert.equal(firstReply.reply, '필요한 도구를 안전하게 준비해 바로 사용했어요.');
    const firstRun = await fetch(`${base}/runs/${firstReply.runId}`).then((response) => response.json());
    assert.deepEqual(firstRun.events.filter((event) => event.type === 'tool_completed').map((event) => event.payload.receipt.actualCall.name), ['tool_search', 'cli_prepare', 'cli_prepare', 'exec']);
    const second = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const secondReply = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: second.id, text: '새 대화에서 같은 JSON 도구를 써줘' }) }).then((response) => response.json());
    assert.equal(secondReply.reply, '새 대화에서도 준비된 도구를 바로 사용했어요.');
    assert.equal(downloads, 1);
    assert.equal((await server.managedCliStore).bin, join(stateDir, 'managed-cli/bin'));
    await new Promise((resolve) => server.close(resolve));
    server = makeConsoleServer({
      stateDir, workspace, cliCatalogFile: catalogFile, managedCliRoot: join(stateDir, 'managed-cli'), modelFactory,
      cliFetchImpl: async () => { downloads += 1; return new Response(bytes, { status: 200 }); },
      cliVerifyExecutable: async ({ expectedVersion }) => ({ version: expectedVersion }),
      modelStatus: () => ({ connected: true, provider: 'test', modelId: 'cli-model' }),
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
    const third = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const thirdReply = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: third.id, text: '전에 준비한 JSON 도구의 실제 사용 기록을 확인해줘' }) }).then((response) => response.json());
    assert.match(thirdReply.reply, /두 대화에서 실제 사용/u); assert.match(thirdReply.reply, /단정하지 않았/u);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});
