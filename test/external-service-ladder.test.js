// P5-B-0.5 · 바깥 자료에 닿는 현실 — **막다른 답을 만들지 않는다**
//
// 오너 지시(원문): "사용자가 외부 서비스 연결 의도를 말하면, T5는 미연결 상태를 막다른 길로
// 답하지 않고, 현재 가능한 연결 경로를 확인하고, 사용자 상황에 맞는 가장 자연스러운 방법으로
// 연결을 돕는다."
//
// 라이브 실측(2026-07-27) — "너 내 노션 볼 수 있어?" 에 T5 가:
//   "…비공개 노션은 내가 임의로 들어가서 볼 수 없어. **내용을 복사해서 붙여주면**…"
// 그때 `browser.observe` 는 **실행 가능**이었다. 사용자가 이미 로그인해 둔 화면을 열면 되는데
// 복붙을 시켰다 — 금지문이 부족해서가 아니라 **모델 앞에 그 현실이 없어서**다.
//
// **검사 방침(오너 지시):** 특정 문구 매칭이 아니라 **불변식**으로 잡는다 —
// 막다른 답 / 복붙 떠넘김 / 있는 손 누락 / 연결 상태 거짓말.
// 그래서 아래는 "무슨 말을 했나"가 아니라 **"모델이 판단할 현실이 공급됐나"** 를 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { reachingHands, serviceStatus, externalReality } from '../src/kernel/l1-intent/external-service.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { demoContext, demoConnectors } from '../src/surface/demo-context.js';

const 손 = { async handler() { return { result: {} }; } };
/** 브라우저·터미널·웹·찾기가 다 있는 컴퓨터(오늘 라이브와 같은 조건). */
function 손있는자리(extra = {}) {
  const c = demoContext({
    browserObserve: 손, browserAct: 손, localTerminal: 손, localLocate: 손, ...extra,
    factOverrides: { 'browser.observe': { connected: true }, 'browser.act': { connected: true } },
  });
  return { selfState: buildSelfState(c.env, { tools: c.tools }), ctx: c };
}

const 현실 = (selfState) => externalReality({ connectors: demoConnectors(), selfState });
const 프롬프트 = (selfState, text = '노션 좀 봐줘') => {
  const tc = buildTaskContext({
    intent: { currentRequest: text, answerMode: 'complex_work', authorityBoundary: 'user' },
    selfState, externalReality: 현실(selfState),
  });
  return JSON.stringify(buildModelMessages(tc));
};

// ── 불변식 ①: 있는 손이 현실에서 빠지지 않는다 ────────────────────────────
test('실행 가능한 손은 하나도 빠짐없이 "닿는 길"에 나타난다', () => {
  const { selfState } = 손있는자리();
  const paths = reachingHands(selfState);
  // 도구 이름을 문구로 맞히지 않는다 — **실행 가능한 손의 수만큼 길이 있어야 한다**는 불변식.
  const 관련손 = ['browser.observe', 'web.collect', 'local.terminal', 'local.locate']
    .filter((id) => selfState.connectedTools.some((t) => t.id === id && t.executable));
  assert.ok(관련손.length >= 3, '이 자리에는 손이 여럿 있어야 검사가 의미 있다');
  assert.ok(paths.length >= 관련손.length, `있는 손이 빠지면 모델이 그 손을 모른다: ${JSON.stringify(paths)}`);
});

test('손을 떼면 그 길도 사라진다 — 없는 손을 있다고 하지 않는다', () => {
  const 브라우저있음 = reachingHands(손있는자리().selfState).length;
  const c = demoContext({ localTerminal: 손 }); // 브라우저·찾기 없음
  const 브라우저없음 = reachingHands(buildSelfState(c.env, { tools: c.tools })).length;
  assert.ok(브라우저없음 < 브라우저있음, '손이 줄었는데 길이 그대로면 거짓말이다');
});

test('손이 하나도 없으면 길을 지어내지 않는다(그때만 복붙이 최후로 남는다)', () => {
  assert.deepEqual(reachingHands({ connectedTools: [] }), []);
});

// ── 불변식 ②: 연결 상태를 거짓으로 말하지 않는다 ──────────────────────────
test('미연결 서비스를 연결됨으로 말하지 않는다', () => {
  const { selfState } = 손있는자리();
  for (const s of serviceStatus(demoConnectors(), selfState)) {
    const 도구들 = selfState.connectedTools.filter((t) => t.connector);
    const 실제 = 도구들.some((t) => t.executable && demoConnectors().some((c) => c.label === s.label && t.connector === c.id));
    assert.equal(s.connected, 실제, `${s.label}: 연결 상태가 실제와 다르다`);
  }
});

test('연결된 서비스는 연결됨으로 말한다(반대 방향도 거짓말이다)', () => {
  const { selfState } = 손있는자리({ senders: { 'telegram.send': 손 } });
  const tg = serviceStatus(demoConnectors(), selfState).find((s) => s.label === '텔레그램');
  assert.equal(tg.connected, true, '연결된 것을 안 됐다고 하면 사용자가 길을 잃는다');
});

// ── 불변식 ③: 막다른 답이 될 수 없는 현실이 공급된다 ──────────────────────
test('미연결 서비스에도 다음 길이 있다 — 다만 planned 는 예정으로만 말한다', () => {
  const { selfState } = 손있는자리();
  for (const s of serviceStatus(demoConnectors(), selfState).filter((x) => !x.connected)) {
    // 막다른 답 금지: 뭐라도 말할 것이 있어야 한다.
    const 말할것 = (s.jobsWhenConnected?.length ?? 0) + (s.plannedJobs?.length ?? 0);
    assert.ok(말할것 > 0 || s.setupGuide, `${s.label}: 미연결인데 할 말이 없으면 막다른 답이다`);
  }
});

test('현실은 프롬프트 문자열까지 도달한다(패킷에만 있으면 소용없다)', () => {
  const { selfState } = 손있는자리();
  const 전문 = 프롬프트(selfState);
  const r = 현실(selfState);
  for (const hand of r.reach) {
    assert.ok(전문.includes(hand), `있는 손이 프롬프트에 없으면 모델은 못 본다: ${hand}`);
  }
});

// ── 불변식 ④: 분류기로 축소되지 않았다 ────────────────────────────────────
test('목록에 없는 서비스를 말해도 현실은 그대로 공급된다(키워드 분류기 금지)', () => {
  const { selfState } = 손있는자리();
  // 드롭박스·카페24 같은 미선언 서비스. 키워드로 판정했다면 여기서 현실이 사라진다.
  for (const text of ['드롭박스에 있는 자료 봐줘', '카페24 주문 좀 보자', '잔디에 올려줘']) {
    const 전문 = 프롬프트(selfState, text);
    assert.match(전문, /닿을 수 있는 손/, `"${text}" 에 현실이 없으면 그 자리가 곧 막다른 답이다`);
  }
});

test('서비스 이름이 없는 요청에도 손 현실은 유지된다', () => {
  const { selfState } = 손있는자리();
  assert.match(프롬프트(selfState, '이 자료 정리해줘'), /닿을 수 있는 손/);
});

// ── 불변식 ⑤: 금지문으로 묶지 않는다 ──────────────────────────────────────
test('현실만 준다 — 하지 말라는 규칙을 넣지 않는다(§24)', () => {
  const { selfState } = 손있는자리();
  const 전문 = 프롬프트(selfState);
  assert.doesNotMatch(전문, /(복붙|복사해서 붙여)[^"]{0,30}(하지 마|금지|말라)/, '금지문으로 막지 않는다');
  assert.doesNotMatch(전문, /반드시 브라우저를 제안/, '어느 길을 고를지는 모델이 정한다');
});

test('현실은 말귀 분류에 좌우되지 않는다 — 분류기가 사실을 끄면 안 된다', () => {
  // 실측(2026-07-27): 오너가 든 네 시나리오 중 **셋이 fast_chat 으로 분류**됐고,
  // 그때 이 블록을 빼 놨더니 T5 는 자기 브라우저 손을 모른 채 복붙을 시켰다.
  const { selfState } = 손있는자리();
  for (const mode of ['fast_chat', 'complex_work', undefined]) {
    const tc = buildTaskContext({
      intent: { currentRequest: '너 내 노션 볼 수 있어?', answerMode: mode },
      selfState, externalReality: 현실(selfState),
    });
    assert.ok(tc.externalReality, `${mode} 에서 현실이 사라지면 그 턴은 막다른 답이 된다`);
  }
});

// ── 불변식 ⑥: 사용자가 부르는 말을 모델이 맞출 수 있다 ────────────────────
test('서비스의 별칭이 함께 간다 — 이름 맞추기는 모델이 한다', () => {
  const { selfState } = 손있는자리();
  const 전문 = 프롬프트(selfState);
  const notion = serviceStatus(demoConnectors(), selfState).find((s) => s.label === '노션');
  assert.ok(notion.aliases.length > 0, '별칭이 없으면 "노션"과 "notion"을 못 잇는다');
  assert.ok(notion.aliases.some((a) => 전문.includes(a)), '별칭이 프롬프트에 없으면 모델이 못 맞춘다');
});

// ── 불변식 ⑦: 경로를 문장으로 처방하지 않는다(템플릿 금지) ────────────────
// 처음 만든 판은 "브라우저로 그 화면을 열어서 볼 수 있다(로그인해 둔 화면이면…)" 같은
// **문장 목록**이었다. 라이브 답변 네 줄이 그 목록과 거의 1:1 이었다 — 모델이 판단한 게 아니라
// 번역한 것이다. 사실만 주고 길은 모델이 고른다(오너 지시).
test('닿는 손은 **이름**만 준다 — 어떻게 쓰라는 처방을 넣지 않는다', () => {
  const { selfState } = 손있는자리();
  const 라벨 = new Set(selfState.connectedTools.map((t) => t.label));
  for (const h of reachingHands(selfState)) {
    assert.ok(라벨.has(h), `손 이름이 아니라 서술이 들어갔다: ${h}`);
    assert.ok(!/할 수 있다|하면 된다|열어서|주면/.test(h), `경로 처방이다: ${h}`);
  }
});

// ── 불변식 ⑧: 연결 흐름이 없는데 "연결하면 가능"이라 하지 않는다 ──────────
test('planned 는 "연결하면 가능"으로 말하지 않는다(못 지킬 약속 금지)', () => {
  const { selfState } = 손있는자리();
  for (const s of serviceStatus(demoConnectors(), selfState).filter((x) => !x.connected)) {
    if (s.reason === 'planned') {
      assert.equal(s.connectable, false);
      assert.deepEqual(s.jobsWhenConnected, [], 'planned 인데 연결하면 된다고 하면 거짓 약속이다');
      assert.equal(s.setupGuide, undefined, '연결 흐름이 없는데 연결 안내를 주면 막다른 길이다');
      assert.ok(s.plannedJobs.length > 0, '대신 "지원 예정"으로는 말할 수 있어야 한다');
    } else {
      assert.equal(s.connectable, true);
    }
  }
});

test('planned 와 connectable 이 프롬프트에서 구분된다', () => {
  const { selfState } = 손있는자리();
  const 전문 = 프롬프트(selfState);
  assert.match(전문, /연결 흐름도 아직 없음/, 'planned 를 구분해 말해야 한다');
});
