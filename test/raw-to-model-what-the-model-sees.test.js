// **모델이 보는 것을 날것으로** — 셋을 한 덩어리로 (2026-08-11)
//
// 비교군(Hermes)에서 가져온 것은 문구가 아니라 **축** 셋이다. 전부 「모델이 무엇을 보는가」다.
//
//   ① 종결 판정을 문장이 아니라 **원장**에서   — 어미를 바꾸면 뚫리는 그물을 원장으로 옮긴다
//   ② 실패의 **기계 원문**을 모델에게          — 지금은 실패하면 내용이 0자 간다
//   ③ 잘라낸 가운데로 가는 **문**              — 뺀 양은 밝히는데 나머지로 갈 길이 없다
//
// 셋 다 T5 자신의 계약이 이미 요구하던 것이다:
//   · *"원장은 실제로 일어난 결과만 확정한다"* — 그런데 거짓 완료를 잡는 마지막 문에서 말투를 봤다
//   · *"실패한 결과를 사실로 승격하지 않는다"* — 승격하지 않는 것과 **안 주는 것**은 다르다
//   · 정본 §S3 *"조용한 절단 금지 — 뺀 양 · 뺀 것의 성질 · 문"* — 셋 중 문이 미구현이었다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 완료주장검증, 빈손으로끝났나 } from '../src/kernel/l2-plan/exit-verification.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { buildTaskContext, compactResult } from '../src/kernel/l1-intent/task-context.js';

const selfState = buildSelfState({
  model: { id: 'beai5-stub' },
  connections: [{ id: 'local.file', connected: true, executable: true }],
});

const 읽음 = (이름) => ({
  intended: '자료 읽기',
  actualCall: { tool: 'local.file', args: { action: 'read', path: `/방/${이름}` } },
  failureState: 'none',
  userSafeSummary: `${이름} 을(를) 읽었어요.`,
  result: { path: `/방/${이름}`, text: '항목,금액\n임대료,500000\n' },
});

// ── ① 종결 판정을 문장이 아니라 원장에서 ─────────────────────────────────
//
// 지금 `완료주장인가` 는 **종성 ㅆ 구조**(했·갔·왔·뒀·냈…)로 과거형을 잡는다. 목록보다 낫지만
// 여전히 **말투**다. 그 아래에 걸린 두 그물(원장 밖 파일 이름 · 원장 밖 자리)은 판정 재료가
// 처음부터 원장인데, 문 앞에 말투 검사가 서 있어 어미 하나로 통째로 닫힌다.

test('① 원장 밖 파일 이름 그물은 어미가 과거형이 아니어도 열린다', () => {
  // 실측 모양(P-OP ⑥): 성공한 쓰기 0 인 턴이 "만든 통합 결과는 …csv" 라고 답했다.
  // 여기서는 같은 거짓을 **현재진행 어미**로 쓴다 — `담는 중이에요` 에는 ㅆ 받침이 없다.
  const r = 완료주장검증({
    reply: '세 자료를 합친 내용은 7월_통합_정산.csv 로 담는 중이에요.',
    receipts: [읽음('A사_7월.csv')],
    원장글: 'local.file read /방/A사_7월.csv — A사_7월.csv 을(를) 읽었어요.',
  });
  assert.equal(r.일치, false, '어미를 바꾸자 원장 대조가 통째로 닫혔다');
  assert.equal(r.사용자에게, false);
  assert.match(r.모델에게, /7월_통합_정산\.csv/);
});

test('① 원장 밖 자리 그물도 같은 문을 탄다', () => {
  const r = 완료주장검증({
    reply: '설치·압축 파일은 Downloads/_정리됨/설치_및_압축/ 으로 넘기는 중이에요.',
    receipts: [읽음('목록.txt')],
    원장글: 'local.file read /방/목록.txt',
  });
  assert.equal(r.일치, false, '자리 대조도 말투 뒤에 갇혀 있다');
  assert.match(r.모델에게, /설치_및_압축/);
});

test('① 반례 — 물음·제안·정직한 미완료는 그대로 지나간다', () => {
  // 문을 넓히면서 심문·제안까지 물면 그건 개입이다. 세 반례를 함께 못박는다.
  const 원장글 = 'local.file read /방/A사_7월.csv';
  for (const 답 of [
    '합친 결과를 7월_통합_정산.csv 로 만들까요?',
    'Downloads/_정리됨/설치_및_압축/ 으로 옮길지 골라 주세요.',
    '아직 7월_통합_정산.csv 는 못 만들었어요.',
  ]) {
    const r = 완료주장검증({ reply: 답, receipts: [읽음('A사_7월.csv')], 원장글 });
    assert.equal(r.일치, true, `대조 대상이 아닌 답을 물었다: ${답}`);
  }
});

test('① 빈손 판정은 원장을 받으면 원장이 지배한다 — 어미는 보조로 내려간다', () => {
  // 지금은 `게요·겠습니다·겠어요` 와 물음표만 본다. 같은 뜻을 다른 어미로 쓰면 새 나간다.
  const 약속들 = [
    '바로 이 작업부터 해 볼게요',            // 지금도 잡힌다
    '바로 이 작업부터 해 봅니다',            // 어미만 바꿨다 — 지금은 샌다
    '이제 그 자리를 확인하러 갑니다',        // 같은 모양
  ];
  for (const 답 of 약속들) {
    assert.equal(빈손으로끝났나(답, { 가져온것: 0 }), true,
      `원장이 빈손인데 말투로 빠져나갔다: ${답}`);
  }
  // 반대 방향도 원장이 지배한다 — 원장에 성과가 있으면 말투가 약속형이어도 빈손이 아니다.
  assert.equal(빈손으로끝났나('이어서 나머지도 확인해 볼게요', { 가져온것: 2 }), false,
    '원장에 성과가 있는데 말투로 빈손이 됐다');
  // 정직한 미완료는 어느 쪽에서도 빈손이 아니다.
  assert.equal(빈손으로끝났나('아직 그 자리는 못 봤어요', { 가져온것: 0 }), false);
  // 원장을 안 주면 지금 그대로다(부르는 쪽이 아직 안 넘긴 자리를 깨지 않는다).
  assert.equal(빈손으로끝났나('바로 이 작업부터 해 볼게요'), true);
});

// ── ② 실패의 기계 원문을 모델에게 ────────────────────────────────────────
//
// 계약 *"실패한 결과를 사실로 승격하지 않는다"* 는 옳고 그대로 둔다. 그런데 지금은 승격만
// 막는 게 아니라 **내용을 통째로 안 준다** — 모델이 받는 것은 5값 상태 토큰과 사람말 요약뿐이다.
// T5 자신의 시험이 이미 그 대가를 적어 뒀다(cu-c-effect-not-dispatch):
//   *"사유 없는 실패가 회차 원본에 남아 원인 확정을 막았고, 모델은 그 빈자리를
//     「환경이 막혀서」로 메웠다."*

test('② 막힌 손의 기계 원문이 「확인 안 됨」 표식과 함께 모델에게 간다', () => {
  const tc = buildTaskContext({
    intent: interpret('카카오톡 창을 앞으로 띄워줘'),
    selfState,
    receipts: [{
      intended: '창 앞으로',
      actualCall: { tool: 'desktop.act', args: { action: 'focus', app: 'KakaoTalk' } },
      failureState: 'failed',
      userSafeSummary: '그 창을 앞으로 못 옮겼어요.',
      diagnosticTrace: { 오류: 'AXUIElementPerformAction kAXErrorCannotComplete (-25204)' },
      nextSafeAction: '다시 시도할까요?',
    }],
  });
  const x = (tc.turnExchange ?? [])[0];
  assert.ok(x, '실패 교환이 없다');
  const 글 = JSON.stringify(x);
  assert.match(글, /kAXErrorCannotComplete/, '실패의 기계 원문이 모델에게 0자 간다');
  assert.match(글, /확인 안 됨/, '표식 없이 실었다 — 그러면 사실로 승격된다');
  assert.equal(x.failureState, 'failed', '상태 토큰은 그대로여야 한다');
  assert.equal(x.data, undefined, '실패한 결과를 data 로 승격했다');
});

test('② 성공한 실행에는 진단면이 붙지 않는다 — 문은 실패에만 열린다', () => {
  const tc = buildTaskContext({
    intent: interpret('뉴스 수집해줘'),
    selfState,
    receipts: [{
      intended: '수집',
      actualCall: { tool: 'web.collect', args: {} },
      failureState: 'none',
      userSafeSummary: '공개 자료로 확인',
      diagnosticTrace: { stack: '내부스택표식ZZ' },
      result: { title: '뉴스', markdown: '본문' },
    }],
  });
  assert.doesNotMatch(JSON.stringify(tc), /내부스택표식ZZ/, '성공 교환에 진단면이 샜다');
});

test('② 기계 원문도 조용히 자르지 않는다 — 뺀 양을 밝힌다', () => {
  const 긴것 = 'E'.repeat(9000);
  const tc = buildTaskContext({
    intent: interpret('터미널로 확인해줘'),
    selfState,
    receipts: [{
      intended: '실행',
      actualCall: { tool: 'local.terminal', args: { command: 'ls' } },
      failureState: 'failed',
      userSafeSummary: '실행에 실패했어요.',
      diagnosticTrace: { message: 긴것 },
    }],
  });
  const 글 = String((tc.turnExchange ?? [])[0]?.실패원문 ?? '');
  assert.ok(글.length > 100 && 글.length < 4000, `상한이 없다: ${글.length}자`);
  assert.match(글, /생략/, '조용히 잘랐다 — 뺀 양을 안 밝혔다');
});

// ── ③ 잘라낸 가운데로 가는 문 ────────────────────────────────────────────
//
// `local.file read` 는 이미 `offset`·`limit`·`nextOffset` 을 갖고 있다(local-file.js §문).
// **문은 손에 있는데 모델 입력에 안 실렸다** — 모델은 "가운데 N자 생략" 만 받고 나머지로 갈
// 인자를 몰랐다. 새 저장소를 만들 일이 아니라 있는 문을 여는 일이다.

test('③ 접힌 파일 본문에 나머지로 가는 문이 실린다', () => {
  const 줄들 = Array.from({ length: 400 }, (_, i) => `${i}행,${i * 1000}`).join('\n');
  const 요약 = compactResult({
    path: '/방/큰표.csv', text: 줄들, bytes: 줄들.length, totalChars: 줄들.length, offset: 0,
  });
  assert.match(요약, /생략/, '뺀 양 표식이 사라졌다');
  assert.match(요약, /offset=\d+/, '나머지로 가는 문이 없다 — 잘렸다는 말만 하고 막은 것이다');
  assert.match(요약, /0행,0/, '앞부분이 사라졌다');
  assert.match(요약, /399행,399000/, '결론(뒷부분)이 사라졌다');
});

test('③ 손이 이미 쪽을 넘긴 파일은 그 다음 쪽 문을 그대로 옮긴다', () => {
  const 요약 = compactResult({
    path: '/방/아주큰표.csv',
    text: '가운데쪽 내용',
    bytes: 100_000,
    totalChars: 100_000,
    offset: 20_000,
    nextOffset: 40_000,
  });
  assert.match(요약, /전체 100000자/, '전체 크기를 모델이 못 본다');
  assert.match(요약, /offset=40000/, '손이 쥔 다음 쪽 문이 모델 입력에서 사라졌다');
});

test('③ 반례 — 통째로 실린 짧은 파일에는 문을 달지 않는다', () => {
  const 요약 = compactResult({ path: '/방/작은표.csv', text: '항목,금액\n임대료,500000\n', bytes: 30 });
  assert.doesNotMatch(요약, /offset=/, '자르지도 않았는데 문을 달아 소음을 만들었다');
});
