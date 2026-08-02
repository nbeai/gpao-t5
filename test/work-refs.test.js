import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCompletionContractRef,
  assertReceiptRef,
  assertSubjectRef,
  assertWorkRef,
  inheritSubjectRef,
  issueCompletionContractRef,
  issueReceiptRef,
  issueSubjectRef,
  issueWorkRef,
} from '../src/kernel/l0-evidence/work-refs.js';

const KEY = Buffer.alloc(32, 0x2a);
const OTHER_KEY = Buffer.alloc(32, 0x19);
const TURN = Object.freeze({ sessionId: 'session-1', turnSeq: 7 });
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

test('ReceiptRef는 같은 원천에서 결정적이며 한 턴의 여러 영수증을 ordinal로 구분한다', () => {
  const binding = { turnRef: TURN, turnOrdinal: 0, receiptDigest: DIGEST_A };
  const first = issueReceiptRef(binding, KEY);
  const again = issueReceiptRef(binding, KEY);
  const second = issueReceiptRef({ ...binding, turnOrdinal: 1 }, KEY);

  assert.equal(first, again);
  assert.notEqual(first, second);
  assert.deepEqual(assertReceiptRef(first, binding, KEY), binding);
  assert.deepEqual(assertReceiptRef(second, { ...binding, turnOrdinal: 1 }, KEY), {
    ...binding,
    turnOrdinal: 1,
  });
});

test('ReceiptRef는 TurnRef·ordinal·receipt digest 중 하나라도 다르면 결합 검증을 거부한다', () => {
  const binding = { turnRef: TURN, turnOrdinal: 0, receiptDigest: DIGEST_A };
  const ref = issueReceiptRef(binding, KEY);

  assert.throws(() => assertReceiptRef(ref, { ...binding, turnRef: { ...TURN, turnSeq: 8 } }, KEY));
  assert.throws(() => assertReceiptRef(ref, { ...binding, turnOrdinal: 1 }, KEY));
  assert.throws(() => assertReceiptRef(ref, { ...binding, receiptDigest: DIGEST_B }, KEY));
});

test('완료 ReceiptRef는 WorkRef와 CompletionContractRef를 같은 서명 안에 결합한다', () => {
  const workRef = issueWorkRef({ turnRef: TURN, workOrdinal: 0 }, KEY);
  const completionContractRef = issueCompletionContractRef({
    workRef, contractDigest: DIGEST_B,
  }, KEY);
  const binding = {
    turnRef: TURN, turnOrdinal: 0, receiptDigest: DIGEST_A,
    workRef, completionContractRef,
  };
  const ref = issueReceiptRef(binding, KEY);

  assert.deepEqual(assertReceiptRef(ref, binding, KEY), binding);
  const otherWorkRef = issueWorkRef({ turnRef: TURN, workOrdinal: 1 }, KEY);
  assert.throws(() => issueReceiptRef({ ...binding, workRef: otherWorkRef }, KEY));
});

test('모델이 꾸민 모양·다른 OS 키·여분 필드는 내부 ref로 수용되지 않는다', () => {
  const binding = { turnRef: TURN, turnOrdinal: 0, receiptDigest: DIGEST_A };
  const ref = issueReceiptRef(binding, KEY);
  const forged = `${ref.slice(0, -1)}${ref.endsWith('A') ? 'B' : 'A'}`;

  assert.throws(() => assertReceiptRef(forged, binding, KEY));
  assert.throws(() => assertReceiptRef(ref, binding, OTHER_KEY));
  assert.throws(() => issueReceiptRef({ ...binding, modelRef: ref }, KEY));
});

test('WorkRef는 최초 작업 발급 사실에만 결합되고 산출물 변화와 무관하게 안정적이다', () => {
  const binding = { turnRef: TURN, workOrdinal: 0 };
  const ref = issueWorkRef(binding, KEY);

  assert.equal(issueWorkRef(binding, KEY), ref);
  assert.deepEqual(assertWorkRef(ref, binding, KEY), binding);
  assert.equal(issueWorkRef({ ...binding }, KEY), ref, '산출물 집합은 WorkRef 입력이 아니다');
  assert.throws(() => issueWorkRef({ ...binding, artifactDigest: DIGEST_A }, KEY));
  assert.throws(() => assertWorkRef(ref, { ...binding, workOrdinal: 1 }, KEY));
});

test('CompletionContractRef는 검증된 WorkRef와 계약 digest를 함께 결합한다', () => {
  const workBinding = { turnRef: TURN, workOrdinal: 0 };
  const workRef = issueWorkRef(workBinding, KEY);
  const binding = { workRef, contractDigest: DIGEST_A };
  const ref = issueCompletionContractRef(binding, KEY);

  assert.equal(issueCompletionContractRef(binding, KEY), ref);
  assert.deepEqual(assertCompletionContractRef(ref, binding, KEY), binding);
  assert.throws(() => assertCompletionContractRef(ref, { ...binding, contractDigest: DIGEST_B }, KEY));
  assert.throws(() => issueCompletionContractRef({ ...binding, workRef: 'wr1.model-supplied' }, KEY));
});

test('subjectRef는 최초 사건에서만 발급하고 수정·철회는 검증 후 같은 신분을 상속한다', () => {
  const binding = { turnRef: TURN, eventOrdinal: 2 };
  const subjectRef = issueSubjectRef(binding, KEY);

  assert.deepEqual(assertSubjectRef(subjectRef, binding, KEY), binding);
  assert.equal(inheritSubjectRef(subjectRef, KEY), subjectRef);
  assert.throws(() => inheritSubjectRef('sr1.model-supplied', KEY));
  assert.throws(() => issueSubjectRef({ ...binding, inheritedFrom: 'sr1.model-supplied' }, KEY));
});

test('발급 입력은 strict하다: 불완전 TurnRef, 약한 digest, 음수 ordinal, 짧은 키를 거부한다', () => {
  assert.throws(() => issueReceiptRef({
    turnRef: { sessionId: 'session-1' }, turnOrdinal: 0, receiptDigest: DIGEST_A,
  }, KEY));
  assert.throws(() => issueReceiptRef({
    turnRef: TURN, turnOrdinal: -1, receiptDigest: DIGEST_A,
  }, KEY));
  assert.throws(() => issueWorkRef({
    turnRef: { sessionId: 'session-1', turnSeq: 0 }, workOrdinal: 0,
  }, KEY));
  assert.throws(() => issueReceiptRef({
    turnRef: TURN, turnOrdinal: 0, receiptDigest: 'abc',
  }, KEY));
  assert.throws(() => issueReceiptRef({
    turnRef: TURN, turnOrdinal: 0, receiptDigest: DIGEST_A,
  }, Buffer.alloc(16)));
  assert.throws(() => issueWorkRef({
    turnRef: { ...TURN, migratedTurnRef: true }, workOrdinal: 0,
  }, KEY));
});
