// **F-115 · 잡담이라고 판단했다고 모델이 손을 고를 재료를 빼앗지 않는다**
//
// ── 밟은 사실 (라이브 · 실모델 gpt-5.1 · 4회차 · 격리 방) ──────────────────
//   과업3 *"받은자료 폴더에 파일이 스물 몇 개 있어. 내용에 「취소」가 든 csv 만 골라내야 해"*
//     → **4회차 내내 터미널 호출 0회 · 파일 손 영수증 29건.**
//   `grep -l 취소 *.csv` 한 줄이면 끝나는 일이다.
//
// ── 원인 ────────────────────────────────────────────────────────────────
// `intent.js` 의 `ACTION_SIGNALS` 에 **터미널이 하는 일의 동사가 하나도 없다**
// (`분석`은 있는데 `요약`이 없고 `정리`는 있는데 `저장`이 없다). 그래서 아래 넷이 전부
// `fast_chat` 으로 갈린다: `순매출.tsv 로 저장해줘` · `파일로 남겨줘` · `합쳐서 요약해줘`
// · `ERROR 를 세서 알려줘`.
//
// **낱말을 더하는 것은 고침이 아니다** — 다음 낱말에서 또 뚫린다(목록은 항상 뚫린다).
// 고칠 것은 그 뒤에 있었다: 도구 스키마는 `answerMode` 와 무관하게 **전량** 가는데
// (`turn.js` · `modelSchemasFor`) **그 손을 쓰는 법만** 분류로 빠졌다. 빠지는 문장 안에
// 이것이 있다(`demo-context.js` · `local.terminal`):
//
//   *"실행 직전에 확인 카드가 한 번 뜨고, 승인되면 네가 이어서 실행한다 —
//     **사용자에게 명령어를 적어 주지 않는다.**"*
//
// **떠넘김을 막으라고 넣은 문장이, 떠넘김이 나는 턴에는 안 갔다.**
// 커널이 대신 고르는 것보다 나쁘다 — **고를 재료를 뺏는 것**이라서 그렇다.
//
// 여기서 무는 계약: **`answerMode` 는 사실 공급의 열쇠가 아니다.**
// (응답 길이·깊이를 정하는 자리는 그대로다 — 이 파일은 그것을 재지 않는다.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';

// 터미널 손이 실제로 배선된 방. (기본 demo 는 터미널 손이 없어 능력 문장 자체가 안 생긴다 —
// 그 방에서 재면 이 결함이 안 보인다.)
const 손 = ['local.terminal', 'local.file', 'web.search', 'web.collect', 'local.locate'];
const selfState = buildSelfState(demoEnv({ hands: 손 }));

/** 라이브에서 실제로 터미널을 안 쓴 말들. 넷 다 `fast_chat` 으로 갈린다(아래 ①이 그것을 적는다). */
const 손이필요한말 = ['순매출.tsv 로 저장해줘', '파일로 남겨줘', '합쳐서 요약해줘', 'ERROR 를 세서 알려줘'];
const 진짜잡담 = ['안녕', '고마워'];
const 일로갈리는말 = ['이 폴더 정리해줘', '메모.md 지워줘'];

const 재료 = (text) => {
  const intent = interpret(text, { selfState });
  const tc = buildTaskContext({ intent, selfState, now: { local: '2026-08-14 09:00', timeZone: 'Asia/Seoul' } });
  return { intent, tc, msg: buildModelMessages(tc) };
};

const 떠넘김금지문장 = '사용자에게 명령어를 적어 주지 않는다';

test('① 라이브에서 손을 안 쓴 넷은 지금도 `fast_chat` 이다 — 이 검사가 겨누는 자리가 맞다', () => {
  for (const 말 of 손이필요한말) {
    assert.equal(재료(말).intent.answerMode, 'fast_chat',
      `"${말}" 이 더 이상 fast_chat 이 아니다.\n`
      + '낱말을 더해 분류를 옮겼다면 이 수리가 아니다 — 다음 낱말에서 또 뚫린다.\n'
      + '고칠 것은 분류가 아니라 **분류가 사실 공급의 열쇠인 것**이다.');
  }
});

test('② 그 넷의 모델 입력에 **터미널을 쓰는 법**이 실린다 — 떠넘김을 막는 문장이 떠넘김 나는 턴에 간다', () => {
  for (const 말 of 손이필요한말) {
    const { msg } = 재료(말);
    assert.ok(msg.system.includes(떠넘김금지문장),
      `"${말}" 의 모델 입력에 이 문장이 없다: "${떠넘김금지문장}"\n`
      + '이 문장이 빠지면 모델은 명령어를 적어 사용자에게 넘긴다(라이브 2026-07-27 · 2026-08-14).');
  }
});

test('③ 능력 문장·손별 한계·못 하는 것이 **한 문**으로 함께 간다 — 갈라 놓으면 거짓 한계가 난다', () => {
  for (const 말 of [...손이필요한말, ...진짜잡담]) {
    const { tc } = 재료(말);
    const 손줄 = tc.selfStateFacts.readyTools;
    assert.ok(손줄.some((l) => l.includes('—')),
      `"${말}": 손 이름만 갔다(설명 문장 없음) — 모델은 이름만 보고 무엇을 할 수 있는지 모른다: ${JSON.stringify(손줄)}`);
    assert.ok(tc.selfStateFacts.scopedLimits.length > 0,
      `"${말}": 손에 걸린 한계가 비었다 — 능력만 읽으면 경계를 넘는다`);
    assert.ok(tc.selfStateFacts.limits.length > 0,
      `"${말}": 못 하는 것이 비었다 — 사실을 안 주면 모델은 사실을 만든다`);
  }
});

test('④ 일로 갈리는 턴의 모양은 안 바뀐다 — 고친 것은 잡담 쪽뿐이다', () => {
  const 기준 = 재료(일로갈리는말[0]);
  assert.equal(기준.intent.answerMode, 'complex_work');
  for (const 말 of 일로갈리는말.slice(1)) {
    const { tc } = 재료(말);
    assert.deepEqual(tc.selfStateFacts.readyTools, 기준.tc.selfStateFacts.readyTools);
    assert.deepEqual(tc.selfStateFacts.limits, 기준.tc.selfStateFacts.limits);
    assert.deepEqual(tc.selfStateFacts.scopedLimits, 기준.tc.selfStateFacts.scopedLimits);
  }
});

// ── 캐시 (위험 ①) ────────────────────────────────────────────────────────
// 이 세 칸은 `model-provider.js` 의 캐시 경계 **위**(고정 접두)에 앉는다. 분류로 갈리는 동안
// 안정 접두 지문이 발화마다 **2종**으로 갈렸다(실측 3,450자 ↔ 5,118자). 잡담과 일이 번갈아
// 오는 평범한 대화에서 접두가 매번 무효였고, 도구 스키마(실측 9,836자)까지 통째로 재청구됐다 —
// F-73 이 걷어 낸 것과 **같은 병이 발화 축으로** 남아 있었다. 항상 실으면 지문이 1종이 된다.
test('⑤ 안정 접두가 발화에 따라 갈리지 않는다 — 캐시가 실제로 맞는다(F-73 과 같은 축)', () => {
  const 지문 = [...손이필요한말, ...진짜잡담, ...일로갈리는말].map((말) => {
    const { msg } = 재료(말);
    return [말, createHash('sha256').update(msg.systemStable).digest('hex')];
  });
  const 종수 = new Set(지문.map(([, h]) => h)).size;
  assert.equal(종수, 1,
    '**발화가 캐시 접두를 갈랐다.** 잡담↔일이 번갈아 오면 매 턴 접두가 통째로 무효고,\n'
    + `도구 스키마까지 다시 청구된다(F-73 과 같은 병).\n${
      지문.map(([말, h]) => `  ${h.slice(0, 12)} ${말}`).join('\n')}`);
});

// ── 프롬프트 예산 (위험 ②) ───────────────────────────────────────────────
// 실측(터미널 배선된 방 · 2026-08-14): 잡담 턴의 안정 접두 3,450자 → 5,118자(**+1,668자**).
// 늘어난 자수는 전부 **캐시 접두 안**이라 세션당 한 번만 새로 청구된다. 반대로 예전에는
// 잡담↔일이 갈릴 때마다 접두 전체(5,118자 + 도구 스키마 9,836자)가 재청구됐다.
test('⑥ 진짜 잡담이 폭발하지 않는다 — 늘어난 것은 접두 안이고 변동 구역은 그대로다', () => {
  const { msg } = 재료('안녕');
  assert.ok(msg.systemStable.length <= 6000,
    `잡담 한 마디의 고정 접두가 ${msg.systemStable.length}자다(상한 6000 · 실측 5118).`);
  assert.ok(msg.systemVolatile.length <= 400,
    `변동 구역이 ${msg.systemVolatile.length}자로 자랐다(실측 105) — 여기가 자라면 매 턴 값을 낸다`);
  // 재료를 실었다고 사실 구역이 접두 밖으로 새면 안 된다(가변으로 내려가면 매 턴 청구다).
  assert.ok(msg.systemStable.includes(떠넘김금지문장),
    '능력 문장이 캐시 경계 **아래**로 내려갔다 — 매 턴 새로 청구된다(다른 결함을 만든 것이다)');
});
