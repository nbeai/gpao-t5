// **S2 — 차단도 실패도 모델에게 결과로 돌아간다.**
//
// 원리 ⑤(OpenClaw `buildBlockedToolResult`/`buildToolExecutionErrorResult`):
// 커널이 호출을 막았으면 **막았다는 사실을 프로세스에게 돌려준다.** 사용자에게 직접 말하지 않는다.
//
// T5 가 어긋나 있던 자리 둘:
//   ① 실행됐지만 실패한 호출은 플래그(`T5_MODEL_SOVEREIGN`)를 켜야만 교환으로 갔다.
//   ② **실행 전에 막힌 호출은 플래그를 켜도 교환에 안 갔다.** `못한호출남기기` 가 만드는
//      영수증은 `actualCall: null` 이라 `부른것` 필터(`r?.actualCall?.tool`)에 안 걸린다.
//      모델은 자기가 낸 호출이 어떻게 됐는지 **산문으로만** 받았고, 그나마 그 산문은
//      사용자 메시지에 있었다(S1 에서 시스템으로 옮겼다).
//
// 그래서 모델은 "내가 call_xxx 로 시킨 게 어떻게 됐지"를 구조로 물을 수 없었다.
// 라이브 실측(오너 첫 대화): 사용자가 새 URL 을 줬는데 화면에 나간 답이
//   *"그 사이트가 수집을 허용하지 않아요. **방금 한 것과 같은 일이라 다시 하지 않았어요.**"*
// 가운데 문장은 런타임이 스스로 건너뛴 내부 사정이고, 사용자 기준으로는 사실도 아니다.
//
// A/B 실측 근거(2026-08-03·04, 같은 발화 "내 다운로드 폴더 깔끔하게 정리 좀 하고 싶다", gpt-5.1):
//   A(기준선) 실물 이동 성공 1/4 · 모델 왕복 평균 9.5 · 심문호출 매회 2
//   B(모델주도) 실물 이동 성공 5/7 · 모델 왕복 평균 7.1 · 심문호출 0
//   → 계약 ③(실패도 교환)은 **켠다**. ①②(심문 미실행)는 이 칸의 일이 아니다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';

const 영수증 = (over = {}) => ({
  intended: 'web.collect 실행', failureState: 'none', userSafeSummary: '읽었어요.', ...over,
});

const 맥락 = (receipts) => buildTaskContext({
  intent: { currentRequest: '이 주소 좀 봐줘', answerMode: 'complex_work', authorityBoundary: 'user' },
  selfState: { connectedTools: [], currentModel: { id: 'gpt-5.1' }, limits: [] },
  receipts,
});

test('① 실행됐지만 실패한 호출이 **플래그 없이** 교환에 남는다', () => {
  const p = 맥락([영수증({
    failureState: 'blocked',
    actualCall: { tool: 'web.collect', args: { request: 'https://a.example' }, providerCallId: 'call_1', callRef: 'c1' },
    userSafeSummary: '그 사이트가 수집을 허용하지 않아요.',
  })]);
  const x = (p.turnExchange ?? []).find((e) => e.providerCallId === 'call_1');
  assert.ok(x, `실패한 호출이 교환에 없다: ${JSON.stringify(p.turnExchange ?? [])}`);
  assert.equal(x.tool, 'web.collect');
  assert.equal(x.failureState, 'blocked', '왜 안 됐는지가 모델에게 안 간다');
});

test('② **실행 전에 막힌 호출도** 교환에 남는다 — 모델이 낸 호출과 결과가 짝이다', () => {
  const p = 맥락([영수증({
    failureState: 'blocked',
    actualCall: null,
    제안한호출: { tool: 'web.collect', args: { request: 'https://b.example' }, providerCallId: 'call_2', callRef: 'c2' },
    userSafeSummary: '먼저 확인할 게 있어 이건 아직 안 했어요.',
  })]);
  const x = (p.turnExchange ?? []).find((e) => e.providerCallId === 'call_2');
  assert.ok(x, `막힌 호출이 교환에 없다 — 모델은 자기 호출이 어떻게 됐는지 구조로 못 본다:
${JSON.stringify(p.turnExchange ?? [])}`);
  assert.equal(x.tool, 'web.collect');
  assert.equal(x.failureState, 'blocked');
});

// **부르지 않은/실패한 호출의 인자는 확인된 값이 아니다.**
// 계약(`02375fe`)은 원래 산문 자리(`evidenceFacts.attemptedWith`)에서 지켜졌다.
// S2 가 그 호출들을 **교환으로 옮겼으므로 계약도 그 자리로 따라온다** — 안 따라오면
// 실패한 모델 추측이 "T5 가 실제로 그 경로로 실행했다"는 사실로 둔갑한다.
test('②-a 막힌 호출의 인자는 **가려서** 간다 — 추측이 사실이 되지 않는다', () => {
  const p = 맥락([영수증({
    failureState: 'blocked', actualCall: null,
    제안한호출: {
      tool: 'local.file',
      args: { action: 'delete', path: '/Users/someone/비밀/폴더/원장.csv' },
      providerCallId: 'call_M', callRef: 'cM',
    },
  })]);
  const x = (p.turnExchange ?? []).find((e) => e.providerCallId === 'call_M');
  assert.ok(x, '막힌 호출이 교환에 없다');
  const 전문 = JSON.stringify(x);
  assert.doesNotMatch(전문, /\/Users\/someone\/비밀\/폴더/,
    `실행되지 않은 절대 경로가 확인된 값처럼 실렸다: ${전문}`);
  assert.match(전문, /확인되지 않은/, '가렸다는 표시가 없다 — 지운 자국은 남아야 한다');
});

test('②-b 실행됐지만 실패한 호출의 인자도 같은 계약을 받는다', () => {
  const p = 맥락([영수증({
    failureState: 'blocked',
    actualCall: {
      tool: 'local.file', args: { action: 'read', path: '/Users/someone/비밀/폴더/x.csv' },
      providerCallId: 'call_N', callRef: 'cN',
    },
  })]);
  const x = (p.turnExchange ?? []).find((e) => e.providerCallId === 'call_N');
  assert.doesNotMatch(JSON.stringify(x), /\/Users\/someone\/비밀\/폴더/,
    '실패한 호출의 절대 경로가 사실처럼 실렸다');
});

test('②-c 성공한 호출의 인자는 **원문 그대로** 간다(가림이 과잉이면 안 된다)', () => {
  const p = 맥락([영수증({
    actualCall: {
      tool: 'local.file', args: { action: 'read', path: '/Users/someone/문서/보고서.md' },
      providerCallId: 'call_O', callRef: 'cO',
    },
    result: { text: '내용' },
  })]);
  const x = (p.turnExchange ?? []).find((e) => e.providerCallId === 'call_O');
  assert.equal(x.args.path, '/Users/someone/문서/보고서.md',
    '성공한 호출의 인자까지 가렸다 — 모델이 자기가 무엇으로 불렀는지 잃는다');
});

test('③ 같은 사실을 두 번 주지 않는다 — 교환이 가져간 것은 산문에 없다', () => {
  const p = 맥락([영수증({
    failureState: 'blocked', actualCall: null,
    제안한호출: { tool: 'web.collect', args: {}, providerCallId: 'call_3', callRef: 'c3' },
  })]);
  const 산문 = p.evidenceFacts ?? [];
  assert.equal(산문.find((f) => f.providerCallId === 'call_3'), undefined,
    '교환과 산문에 같은 호출이 두 벌로 실렸다');
});

test('④ 되풀이로 런타임이 스스로 건너뛴 것도 모델에게는 간다(사용자면과 다른 계약)', () => {
  const p = 맥락([영수증({
    failureState: 'cancelled', actualCall: null,
    제안한호출: { tool: 'web.collect', args: {}, providerCallId: 'call_4', callRef: 'c4' },
    userSafeSummary: '방금 한 것과 같은 일이라 다시 하지 않았어요.',
  })]);
  const x = (p.turnExchange ?? []).find((e) => e.providerCallId === 'call_4');
  assert.ok(x, '런타임이 건너뛴 사실이 모델에게 안 갔다 — 모델은 자기 호출이 사라진 줄 안다');
  assert.equal(x.failureState, 'cancelled', '건너뛴 것과 막힌 것을 구분해서 준다');
});

test('⑤ 성공한 호출은 예전 그대로 결과를 들고 간다(기존 계약 유지)', () => {
  const p = 맥락([영수증({
    actualCall: { tool: 'web.collect', args: {}, providerCallId: 'call_5', callRef: 'c5' },
    result: { text: '읽은 내용' },
  })]);
  const x = (p.turnExchange ?? []).find((e) => e.providerCallId === 'call_5');
  assert.ok(x);
  assert.ok(x.data, '성공 결과가 안 실렸다');
  assert.equal(x.failureState, undefined, '성공에 실패 상태가 붙었다');
});
