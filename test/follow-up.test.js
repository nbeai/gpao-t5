import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideFollowUp } from '../src/kernel/l2-plan/follow-up.js';

// S07: 충돌 없는 추가 요구는 merge.
test('충돌 없으면 merge', () => {
  const e = decideFollowUp({ runningTask: '비교표 작성', incomingInput: '환율도 넣어줘', conflict: false });
  assert.equal(e.decision, 'merge');
  assert.match(e.userNotice, /이어서/);
});

// S08: 충돌하는 지시는 interrupt, 현재 작업 안전 저장 안내.
test('충돌하면 interrupt 하고 현재 작업 저장을 알린다', () => {
  const e = decideFollowUp({ runningTask: '비교표 작성', incomingInput: '멈추고 메일부터', conflict: true });
  assert.equal(e.decision, 'interrupt');
  assert.match(e.userNotice, /저장/);
});

// Phase 5.1(§8.1): candidateKind 계약 자리 — 기본 none, 명시하면 반영.
test('candidateKind 기본 none, 호출자가 명시하면 반영', () => {
  assert.equal(decideFollowUp({ runningTask: 't', incomingInput: 'i' }).candidateKind, 'none');
  assert.equal(
    decideFollowUp({ runningTask: 't', incomingInput: 'i', candidateKind: 'automation' }).candidateKind,
    'automation',
  );
});
