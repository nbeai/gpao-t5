// **이미 놓은 사실을 다시 새것처럼 놓지 않는다** (M5 연속성 계약 ②).
//
// 계약 원문: "이미 사용자에게 말한 사실은 다시 말하지 않는다 — 원장이 '이 턴에 처음 나온
// 것'을 이미 알고 있으므로 **판단이 아니라 대조다**."
//
// 실측(2026-08-03, 실서버 3턴): `[바깥 자료에 닿는 현실]` 1,524자가 **바이트까지 동일하게**
// 세 번 다시 놓였다. 턴 맥락 2.5KB 중 1,830자가 축자 반복이었다. 모델이 매 턴 능력을 다시
// 읊는 것은 모델 탓이 아니라 우리가 매 턴 **처음인 것처럼** 놓았기 때문이다.
//
// ── 이 검사가 지키는 두 방향 ────────────────────────────────────────────
//  ① 두 번째부터는 "이미 놓였다"는 사실이 함께 간다.
//  ② **사실은 하나도 줄지 않는다.** 이 블록을 조건부로 빼는 길은 이미 실패한 길이다 —
//     그렇게 했더니 "있는 브라우저 손을 두고 복붙을 시켰다"(external-service.js 흉터).
//     ②가 없으면 이 계약은 다음 사람에게 "덜 실으면 되는구나"로 읽힌다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realitySignature, realityDelta } from '../src/kernel/l1-intent/external-service.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

const selfState = buildSelfState(demoEnv());

const 현실 = (서비스) => ({ reach: [{ label: '웹 자료 수집' }], services: 서비스 });

test('첫 턴에는 아무 말도 얹지 않는다 — 그때는 정말 새 사실이다', () => {
  const d = realityDelta(null, realitySignature(현실([{ label: '노션', connected: false }])));
  assert.deepEqual(d, { first: true });
});

test('바뀐 것이 없으면 "이미 놓였다"가 사실로 붙는다', () => {
  const 지문 = realitySignature(현실([{ label: '노션', connected: false }]));
  assert.deepEqual(realityDelta(지문, 지문), { same: true });
});

test('바뀐 것이 있으면 무엇이 바뀌었는지 말한다 — 뭉뚱그리지 않는다', () => {
  const 전 = realitySignature(현실([{ label: '노션', connected: false }]));
  const 후 = realitySignature(현실([{ label: '노션', connected: true }]));
  assert.deepEqual(realityDelta(전, 후), { changed: ['노션 연결됨'] });
  assert.deepEqual(realityDelta(후, 전), { changed: ['노션 연결 끊김'] });
});

test('서비스가 늘거나 없어진 것도 바뀐 것이다', () => {
  const 전 = realitySignature(현실([{ label: '노션', connected: true }]));
  const 후 = realitySignature(현실([{ label: '노션', connected: true }, { label: '슬랙', connected: false }]));
  assert.deepEqual(realityDelta(전, 후), { changed: ['슬랙 새로 생김'] });
  assert.deepEqual(realityDelta(후, 전), { changed: ['슬랙 없어짐'] });
});

// ── ② 사실은 줄지 않는다 ─────────────────────────────────────────────────
test('대조가 붙어도 현실 자체는 그대로 실린다(빼는 길로 새지 않는다)', () => {
  const 현실값 = 현실([{ label: '노션', connected: false }]);
  const 지문 = realitySignature(현실값);
  const 첫턴 = buildTaskContext({
    intent: { desiredOutcome: '무엇' }, selfState,
    externalReality: 현실값, externalRealityDelta: realityDelta(null, 지문),
  });
  const 다음턴 = buildTaskContext({
    intent: { desiredOutcome: '무엇' }, selfState,
    externalReality: 현실값, externalRealityDelta: realityDelta(지문, 지문),
  });
  assert.deepEqual(다음턴.externalReality, 첫턴.externalReality, '두 번째 턴에서 현실이 깎였다 — 능력이 사라진다');
  assert.deepEqual(다음턴.externalReality, 현실값, '현실이 원본과 달라졌다');
  assert.equal(첫턴.externalRealityDelta?.first, true);
  assert.equal(다음턴.externalRealityDelta?.same, true);
});

test('대조 결과가 없으면 아무 것도 얹지 않는다(없는 사실을 지어내지 않는다)', () => {
  const 현실값 = 현실([{ label: '노션', connected: false }]);
  const tc = buildTaskContext({
    intent: { desiredOutcome: '무엇' }, selfState, externalReality: 현실값,
  });
  assert.equal(tc.externalRealityDelta, undefined);
  assert.deepEqual(tc.externalReality, 현실값, '대조가 없다고 현실까지 빠지면 안 된다');
});

test('현실이 아예 없으면 대조도 없다', () => {
  assert.equal(realitySignature(undefined), null);
  assert.equal(realityDelta(null, null), null);
});
