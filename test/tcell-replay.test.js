// S4 · 반복 학습과 실질 replay. 계획 §4.3·§4.4·§4.6.
//
// 봉인 실측: 같은 정리를 세 번 반복해도 학습 0, 새 대화에서 다시 물었다(H02).
//
// 이 슬라이스의 위험은 "학습이 안 되는 것"이 아니라 **잘못 배운 것이 행동에 들어가는 것**이다.
// 그래서 검사의 대부분이 승격을 막는 쪽에 있다:
//   ① replay 는 실제 실행 증거와 결합돼야 한다 — 정상 영수증을 다른 케이스에 붙일 수 없다
//   ② 모델 호출 신분(자격·endpoint·요청 모델)이 검증된 호출만 증거 자격을 갖는다
//   ③ 최소 suite(positive≥2·negative≥1·boundary≥2, 권한 닿으면 authority≥1)를 못 채우면 불통과
//   ④ 표본 없음·판정 불가는 통과가 아니다
//   ⑤ 승격된 원리만 입장하고, replay 미통과는 절대 입장하지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryStore } from '../src/surface/memory-store.js';
import { admittedContext } from '../src/kernel/l1-intent/context-mesh.js';
import {
  makeReplayCase, caseInputDigestOf, makeReplayCallReceipt,
  verifyReplayEvidence, judgeSuite, SUITE_MINIMUM,
} from '../src/kernel/l5-growth/tcell-replay.js';

const 원리 = { principleId: 'p-1', principleVersion: 3, statement: '보고서는 짧은 목록으로 정리한다' };

const 케이스 = (over = {}) => makeReplayCase({
  caseId: 'c-1', ...원리, kind: 'positive',
  sourceRefs: [{ sessionId: 's1', turnSeq: 2 }],
  inputFacts: ['사용자가 월별 정리를 요청했다'],
  expectedFacts: ['짧은 목록으로 정리한다'],
  forbiddenFacts: ['표로 정리한다'],
  ...over,
});

/** 검증된 호출 신분 하나(§4.6). */
const 신분 = (over = {}) => ({
  callId: 'call-1',
  selection: {
    requestedRole: 'growth', resolution: 'bound',
    connectionInstanceId: 'conn-A', credentialRef: 'cred-A',
    providerId: 'openai', endpointOrigin: 'https://api.openai.com', requestModelId: 'gpt-5.1',
  },
  actualEndpointOrigin: 'https://api.openai.com',
  actualRequestModelId: 'gpt-5.1',
  responseModelId: 'gpt-5.1',
  responseIdentitySource: 'response_field',
  startedAt: 1, finishedAt: 2,
  ...over,
});

/** 그 케이스를 실제로 돌린 영수증. */
function 영수증(c, over = {}) {
  return makeReplayCallReceipt({
    receiptId: 'r-1', caseId: c.caseId,
    principleId: c.principleId, principleVersion: c.principleVersion,
    caseInputDigest: c.caseInputDigest,
    requestDigest: c.caseInputDigest, // 요청이 그 케이스 입력으로 만들어졌다는 결합
    outputDigest: 'out-1',
    modelCallIdentity: 신분(),
    startedAt: 1, finishedAt: 2, state: 'completed',
    ...over,
  });
}

const 저장소 = (receipts) => ({ get: (id) => receipts.find((r) => r.receiptId === id) ?? null });

// ── ① 영수증-케이스 결합 ─────────────────────────────────────────────────
test('S4: 그 케이스를 실제로 돌린 영수증만 실행 증거다', () => {
  const c = 케이스();
  const r = 영수증(c);
  const v = verifyReplayEvidence(c, { runReceiptRef: r.receiptId, store: 저장소([r]), outputDigest: 'out-1' });
  assert.equal(v.ok, true, v.reason);
});

test('S4: 무관한 정상 영수증을 붙이면 증거로 인정하지 않는다', () => {
  const c = 케이스();
  const 남의케이스 = 케이스({ caseId: 'c-다른', inputFacts: ['전혀 다른 입력'] });
  const 남의영수증 = 영수증(남의케이스, { receiptId: 'r-남' });
  const v = verifyReplayEvidence(c, { runReceiptRef: 'r-남', store: 저장소([남의영수증]), outputDigest: 'out-1' });
  assert.equal(v.ok, false);
  assert.match(v.reason, /case|digest/i);
});

test('S4: 호출자가 넘긴 영수증 객체를 믿지 않고 저장소에서 조회한다', () => {
  const c = 케이스();
  const 위조 = 영수증(c, { receiptId: 'r-위조' });
  // 저장소에는 없는 영수증을 객체로 넘긴다 — 통과하면 안 된다.
  const v = verifyReplayEvidence(c, {
    runReceiptRef: 'r-위조', store: 저장소([]), receipt: 위조, outputDigest: 'out-1',
  });
  assert.equal(v.ok, false, '저장되지 않은 영수증은 증거가 아니다');
});

for (const [이름, over] of [
  ['principleId', { principleId: 'p-다름' }],
  ['principleVersion', { principleVersion: 99 }],
  ['caseInputDigest', { caseInputDigest: 'digest-다름' }],
  ['requestDigest 결합', { requestDigest: 'req-다름' }],
]) {
  test(`S4: ${이름} 하나만 달라도 증거가 아니다`, () => {
    const c = 케이스();
    const r = 영수증(c, over);
    const v = verifyReplayEvidence(c, { runReceiptRef: r.receiptId, store: 저장소([r]), outputDigest: 'out-1' });
    assert.equal(v.ok, false, `${이름} 불일치가 통과했다`);
  });
}

test('S4: 저장된 출력이 영수증의 outputDigest 와 다르면 증거가 아니다', () => {
  const c = 케이스();
  const r = 영수증(c);
  const v = verifyReplayEvidence(c, { runReceiptRef: r.receiptId, store: 저장소([r]), outputDigest: 'out-바뀜' });
  assert.equal(v.ok, false, '출력 교체가 통과했다');
});

test('S4: 미완료 영수증은 증거가 아니다', () => {
  const c = 케이스();
  const r = 영수증(c, { state: 'running', finishedAt: null });
  const v = verifyReplayEvidence(c, { runReceiptRef: r.receiptId, store: 저장소([r]), outputDigest: 'out-1' });
  assert.equal(v.ok, false);
});

// ── ② 모델 호출 신분 (§4.6) ───────────────────────────────────────────────
for (const [이름, over] of [
  ['endpoint 불일치', { actualEndpointOrigin: 'https://다른곳' }],
  ['요청 모델 불일치', { actualRequestModelId: 'gpt-4o' }],
  ['응답 모델 비호환', { responseModelId: '전혀-다른-모델' }],
]) {
  test(`S4: ${이름} 이면 산출물을 격리한다`, () => {
    const c = 케이스();
    const r = 영수증(c, { modelCallIdentity: 신분(over) });
    const v = verifyReplayEvidence(c, { runReceiptRef: r.receiptId, store: 저장소([r]), outputDigest: 'out-1' });
    assert.equal(v.ok, false, `${이름} 이 통과했다`);
  });
}

test('S4: 응답 모델을 보고하지 않는 provider 는 "검증됨"을 주장하지 않는다', () => {
  const c = 케이스();
  const r = 영수증(c, {
    modelCallIdentity: 신분({ responseModelId: null, responseIdentitySource: 'not_reported' }),
  });
  const v = verifyReplayEvidence(c, { runReceiptRef: r.receiptId, store: 저장소([r]), outputDigest: 'out-1' });
  assert.equal(v.ok, true, '요청 신분이 검증되면 실행 증거 자격은 있다');
  assert.equal(v.responseIdentityVerified, false, '응답 신분은 검증됐다고 말하지 않는다');
});

test('S4: 역할 이름이나 provider:model 문자열은 호출 신분이 아니다', () => {
  // endpoint·요청 모델은 **전부 맞는데** 자격·인스턴스 신분만 없는 경우를 겨냥한다.
  // 다른 이유로 떨어지면 이 계약을 증명하지 못한다(첫 판이 그래서 반증을 놓쳤다).
  const c = 케이스();
  const 신분없음 = 신분({
    selection: {
      requestedRole: 'growth', resolution: 'active',
      providerId: 'openai', endpointOrigin: 'https://api.openai.com', requestModelId: 'gpt-5.1',
      // connectionInstanceId·credentialRef 없음 — 같은 provider/model 의 다른 자격을 구분 못 한다
    },
  });
  const r = 영수증(c, { modelCallIdentity: 신분없음 });
  const v = verifyReplayEvidence(c, { runReceiptRef: r.receiptId, store: 저장소([r]), outputDigest: 'out-1' });
  assert.equal(v.ok, false, 'connectionInstanceId·credentialRef 없이는 신분이 아니다');
  assert.equal(v.reason, 'identity_not_instance_scoped', '떨어진 이유가 신분 문제여야 한다');
});

test('S4: 같은 provider·model 이라도 다른 자격이면 다른 신분이다', () => {
  const c = 케이스();
  const 다른자격 = 신분({
    selection: { ...신분().selection, connectionInstanceId: 'conn-B', credentialRef: 'cred-B' },
  });
  const r = 영수증(c, { modelCallIdentity: 다른자격 });
  const v = verifyReplayEvidence(c, { runReceiptRef: r.receiptId, store: 저장소([r]), outputDigest: 'out-1' });
  assert.equal(v.ok, true, '자격이 달라도 그 호출 자체가 일관되면 증거 자격은 있다');
  assert.notEqual(다른자격.selection.credentialRef, 신분().selection.credentialRef, '신분은 구분된다');
});

// ── ③ 최소 suite ─────────────────────────────────────────────────────────
const 판정 = (kind, pass) => ({ kind, verdict: { pass }, evidenceOk: true });

test('S4: 최소 suite 를 채워야 통과다', () => {
  const 충분 = [
    판정('positive', true), 판정('positive', true),
    판정('negative', true),
    판정('boundary', true), 판정('boundary', true),
  ];
  assert.equal(judgeSuite(충분).pass, true);
});

for (const [이름, cases] of [
  ['positive 부족', [판정('positive', true), 판정('negative', true), 판정('boundary', true), 판정('boundary', true)]],
  ['negative 0건', [판정('positive', true), 판정('positive', true), 판정('boundary', true), 판정('boundary', true)]],
  ['boundary 부족', [판정('positive', true), 판정('positive', true), 판정('negative', true), 판정('boundary', true)]],
  ['표본 없음', []],
]) {
  test(`S4: ${이름} 이면 통과가 아니다`, () => {
    assert.equal(judgeSuite(cases).pass, false, `${이름} 이 통과했다`);
  });
}

test('S4: positive 하나라도 실패하면 통과가 아니다', () => {
  const cases = [
    판정('positive', true), 판정('positive', false),
    판정('negative', true), 판정('boundary', true), 판정('boundary', true),
  ];
  assert.equal(judgeSuite(cases).pass, false);
});

test('S4: 권한에 닿는 원리는 authority 케이스 없이 통과하지 않는다', () => {
  const cases = [
    판정('positive', true), 판정('positive', true),
    판정('negative', true), 판정('boundary', true), 판정('boundary', true),
  ];
  assert.equal(judgeSuite(cases, { touchesAuthority: true }).pass, false, 'authority 누락');
  assert.equal(judgeSuite([...cases, 판정('authority', true)], { touchesAuthority: true }).pass, true);
});

test('S4: 실행 증거가 없는 판정은 세지 않는다', () => {
  const cases = [
    { kind: 'positive', verdict: { pass: true }, evidenceOk: false },
    판정('positive', true), 판정('negative', true), 판정('boundary', true), 판정('boundary', true),
  ];
  assert.equal(judgeSuite(cases).pass, false, '증거 없는 통과는 표본이 아니다');
});

test('S4: 판정 불가(verdict 없음)는 통과가 아니다', () => {
  const cases = [
    { kind: 'positive', evidenceOk: true }, 판정('positive', true),
    판정('negative', true), 판정('boundary', true), 판정('boundary', true),
  ];
  assert.equal(judgeSuite(cases).pass, false);
});

// ── ④ 입장 경계 ──────────────────────────────────────────────────────────
test('S4: replay 미통과 원리는 입장하지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-replay-'));
  const mem = new MemoryStore(dir);
  const m = await mem.load();
  m.promoted = [{
    candidateId: 'x', kind: 'operating_principle', statement: '보고서는 짧은 목록으로 정리한다',
    admitted: true, userConfirmed: true, replayPassed: false, // 미통과
  }];
  await mem.save(m);
  const admitted = admittedContext(await mem.load(), '보고서 정리해줘');
  assert.deepEqual(admitted, [], 'replay 미통과는 프롬프트에 오르지 않는다');
});

test('S4: caseInputDigest 는 케이스 내용으로 결정된다', () => {
  const a = 케이스();
  const b = 케이스();
  assert.equal(a.caseInputDigest, b.caseInputDigest, '같은 내용이면 같은 digest');
  const c = 케이스({ expectedFacts: ['다른 기대'] });
  assert.notEqual(a.caseInputDigest, c.caseInputDigest, '내용이 다르면 다른 digest');
  assert.equal(caseInputDigestOf(a), a.caseInputDigest, '독립 계산과 일치');
});

test('S4: 최소 suite 수치는 계획 고정값이다', () => {
  assert.equal(SUITE_MINIMUM.positive, 2);
  assert.equal(SUITE_MINIMUM.negative, 1);
  assert.equal(SUITE_MINIMUM.boundary, 2);
  assert.equal(SUITE_MINIMUM.authority, 1);
});
