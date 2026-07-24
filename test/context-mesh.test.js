import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectCandidate, isInfluenceEligible, admittedContext, makeCandidate, promote, runReplay,
} from '../src/kernel/l1-intent/context-mesh.js';

// 후보 감지: preference / operating_principle / 없음(자동 승격 아님).
test('detectCandidate: 선호와 운영원리를 kind로 분리, 일반 발화는 null', () => {
  assert.equal(detectCandidate('안녕 오늘 뭐하지')?.kind ?? null, null);
  assert.equal(detectCandidate('보고서는 항상 글로 받는 게 좋아').kind, 'preference');
  assert.equal(detectCandidate('외부에 보낼 땐 무조건 나한테 확인받아').kind, 'operating_principle');
});

// 핵심 안전 불변식: operating_principle 은 replayPassed && userConfirmed 전에는 영향 자격 없음.
test('operating_principle은 replay+승인 전에는 영향 자격 없음', () => {
  const e = makeCandidate('c1', 'operating_principle', '외부 전송 전 확인');
  assert.equal(isInfluenceEligible(e), false);                                  // 후보
  assert.equal(isInfluenceEligible({ ...e, userConfirmed: true }), false);      // 승인만 — replay 없음
  assert.equal(isInfluenceEligible({ ...e, replayPassed: true }), false);       // replay만 — 승인 없음
  assert.equal(isInfluenceEligible({ ...e, replayPassed: true, userConfirmed: true }), true);
});

test('preference는 userConfirmed 전에는 영향 자격 없음', () => {
  const e = makeCandidate('c2', 'preference', '보고서는 글로');
  assert.equal(isInfluenceEligible(e), false);
  assert.equal(isInfluenceEligible({ ...e, userConfirmed: true }), true);
});

// admittedContext: 승격·영향가능·관련된 것만 좁게. 미승격 후보·replay 전 원리는 절대 입장 금지.
test('admittedContext는 승격·영향가능·관련된 것만 좁게 입장한다', () => {
  const promotedPref = { ...makeCandidate('c3', 'preference', '보고서는 글로 받기'), userConfirmed: true };
  const confirmedButNoReplay = { ...makeCandidate('c4', 'operating_principle', '외부 전송 전 확인'), userConfirmed: true };
  const candidate = makeCandidate('c5', 'preference', '커피 좋아함');
  const memory = { promoted: [promotedPref, confirmedButNoReplay], candidates: [candidate] };

  // "보고서" 요청 → 관련된 승격 선호만 입장.
  assert.deepEqual(admittedContext(memory, '보고서 정리해줘'), ['보고서는 글로 받기']);
  // replay 안 된 운영원리는 관련돼도 입장 금지(행동 영향 0).
  assert.deepEqual(admittedContext(memory, '외부 전송 관련'), []);
  // 관련 없으면 입장 안 함(좁게).
  assert.deepEqual(admittedContext(memory, '날씨 어때'), []);
});

// promote: 게이트를 코드로 강제.
test('promote 게이트: 승인 없으면 needs_user_confirm, 원리는 replay 없으면 needs_replay', () => {
  const pref = makeCandidate('c6', 'preference', 'x');
  assert.equal(promote(pref, {}).ok, false);
  assert.equal(promote(pref, {}).reason, 'needs_user_confirm');
  assert.equal(promote(pref, { userConfirmed: true }).ok, true);

  const prin = makeCandidate('c7', 'operating_principle', 'y');
  assert.equal(promote(prin, { userConfirmed: true }).reason, 'needs_replay');
  const ok = promote(prin, { userConfirmed: true, replayPassed: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.entry.replayPassed, true);
});

test('runReplay: 명시적 과거 모순이 없으면 통과, preference는 replay 불요', () => {
  const prin = makeCandidate('c8', 'operating_principle', '외부 전송 전 확인');
  assert.equal(runReplay(prin, []), true);
  assert.equal(runReplay(prin, ['안 외부 전송 전 확인']), false); // 명시적 모순
  assert.equal(runReplay(makeCandidate('c9', 'preference', 'z'), ['안 z']), true); // 선호는 항상 통과
});
