// **S7 ③ — 사실 공급을 분류기가 정하지 않는다**(F-18 의 두 자리).
//
// 오너 지적(2026-08-05): *"③이 안 됐다. 계획서 S7 착수 조건이 **정의역에 F-18 두 자리를 함께
// 넣는다**고 적었다. 둘 다 살아 있다. ①은 착수 조건 ②를 그 자리가 어기고 있다 —
// `answerMode` 는 발화에서 나온다. **'계산 경로'를 도구 목록 만드는 곳으로만 좁게 잡았다.**
// F-18 의 병은 도구가 아니라 **사실 공급**이다 — limits 와 기억이 걸러진다."*
//
// 맞다. 앞선 커밋의 grep 은 `tool-schema·model-control·self-state·tool-offer` 넷에 걸었는데,
// 계획서가 파일명까지 적어 둔 자리는 **`task-context.js` · `context-mesh.js`** 다.
// 엉뚱한 곳을 재고 통과시켰다.
//
// ── 두 자리 ──────────────────────────────────────────────────────────────
// (**갱신 2026-08-14 · F-115**: ① 은 플래그를 졸업해 기본값이 됐다 — 아래 ③ 참조.
//  ② 는 그대로 플래그 안에 산다. 아래 원문은 등재 당시 기록으로 남긴다.)
//   ① `limits: answerMode === 'fast_chat' ? [] : summary.limits`
//      **발화 분류가 "무엇을 못 하는지"를 통째로 지운다.** 실측하니 그 사실은 **79자**다
//      (3줄: 메일·슬랙·텔레그램 연결 안내). 79자를 아끼려고 한계를 지우면 모델은
//      "슬랙 보낼 수 있어?"에 짐작으로 답한다. (원 주석이 걱정한 "설명서를 통째로"는
//      `readyCapabilities` 쪽이고 `limits` 가 아니다 — 그래서 그건 안 건드린다.)
//   ② `사례 없으면 낱말로` — 검증 사례가 없는 원칙을 **발화 낱말 겹침**으로 든다.
//      모르는 범위를 낱말로 짐작하는 것이다. 모르면 안 드는 것이 맞다
//      (이 파일이 이미 적어 뒀다: *"잘못 든 원리가 안 든 원리보다 나쁘다"*).
//
// **행동이 바뀌므로 플래그를 둔다**(오너 지시 ⑤). 끄면 기준선과 글자 하나 안 달라야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { admittedContext } from '../src/kernel/l1-intent/context-mesh.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';
import { 사실공급 } from '../src/kernel/model-sovereign.js';

const 켬 = { T5_FACTS_UNFILTERED: '1' };
const 끔 = {};

const 재료 = (answerMode, env) => {
  const selfState = buildSelfState(demoEnv());
  return buildTaskContext({
    intent: { currentRequest: '안녕', answerMode, neededTools: [] },
    selfState, processEnv: env,
  });
};

test('① **플래그가 매번 읽힌다** — 같은 프로세스에서 A/B 를 번갈아 돌릴 수 있다', () => {
  assert.equal(사실공급(켬), true);
  assert.equal(사실공급(끔), false);
  assert.equal(사실공급({ T5_FACTS_UNFILTERED: '0' }), false, '1 이 아니면 꺼진 것이다');
});

test('② **켜면 한계가 분류와 무관하게 실린다** — 79자를 아끼려고 사실을 지우지 않는다', () => {
  const 잡담 = 재료('fast_chat', 켬);
  assert.ok((잡담.selfStateFacts?.limits ?? []).length > 0,
    '**가벼운 턴이라고 "무엇을 못 하는지"를 지웠다.**\n'
    + `  실린 것: ${JSON.stringify(잡담.selfStateFacts?.limits)}\n`
    + '모델은 한계를 못 받으면 짐작한다 — "슬랙 보낼 수 있어?"에 되는 것처럼 답한다.');
});

// ③ **이 자리는 플래그를 졸업했다**(F-115 · 2026-08-14).
//
// 옛 검사는 *"끄면 기준선과 같다"* — 즉 **플래그를 끄면 잡담에서 한계가 비어야 한다** 였다.
// 그 기준선이 손을 못 뻗게 만든 자리였다. 한계만 플래그로 풀고 능력 **설명 문장**은
// `fast_chat` 에서 계속 지우고 있었는데(원 주석: *"그건 안 건드린다"*), 라이브가 그 판정을
// 뒤집었다: 지워진 문장 안에 *"사용자에게 명령어를 적어 주지 않는다"* 가 있었고
// 터미널 호출이 4회차 내내 0이었다. 셋(`readyTools`·`limits`·`scopedLimits`)은 **같은 문**을
// 타야 해서 함께 기본값이 됐다 — 이제 플래그와 무관하게 늘 실린다.
//
// 플래그(`T5_FACTS_UNFILTERED`)는 `context-mesh.js`(F-18 ②)에서 계속 산다 — 아래 ⑤⑦ 가 문다.
test('③ **이 자리엔 플래그가 안 걸린다** — 켜든 끄든 한계는 실린다(F-115)', () => {
  const 끈것 = 재료('fast_chat', 끔).selfStateFacts?.limits;
  const 켠것 = 재료('fast_chat', 켬).selfStateFacts?.limits;
  assert.ok((끈것 ?? []).length > 0,
    '**플래그를 꺼야만 사실이 지워진다면 기본 설치는 여전히 눈먼 것이다.**\n'
    + '사용자는 플래그를 안 켠다 — 기본값이 사실을 줘야 한다.');
  assert.deepEqual(끈것, 켠것, '이 자리는 플래그와 무관해야 한다 — 갈리면 졸업이 안 된 것이다');
});

test('④ **가벼운 턴이든 아니든 같은 사실이 실린다**(켬) — 분류가 공급을 안 가른다', () => {
  const 잡담 = 재료('fast_chat', 켬);
  const 일 = 재료('work', 켬);
  assert.deepEqual(잡담.selfStateFacts?.limits, 일.selfStateFacts?.limits,
    '**같은 설치인데 발화 분류에 따라 한계가 달라졌다** — 그게 F-18 의 모양이다');
});

// ── ⑤ 검증 사례가 없는 원칙 ────────────────────────────────────────────────
const 원칙 = (statement, scopeSignals) => ({
  candidateId: 'p1', kind: 'operating_principle', statement,
  admitted: true, userConfirmed: true, replayPassed: true,
  ...(scopeSignals ? { scopeSignals } : {}),
});

test('⑤ **범위를 모르는 원칙은 낱말로 짐작하지 않는다**(켬) — 모르면 안 든다', () => {
  const m = { promoted: [원칙('월별 수치는 표로 낸다')] };
  assert.deepEqual(admittedContext(m, '월별 수치 정리해줘', 켬), [],
    '**검증 사례가 없는 원칙을 낱말 겹침으로 들었다.**\n'
    + '이 파일이 이미 적어 뒀다: "잘못 든 원리가 안 든 원리보다 나쁘다."\n'
    + '범위를 모르면 모르는 것이지, 발화와 글자가 겹친다고 아는 것이 되지 않는다.');
  assert.deepEqual(admittedContext(m, '점심 뭐 먹지', 켬), [], '무관한 요청에도 안 든다');
});

test('⑥ **검증 사례가 있으면 그 범위대로 든다** — 그 경계는 그대로다', () => {
  const 사례 = { appliesWhen: ['월별 수치 정리해줘'], notWhen: [] };
  const m = { promoted: [원칙('월별 수치는 표로 낸다', 사례)] };
  assert.deepEqual(admittedContext(m, '월별 수치 정리해줘', 켬), ['월별 수치는 표로 낸다'],
    '검증된 본보기와 같은 말인데 안 들었다');
  assert.deepEqual(admittedContext(m, '점심 뭐 먹지', 켬), [],
    '검증된 범위 밖인데 들었다 — 사례가 범위를 정한다는 계약이 무너진다');
});

test('⑦ **끄면 옛 판정 그대로**(낱말 겹침) — 플래그 밖으로 안 샌다', () => {
  const m = { promoted: [원칙('월별 수치는 표로 낸다')] };
  assert.deepEqual(admittedContext(m, '월별 수치 정리해줘', 끔), ['월별 수치는 표로 낸다'],
    '껐는데 옛 행동이 안 나온다 — A/B 가 성립하지 않는다');
});

test('⑧ **선호는 플래그와 무관하게 실린다** — 이미 닫힌 자리를 안 되돌린다', () => {
  const m = { promoted: [{ candidateId: 'x', kind: 'preference', statement: '홍차를 마신다', userConfirmed: true }] };
  for (const [이름, env] of [['켬', 켬], ['끔', 끔]]) {
    assert.deepEqual(admittedContext(m, '내가 뭘 마시는지 알아?', env), ['홍차를 마신다'],
      `${이름}: 사용자에 대한 사실이 안 실렸다 — S5 로 이미 닫은 자리다`);
  }
});
