import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';

const selfState = buildSelfState({
  model: { id: 'beai5-stub' },
  connections: [{ id: 'web.collect', connected: true, executable: true }],
});

// §11: 사실·경계를 주고 판단·문장은 모델에 남긴다.
test('Task Context Packet 은 원문을 보존하고 naturalness 를 열어둔다', () => {
  const intent = interpret('안녕');
  const tc = buildTaskContext({ intent, selfState });
  assert.equal(tc.currentRequest, '안녕'); // 왜곡 금지
  assert.equal(tc.naturalness, 'method_and_language_open');
  assert.equal(tc.answerMode, 'fast_chat');
});

test('선언된 사실만 담고 지시문을 담지 않는다', () => {
  const intent = interpret('포모도로가 뭐야?');
  const tc = buildTaskContext({ intent, selfState });
  // selfStateFacts 는 값 사실만: 문자열 지시("반드시", "해라")가 없어야 한다.
  const json = JSON.stringify(tc.selfStateFacts);
  assert.doesNotMatch(json, /반드시|해라|하지 마|instruction/);
  assert.ok('model' in tc.selfStateFacts);
});

test('evidenceFacts 는 userSafeSummary 만 담고 diagnosticTrace 를 담지 않는다', () => {
  const intent = interpret('뉴스 수집해줘');
  const receipts = [{
    intended: '수집', actualCall: { tool: 'web.collect' }, failureState: 'none',
    userSafeSummary: '공개 자료로 확인', diagnosticTrace: { stack: 'secret' },
  }];
  const tc = buildTaskContext({ intent, selfState, receipts });
  // 성공한 실행은 교환으로 간다 — 진단면 비노출 계약은 **어느 자리로 가든** 그대로다.
  const json = JSON.stringify([tc.evidenceFacts, tc.turnExchange]);
  assert.match(json, /공개 자료로 확인/);
  assert.doesNotMatch(json, /secret|stack/);
});

test('실패한 호출의 절대 경로는 실행 사실로 승격되거나 원문 재공급되지 않는다', () => {
  const intent = interpret('다운로드에 뭐 있어?');
  const tc = buildTaskContext({ intent, selfState, receipts: [{
    intended: '파일 목록',
    actualCall: { tool: 'local.file', args: { action: 'list', path: '/Users/someone/Downloads' } },
    failureState: 'blocked', userSafeSummary: '그 자리는 확인하지 못했어요.',
  }] });
  assert.equal(tc.evidenceFacts[0].calledWith, undefined, '실패한 인자를 실행 사실 칸에 넣었다');
  assert.match(tc.evidenceFacts[0].attemptedWith, /확인되지 않은 절대 경로/);
  assert.doesNotMatch(JSON.stringify(tc.evidenceFacts), /\/Users\/someone/);
});

// ── C 감사 F4.2 · 파일 본문의 줄 구조를 모델 입력에서 지우지 않는다 ───────
// 실측(감사 2026-08-01): local.file read 결과가 ③ JSON 갈래로 떨어져 \s+ 접기에
// 줄바꿈이 전부 사라졌다 — CSV·정산표의 행 경계를 모델이 근거 없이 재구성해야 했다.
test('F4.2: 파일 읽기 결과는 줄 구조를 보존해 모델에 간다', async () => {
  const { compactResult } = await import('../src/kernel/l1-intent/task-context.js');
  const 파일결과 = { path: '/자리/정산.csv', text: '항목,금액\n임대료,500000\n전기요금,120000\n', bytes: 40 };
  const 요약 = compactResult(파일결과);
  assert.match(요약, /임대료,500000\n전기요금,120000/,
    `줄 경계가 사라졌다 — 행 재구성은 근거 없는 추측이 된다: ${JSON.stringify(요약)}`);
});

test('F4.2: 긴 파일은 접되, 접었다는 표식과 앞뒤가 남는다', async () => {
  const { compactResult } = await import('../src/kernel/l1-intent/task-context.js');
  const 줄들 = Array.from({ length: 200 }, (_, i) => `${i}행,${i * 1000}`).join('\n');
  const 요약 = compactResult({ path: '/자리/큰표.csv', text: 줄들, bytes: 줄들.length });
  assert.ok(요약.length < 1500, '접기가 안 됐다 — 프롬프트를 삼킨다');
  assert.match(요약, /생략/, '접었다는 표식이 없다 — 모델이 전부 본 줄 안다');
  assert.match(요약, /0행,0/, '앞부분이 사라졌다');
  assert.match(요약, /199행,199000/, '결론(뒷부분)이 통째로 사라졌다');
});
