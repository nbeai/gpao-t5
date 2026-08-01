import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeAgentDelegateTool } from '../src/runtime/agent-delegate-tool.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 't5-agent-delegate-tool-'));
  const left = join(root, 'left');
  const right = join(root, 'right');
  await Promise.all([mkdir(left), mkdir(right)]);
  const calls = [];
  const runtime = {
    async delegateUserRequest(request) {
      calls.push(request);
      return {
        parent: { id: 'internal-parent', childRunIds: ['internal-a', 'internal-b'] },
        children: [],
      };
    },
    async executeDelegation() {
      return {
        ready: true,
        status: 'succeeded',
        results: [
          { status: 'succeeded', result: { reply: '왼쪽 결과' }, receipts: [{}] },
          { status: 'succeeded', result: { reply: '오른쪽 결과' }, receipts: [{}] },
        ],
      };
    },
  };
  const localFile = makeLocalFileTool({ roots: [root], dataDir: root });
  return { root, left, right, calls, tool: makeAgentDelegateTool({ runtime: () => runtime, localFile }) };
}

test('agent.delegate는 OS가 확인한 폴더 안에서만 두세 갈래 읽기 위임을 만든다', async () => {
  const { left, right, calls, tool } = await fixture();
  const out = await tool.handler({
    goal: '두 폴더의 문서를 읽고 차이를 요약해줘',
    partitions: [{ label: '왼쪽', folder: left }, { label: '오른쪽', folder: right }],
  });

  assert.equal(out.blocked, undefined);
  assert.equal(out.result.completed, true);
  assert.deepEqual(out.result.results.map((entry) => entry.reply), ['왼쪽 결과', '오른쪽 결과']);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].authorityEnvelope.allowedKinds, ['read', 'summarize']);
  assert.deepEqual(calls[0].authorityEnvelope.allowedTools, ['local.file']);
  assert.equal(calls[0].authorityEnvelope.maxRuns, 2);
  assert.equal(calls[0].budgets.maxConcurrency, 2);
  assert.doesNotMatch(out.userSafeSummary, /internal-|\/tmp\//);
});

test('agent.delegate는 범위 밖 폴더와 민감 목표를 실행 기록에 남기지 않는다', async () => {
  const { left, calls, tool } = await fixture();
  const outside = await tool.handler({
    goal: '두 폴더 조사',
    partitions: [{ folder: left }, { folder: '/etc' }],
  });
  assert.equal(outside.blocked, true);
  assert.equal(calls.length, 0);

  const sensitive = await tool.handler({
    goal: '두 폴더 조사, 비밀번호 huntertwo',
    partitions: [{ folder: left }, { folder: left }],
  });
  assert.equal(sensitive.blocked, true);
  assert.equal(calls.length, 0);
});
