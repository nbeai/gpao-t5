// **한 일과 말한 일이 같아야 한다** — 실행·판정·보고가 같은 인자를 본다.
//
// 라이브 실측(2026-07-27, 텔레그램·화면 양쪽에 같은 답이 나감):
//   방 → "메모5.md 만들어서 오늘 할 일 세 개 적어줘"
//   원장 args.text →  오늘 할 일
//                     1. 물 충분히 마시고 20분 쉬기
//                     2. 가장 중요한 일 하나만 먼저 끝내기
//                     3. 자기 전 책상이나 작업 공간 10분 정리하기
//   실제 파일       →  (원장과 같음)
//   T5 답변         →  # 오늘 할 일
//                     - 물 충분히 마시기
//                     - 머리 아프면 20분 쉬기
//                     - 오늘 만든 메모 파일들 확인하기
//
// 세 줄이 전부 다르다. 거짓말을 하려던 게 아니라 **모델이 자기가 보낸 인자를 다시 못 봤다.**
// 프롬프트에는 요약("저장했어요")과 결과({path,bytes})만 있었고 내용이 없어서, 모델은
// "내가 쓰려던 것"을 기억으로 재구성했다. 짧은 값("세번째")은 우연히 맞아 세 번을 통과했다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';
import { receipt } from '../src/kernel/l0-evidence/tool-receipt.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';

const selfState = buildSelfState(demoEnv());
const intent = { currentRequest: '메모5.md 만들어줘', answerMode: 'complex_work', authorityBoundary: 'user' };

const 적은내용 = '오늘 할 일\n1. 물 충분히 마시고 20분 쉬기\n2. 가장 중요한 일 하나만 먼저 끝내기\n3. 자기 전 책상 정리하기\n';
const 쓰기영수증 = receipt({
  intended: '메모를 저장한다',
  actualCall: { tool: 'local.file', args: { action: 'write', path: '메모5.md', text: 적은내용 } },
  result: { path: '/Users/x/GPAO-T5/메모5.md', bytes: 120 },
  userSafeSummary: '메모5.md 에 저장했어요.',
});

test('모델은 자기가 무엇을 적었는지 프롬프트에서 다시 볼 수 있다', () => {
  // 성공한 실행은 **모델 자신의 도구 호출**로 간다 — 인자가 곧 "내가 무엇을 적었나"다.
  const tc = buildTaskContext({ intent, selfState, receipts: [쓰기영수증] });
  const x = tc.turnExchange?.[0];
  assert.ok(x, '실행 사실이 있어야 한다');
  assert.ok(x.args, '무엇으로 불렀는지가 없으면 모델은 내용을 기억으로 지어낸다');
  assert.match(JSON.stringify(x.args), /가장 중요한 일 하나만 먼저 끝내기/, '적은 내용이 그대로 보여야 한다');
});

test('그 사실이 실제 프롬프트 문자열까지 도달한다(패킷에만 있으면 소용없다)', () => {
  const tc = buildTaskContext({ intent, selfState, receipts: [쓰기영수증] });
  const 전문 = JSON.stringify(buildModelMessages(tc));
  assert.match(전문, /가장 중요한 일 하나만 먼저 끝내기/, '프롬프트에 없으면 모델은 못 본다');
});

test('실패한 실행 인자는 확인된 실행과 분리해 시도값으로 보인다', () => {
  const 실패 = receipt({
    intended: '파일을 지운다',
    actualCall: { tool: 'local.file', args: { action: 'delete', path: '없는파일.md' } },
    failureState: 'blocked',
    userSafeSummary: '찾지 못했어요.',
  });
  const tc = buildTaskContext({ intent, selfState, receipts: [실패] });
  // S1 슬라이스는 실패한 호출을 교환으로 옮긴다(계약 ②) — 자리는 달라도 계약은 같다:
  // ① 확인된 실행 사실 칸에는 안 올린다 ② 무엇을 시도했는지는 볼 수 있다.
  const 실패기록 = tc.evidenceFacts?.[0] ?? tc.turnExchange?.[0];
  assert.ok(실패기록, '실패 사실이 어느 자리에도 없다');
  assert.equal(실패기록.calledWith, undefined, '실패한 인자를 성공한 호출 사실로 올렸다');
  assert.match(JSON.stringify(실패기록), /없는파일\.md/, '무엇을 시도했는지가 사라지면 모델은 같은 것을 또 부른다');
});

test('인자가 없는 도구도 깨지지 않는다', () => {
  const 빈것 = receipt({
    intended: '목록을 본다', actualCall: { tool: 'local.file' },
    result: { items: [] }, userSafeSummary: '비어 있어요.',
  });
  const tc = buildTaskContext({ intent, selfState, receipts: [빈것] });
  assert.deepEqual(tc.turnExchange[0].args, {}, '없는 것을 지어내지 않는다');
  assert.doesNotMatch(JSON.stringify(buildModelMessages(tc)), /undefined/, '빈 인자가 문자열로 새지 않는다');
});
