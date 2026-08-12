import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ToolRunner } from '../src/runtime/tool-runner.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { makeLocalLocateTool } from '../src/runtime/local-locate.js';
import { demoDescriptors, demoEnv } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

const USER = '두 프로젝트 폴더를 나눠 조사하고 차이를 하나로 정리해줘';
const LOCATED_USER = 'Developer 폴더의 두 프로젝트를 나눠 조사하고 차이를 하나로 정리해줘';

const post = async (base, path, body) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return response.json();
};

test('H10 실제 대화는 제한 위임을 골라 두 자식을 실행하고 전부 회수한 뒤 답한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-h10-turn-'));
  const root = join(dir, 'Developer');
  const left = join(root, 'alpha');
  const right = join(root, 'beta');
  await Promise.all([mkdir(left, { recursive: true }), mkdir(right, { recursive: true })]);
  await Promise.all([
    writeFile(join(left, 'README.md'), 'alpha project'),
    writeFile(join(right, 'README.md'), 'beta project'),
  ]);

  const localFile = makeLocalFileTool({ roots: [root], dataDir: dir });
  const tools = new ToolRunner({ 'local.file': localFile });
  const descriptors = demoDescriptors({ include: ['local.file'] });
  const env = demoEnv({ include: ['local.file'], hands: ['local.file'] });
  let parentCalls = 0;
  let parentEvidence = [];
  const childCalls = [];
  const model = {
    async respond(tc, options = {}) {
      if (tc.workContractAssessment) return 'CHAT';
      const names = (options.tools ?? []).map((entry) => entry.name);
      if (tc.currentRequest === USER) {
        parentCalls += 1;
        if (parentCalls === 1) {
          assert.ok(names.includes('agent.delegate'), '실제 대화 모델에 위임 손이 보여야 한다');
          return { text: '', toolCalls: [{ name: 'agent.delegate', args: {
            goal: USER,
            partitions: [{ label: '알파', folder: left }, { label: '베타', folder: right }],
          } }] };
        }
        // 성공한 실행은 이제 **모델 자신의 도구 대화**로 온다(2026-08-03) — 계약은 그대로다:
        // 부모가 자식들의 결과를 실제로 받았는가. 재는 자리만 옮긴다.
        parentEvidence = [...(tc.evidenceFacts ?? []), ...(tc.turnExchange ?? [])];
        assert.ok(JSON.stringify(parentEvidence).includes('알파'));
        return { text: '알파와 베타 조사를 모두 회수해 차이를 통합했습니다.', toolCalls: [] };
      }

      const folder = tc.currentRequest.includes(left) ? left : right;
      const label = folder === left ? 'alpha' : 'beta';
      childCalls.push(label);
      if (!(tc.evidenceFacts?.length || tc.turnExchange?.length)) {
        assert.deepEqual(names, ['local.file'], '자식은 부모가 허용한 읽기 손만 보고 기억 통제 채널은 못 봐야 한다');
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list', path: folder } }] };
      }
      return { text: `${label} 폴더에서 README.md를 확인했습니다.`, toolCalls: [] };
    },
  };

  const server = makeServer({
    store: new SessionStore(dir), env, tools, descriptors, model,
    modelTimeoutMs: 0, processEnv: { GPAO_T5_TCELL: 'off' }, enableAgentDelegation: true,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const toolbox = await (await fetch(`${base}/toolbox`)).json();
    const delegated = toolbox.tools.find((entry) => entry.id === 'agent.delegate');
    assert.equal(delegated?.executable, true);
    assert.equal(delegated?.needsApproval, false);

    const session = await post(base, '/sessions', {});
    const turn = await post(base, '/turn', { sessionId: session.id, text: USER });
    assert.equal(turn.kind, 'reply');
    assert.match(turn.reply, /모두 회수|통합/);
    assert.equal(parentCalls, 2);
    assert.deepEqual(childCalls.sort(), ['alpha', 'alpha', 'beta', 'beta']);
    const delegatedResult = JSON.parse(parentEvidence[0].data);
    assert.equal(delegatedResult.completed, true);
    assert.ok(delegatedResult.results.every((entry) => entry.receipts === 1));
    assert.equal(turn.ledger.unconfirmed.length, 0);
    assert.doesNotMatch(turn.reply, /run-|agent-|\/tmp\//);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('H10 실제 대화는 locate가 확인한 기본 범위 밖 폴더를 같은 턴의 읽기 위임으로 잇는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-h10-located-turn-'));
  const staticRoot = join(dir, 'GPAO-T5');
  const root = join(dir, 'Developer');
  const left = join(root, 'alpha');
  const right = join(root, 'beta');
  await Promise.all([
    mkdir(staticRoot, { recursive: true }),
    mkdir(left, { recursive: true }),
    mkdir(right, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(left, 'package.json'), '{"name":"alpha"}'),
    writeFile(join(right, 'package.json'), '{"name":"beta"}'),
  ]);

  const localFile = makeLocalFileTool({ roots: [staticRoot], homeDir: dir, dataDir: staticRoot });
  const localLocate = makeLocalLocateTool({ home: dir });
  const tools = new ToolRunner({ 'local.file': localFile, 'local.locate': localLocate });
  const descriptors = demoDescriptors({ include: ['local.file', 'local.locate'] });
  const env = demoEnv({ include: ['local.file', 'local.locate'], hands: ['local.file', 'local.locate'] });
  let parentCalls = 0;
  const childCalls = [];
  const model = {
    async respond(tc, options = {}) {
      if (tc.workContractAssessment) return 'CHAT';
      const names = (options.tools ?? []).map((entry) => entry.name);
      if (tc.currentRequest === LOCATED_USER) {
        parentCalls += 1;
        if (parentCalls === 1) {
          return { text: '', toolCalls: [{
            name: 'local.locate', args: { what: '프로젝트', from: 'Developer' },
          }] };
        }
        if (parentCalls === 2) {
          assert.ok(names.includes('agent.delegate'));
          assert.match(JSON.stringify([tc.evidenceFacts, tc.turnExchange]), /alpha/);
          return { text: '', toolCalls: [{ name: 'agent.delegate', args: {
            goal: LOCATED_USER,
            partitions: [{ label: '알파', folder: left }, { label: '베타', folder: right }],
          } }] };
        }
        assert.match(JSON.stringify([tc.evidenceFacts, tc.turnExchange]), /completed/);
        return { text: '두 프로젝트를 나눠 읽고 결과를 통합했습니다.', toolCalls: [] };
      }

      const folder = tc.currentRequest.includes(left) ? left : right;
      const label = folder === left ? 'alpha' : 'beta';
      childCalls.push(label);
      if (!(tc.evidenceFacts?.length || tc.turnExchange?.length)) {
        assert.deepEqual(names, ['local.file']);
        return { text: '', toolCalls: [{
          name: 'local.file', args: { action: 'read', path: join(folder, 'package.json') },
        }] };
      }
      return { text: `${label} package.json을 확인했습니다.`, toolCalls: [] };
    },
  };

  const server = makeServer({
    store: new SessionStore(dir), env, tools, descriptors, model,
    modelTimeoutMs: 0, processEnv: { GPAO_T5_TCELL: 'off' }, enableAgentDelegation: true,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await post(base, '/sessions', {});
    const turn = await post(base, '/turn', { sessionId: session.id, text: LOCATED_USER });
    assert.equal(turn.kind, 'reply');
    assert.match(turn.reply, /통합/);
    assert.equal(parentCalls, 3);
    assert.deepEqual(childCalls.sort(), ['alpha', 'alpha', 'beta', 'beta']);
    assert.equal(turn.ledger.unconfirmed.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
