import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/kernel/l1-intent/intent.js';

// S01/S02: 인사·지식 질문은 fast_chat.
test('잡담·지식 질문은 fast_chat', () => {
  assert.equal(interpret('안녕, 오늘 좀 피곤하네.').answerMode, 'fast_chat');
  assert.equal(interpret('포모도로 기법이 뭐야?').answerMode, 'fast_chat');
});

// S05: 조사·작성은 complex_work.
test('조사·작성 요청은 complex_work', () => {
  assert.equal(interpret('경쟁사 가격정책 조사해서 표 만들어줘').answerMode, 'complex_work');
});

// S20: 외부 전송은 A2 경계로 추정.
test('메일 발송은 A2 경계', () => {
  const i = interpret('이 초안 그 사람한테 메일로 보내줘');
  assert.equal(i.answerMode, 'complex_work');
  assert.equal(i.authorityBoundary, 'A2');
});

// S22: 삭제·공개는 A3 경계.
test('삭제는 A3 경계', () => {
  assert.equal(interpret('이 파일들 삭제해줘').authorityBoundary, 'A3');
});

// S04: 짧고 지시대상이 대명사뿐인 행동 요구는 확인 필요.
test('"그거 정리 좀"은 확인 필요', () => {
  assert.equal(interpret('그거 정리 좀').needsClarification, true);
});

// §2 규칙: 원문은 왜곡·요약하지 않는다.
test('currentRequest 는 원문 그대로 보존', () => {
  const raw = '  경쟁사 3곳 가격정책 조사해서 비교표 초안 만들어줘  ';
  assert.equal(interpret(raw).currentRequest, raw);
});
