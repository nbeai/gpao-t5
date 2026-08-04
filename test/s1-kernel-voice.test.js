// **S1a — 커널은 사용자 입으로 말하지 않는다.**
//
// S0 계측이 찾은 것(2026-08-05): 오너가 "안녕" 한 마디를 했는데 모델이 받은 사용자 메시지는
// 이랬다.
//
//     [T5가 먼저 맡을 수 있는 일]
//     - 웹 자료 수집: …
//     - 로컬 파일: …
//
//     안녕
//
// 모델은 **사용자가 그렇게 말했다고 읽는다.** 그래서 인사에 능력을 읊었다. 모델 잘못이 아니다.
// 시스템 프롬프트에는 "묻지 않은 능력 나열 금지"가 적혀 있었다 — 말과 행동이 반대였다.
//
// ── 지우지 않고 **옮긴다** ────────────────────────────────────────────────
// 이 블록은 실측으로 얻은 것이다: 없으면 모델이 "사용자에게 무엇을 시킬까"를 먼저 생각한다.
// 그 의도는 옳다. 틀린 것은 **자리**다. 사실은 시스템 공간에 있어야 하고, 사용자 메시지에는
// 사용자가 말한 것만 있어야 한다.
//
// 옮기면 둘이 같이 좋아진다 — 목소리가 바로잡히고(원리 ③), **안정 구역이라 캐시에 얹힌다**
// (불변식 B: 사용자 턴은 캐시에 안 얹혀 매 콜 새로 지불한다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoContext } from '../src/surface/demo-context.js';

const hand = { async handler() { return { result: {} }; } };

function 프롬프트(text) {
  const ctx = demoContext({ localTerminal: hand, localLocate: hand });
  const selfState = buildSelfState(ctx.env, { tools: ctx.tools });
  return buildModelMessages(buildTaskContext({
    intent: { currentRequest: text, answerMode: 'fast_chat', authorityBoundary: 'user' },
    selfState,
  }));
}

test('① 인사 턴의 사용자 메시지는 **사용자가 말한 것만** 담는다', () => {
  const { user } = 프롬프트('안녕');
  assert.equal(user.trim(), '안녕',
    `커널이 사용자 입으로 말했다. 실제로 간 사용자 메시지:\n---\n${user}\n---`);
});

test('② 능력 목록이 사용자 메시지에 없다(어떤 발화에서도)', () => {
  for (const 말 of ['안녕', '카페24 주문 자료 좀 가져와줘', '이 컴퓨터 왜 느린지 봐줘']) {
    const { user } = 프롬프트(말);
    assert.doesNotMatch(user, /\[T5가 먼저 맡을 수 있는 일\]/,
      `"${말}" 턴의 사용자 메시지에 능력 목록이 실렸다`);
  }
});

test('③ **사실이 사라지지 않았다** — 시스템 프롬프트에 그대로 있다', () => {
  const { system } = 프롬프트('카페24 주문 자료 좀 가져와줘');
  assert.match(system, /터미널 실행: 이 컴퓨터의 상태·설정·설치된 도구를 직접 확인하고 필요한 명령을 실행한다/,
    '옮긴 게 아니라 잃어버렸다 — 모델이 "사용자에게 무엇을 시킬까"로 되돌아간다');
  assert.match(system, /작업 대상 찾기: 사용자가 부른 자료나 폴더를 직접 찾아 후보와 근거를 확인한다/);
});

test('④ 옮긴 자리가 **안정 구역**이다 — 캐시에 얹힌다(불변식 B)', () => {
  const { systemStable } = 프롬프트('안녕');
  assert.ok(typeof systemStable === 'string' && systemStable.length > 0, '안정 접두가 없다');
  assert.match(systemStable, /작업 대상 찾기: 사용자가 부른 자료나 폴더를 직접 찾아/,
    '휘발 구역에 넣었다 — 매 콜 새로 지불한다. 손 구성은 대화 안에서 잘 안 바뀌므로 안정 구역이다');
});

// **검사가 실제 상황을 안 재고 있었다**(2026-08-05 라이브에서 걸림).
// ①②는 `demoContext` 로 재는데 거기엔 외부 서비스가 없다. 그래서 `[바깥 자료에 닿는 현실]`
// 블록이 아예 안 만들어졌고 검사는 초록이었다. 라이브 덤프를 보니 사용자 메시지에 그 블록이
// 1,500자쯤 그대로 있었고, 거기 실린 **미연결 서비스 목록**이 오너가 받은
// *"메일·텔레그램·슬랙 같은 건 안 된 상태네"* 의 출처였다.
// → 재는 자리를 라이브와 같게 만든다. 없는 것을 안 재면 초록은 거짓이다.
test('⑥ 외부 서비스가 있는 설치에서도 사용자 메시지가 깨끗하다', () => {
  const 바깥 = {
    reach: [{ label: '웹 자료 수집', operation: '공개 웹 자료를 직접 찾아 읽는다' }],
    services: [
      { label: '노션', connected: false, connectable: true, aliases: ['notion'] },
      { label: '텔레그램', connected: false, connectable: false },
      { label: '깃허브', connected: true },
    ],
  };
  const m = buildModelMessages({
    currentRequest: '안녕',
    identity: { name: 'GPAO-T5' },
    selfStateFacts: { model: { id: 'gpt-5.1' }, readyTools: ['웹 자료 수집'], limits: [] },
    externalReality: 바깥,
  });
  assert.equal(m.user.trim(), '안녕',
    `외부 서비스 현실이 사용자 입으로 갔다:\n---\n${m.user}\n---`);
  assert.match(m.system, /\[바깥 자료에 닿는 현실\]/, '사실이 사라졌다 — 옮긴 게 아니라 잃었다');
  assert.match(m.system, /노션/, '연결 가능한 서비스 사실이 사라졌다');
});

test('⑦ 바깥 현실은 안정 구역 **맨 끝**이다 — 바뀌어도 앞이 안 죽는다', () => {
  const 만들기 = (services) => buildModelMessages({
    currentRequest: '안녕',
    identity: { name: 'GPAO-T5' },
    selfStateFacts: { model: { id: 'gpt-5.1' }, readyTools: ['웹 자료 수집'], limits: [] },
    externalReality: { reach: [], services },
  });
  const 전 = 만들기([{ label: '노션', connected: false, connectable: true }]);
  const 후 = 만들기([{ label: '노션', connected: true }]); // 대화 중 붙였다
  assert.notEqual(전.systemStable, 후.systemStable, '붙였는데 안정 구역이 그대로다 — 사실이 안 실렸다');
  // 바뀐 자리가 **끝**이어야 한다: 앞부분이 그대로 살아 있어야 캐시 접두가 산다.
  const 공통 = (() => {
    let i = 0;
    while (i < 전.systemStable.length && 전.systemStable[i] === 후.systemStable[i]) i += 1;
    return i;
  })();
  const 살아있는비율 = 공통 / 전.systemStable.length;
  assert.ok(살아있는비율 > 0.7,
    `서비스 하나 붙였는데 안정 접두의 ${Math.round((1 - 살아있는비율) * 100)}% 가 죽었다 — 블록이 앞쪽에 있다`);
});

test('⑤ 역할을 선언하지 않은 손은 여전히 지어내지 않는다(기존 계약 유지)', () => {
  const ctx = demoContext({ localTerminal: hand });
  const selfState = buildSelfState(ctx.env, { tools: ctx.tools });
  const { system } = buildModelMessages(buildTaskContext({
    intent: { currentRequest: '안녕', answerMode: 'fast_chat', authorityBoundary: 'user' },
    selfState,
  }));
  // 선언 없는 손이 문장으로 지어내져 나오면 안 된다 — operatorFact 있는 것만 실린다.
  const 줄들 = system.split('\n').filter((l) => /^- .+: /.test(l));
  for (const l of 줄들) assert.ok(l.length > 5, `빈 운영 사실이 실렸다: ${l}`);
});
