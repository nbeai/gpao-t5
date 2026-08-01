import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

function sequenceModel(outputs, fallback = '완료했어요') {
  let index = 0;
  return {
    async respond(_tc, opts = {}) {
      if (!opts.tools?.length) return fallback;
      return outputs[index++] ?? { text: fallback, toolCalls: [] };
    },
  };
}

test('W2 통제 제안은 빠른 답에서 실행되지 않고 소비자까지 보존된다', async () => {
  const skill = { name: '주간 정산', purpose: '매주 정산표를 만든다' };
  const automation = { statement: '매주 금요일 정산', kind: 'weekly' };
  const agent = { name: '정산 담당', purpose: '정산을 점검한다' };
  const result = await runTurn({ text: '이런 역할들을 준비해줘' }, {
    env: demoEnv(),
    tools: demoTools(),
    model: sequenceModel([{ text: '후보로 준비할게요', toolCalls: [
      { name: 'skill.propose', args: skill },
      { name: 'automation.propose', args: automation },
      { name: 'agent.propose', args: agent },
    ] }]),
  });

  assert.equal(result.kind, 'reply');
  assert.deepEqual(result.skillProposal, skill);
  assert.deepEqual(result.automationProposal, automation);
  assert.deepEqual(result.agentProposal, agent);
  assert.deepEqual(result.ledger.confirmed, [], '후보 제출이 실행 영수증을 만들었다');
});

test('W2 통제 제안은 승인 대기 경로에서도 사라지지 않는다', async () => {
  const automation = { statement: '매일 오래된 파일 삭제', kind: 'daily' };
  const result = await runTurn({ text: '매일 오래된.md를 지워줘' }, {
    env: demoEnv(),
    tools: demoTools(),
    pending: new Map(),
    model: sequenceModel([{ text: '예약 후보를 만들고 삭제 확인을 받을게요', toolCalls: [
      { name: 'automation.propose', args: automation },
      { name: 'local.file', args: { action: 'delete', path: '오래된.md' } },
    ] }]),
  });

  assert.equal(result.kind, 'approval');
  assert.deepEqual(result.automationProposal, automation);
});

test('W2 통제 제안은 다단계 도구 실행 뒤에도 보존된다', async () => {
  const agent = { name: '폴더 점검 담당', purpose: '폴더 상태를 점검한다' };
  const terminal = {
    async probe(command) {
      return { command, cwd: '/tmp', changes: false, probe: { exitCode: 0, stdout: 'ok', stderr: '' } };
    },
    async handler(args) {
      return { result: { command: args.command, exitCode: 0, stdout: 'ok', cwd: '/tmp' }, userSafeSummary: '확인했어요.' };
    },
  };
  const result = await runTurn({ text: '상태를 보고 담당 역할도 준비해줘' }, {
    env: demoEnv(),
    tools: demoTools({ localTerminal: terminal }),
    model: sequenceModel([
      { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'pwd' } }] },
      { text: '점검했어요', toolCalls: [{ name: 'agent.propose', args: agent }] },
    ]),
  });

  assert.equal(result.kind, 'reply');
  assert.deepEqual(result.agentProposal, agent);
});
