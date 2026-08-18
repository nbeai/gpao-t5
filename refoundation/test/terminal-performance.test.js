import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  TERMINAL_PERFORMANCE_CASES,
  assessTerminalPerformanceCase,
  materializeTerminalPerformanceCase,
  snapshotTerminalRoom,
} from '../src/terminal-performance.js';

test('성능 자격은 표현·규모·모호성·실패 전환의 서로 다른 축을 가진다', () => {
  assert.deepEqual(TERMINAL_PERFORMANCE_CASES.map((entry) => entry.dimension), [
    'expression', 'scale', 'ambiguity', 'failure_recovery',
  ]);
  assert.equal(new Set(TERMINAL_PERFORMANCE_CASES.map((entry) => entry.request)).size, 4);
});

test('표현 fixture의 기대 경로는 실제 생성된 파일과 정확히 일치한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-terminal-expression-test-'));
  try {
    const definition = TERMINAL_PERFORMANCE_CASES.find((entry) => entry.dimension === 'expression');
    const fixture = await materializeTerminalPerformanceCase(definition, room);
    const snapshot = await snapshotTerminalRoom(room);
    assert.ok(snapshot[fixture.expectedPath]);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('모호한 수정 요청은 둘 중 하나를 임의 변경하면 실패한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-terminal-performance-test-'));
  try {
    const definition = TERMINAL_PERFORMANCE_CASES.find((entry) => entry.dimension === 'ambiguity');
    const fixture = await materializeTerminalPerformanceCase(definition, room);
    const before = await snapshotTerminalRoom(room);
    const east = join(room, 'configs', 'comet-east.txt');
    const afterUnchanged = await snapshotTerminalRoom(room);
    const safe = assessTerminalPerformanceCase({
      definition, fixture, before, after: afterUnchanged,
      agentResult: {
        status: 'completed', answer: '두 개가 있어 east와 west 중 어느 것인지 알려주세요.',
        receipts: [{ actualCall: { name: 'exec' }, outcome: 'succeeded', result: { exitCode: 0 } }],
      },
    });
    assert.equal(safe.passed, true);

    const { writeFile } = await import('node:fs/promises');
    await writeFile(east, 'SERVICE: comet\nREGION: east\nSTATE: completed\n', 'utf8');
    const changed = assessTerminalPerformanceCase({
      definition, fixture, before, after: await snapshotTerminalRoom(room),
      agentResult: {
        status: 'completed', answer: 'east를 완료로 바꿨습니다.',
        receipts: [{ actualCall: { name: 'exec' }, outcome: 'succeeded', result: { exitCode: 0 } }],
      },
    });
    assert.equal(changed.passed, false);

    const wasteful = assessTerminalPerformanceCase({
      definition, fixture, before, after: afterUnchanged,
      agentResult: {
        status: 'completed', answer: '둘 중 실제 사용 지역을 판단할 근거가 없어 알려주세요.',
        modelTurns: 9,
        receipts: Array.from({ length: 8 }, (_, index) => ({
          actualCall: { name: 'exec', args: { command: `observation-${index}` } },
          outcome: 'succeeded', result: { exitCode: 0 },
        })),
      },
    });
    assert.equal(wasteful.passed, false);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('실패 복구는 실패한 rg 뒤 다른 수단의 성공이 실제 영수증에 있어야 한다', () => {
  const definition = TERMINAL_PERFORMANCE_CASES.find((entry) => entry.dimension === 'failure_recovery');
  const base = {
    definition,
    fixture: { expectedMemo: 'MEMO: fallback reached the beacon' }, before: {}, after: {},
  };
  const withoutRecovery = assessTerminalPerformanceCase({
    ...base,
    agentResult: {
      status: 'completed', answer: 'MEMO: fallback reached the beacon',
      receipts: [{
        actualCall: { name: 'exec', args: { command: 'rg beacon .' } },
        outcome: 'failed', result: { exitCode: 69 },
      }],
    },
  });
  assert.equal(withoutRecovery.passed, false);

  const recovered = assessTerminalPerformanceCase({
    ...base,
    agentResult: {
      status: 'completed', answer: 'MEMO: fallback reached the beacon',
      receipts: [
        { actualCall: { name: 'exec', args: { command: 'rg beacon .' } }, outcome: 'failed', result: { exitCode: 69 } },
        { actualCall: { name: 'exec', args: { command: 'grep -R beacon .' } }, outcome: 'succeeded', result: { exitCode: 0 } },
      ],
    },
  });
  assert.equal(recovered.passed, true);
});
