// **캐시 경계는 이미 그어져 있었다. 스위치만 안 켜져 있었다.**
//
// 실측(2026-08-03, 오너 실사용): 입력 49,505 토큰 중 캐시 17,024(34%) — 나머지 32,481 이
// 매 턴 새로 청구됐다. `cache_control` 마커는 저장소 전체에 **0건**이었다.
// (그 34%는 OpenAI 의 자동 프리픽스 캐싱이 낸 것이고, Anthropic 은 명시 마커가 없으면 0 이다.)
//
// `buildModelMessages` 는 규율을 지키고 있었다 — 정체성·헌장을 위에, 매 턴 바뀌는 것(시각·
// 승인 대기·이번 턴 실행)을 맨 뒤로. 그 규율이 캐시를 위해 존재하는데 정작 캐시를 안 켰다.
//
// **모델이 보는 것은 하나도 줄지 않는다** — 같은 것을 두 번 청구하지 않을 뿐이다.
// (오너 원칙: 「지연은 줄이는 게 아니라 공백을 채우는 것」 — 맥락을 깎는 최적화가 아니다.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModelMessages, MODEL_PROVIDERS } from '../src/runtime/model-provider.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

const selfState = buildSelfState(demoEnv());
const 본문 = (tcOver = {}, tools = [{ name: 'a', description: 'd', parameters: {} }, { name: 'b', description: 'd', parameters: {} }]) => JSON.parse(
  MODEL_PROVIDERS.anthropic.body(
    { modelId: 'c', maxTokens: 100, baseUrl: 'http://x' },
    buildModelMessages(buildTaskContext({ intent: { desiredOutcome: 'x', currentRequest: '안녕' }, selfState, ...tcOver })),
    { tools },
  ),
);

test('고정 접두(system)에 캐시 표식이 붙는다', () => {
  const b = 본문();
  assert.ok(Array.isArray(b.system), 'system 이 블록이어야 표식을 달 수 있다');
  assert.equal(b.system[0].cache_control?.type, 'ephemeral', '켜지 않으면 매 턴 전부 다시 청구된다');
  assert.ok(b.system[0].text.length > 100, '표식만 있고 내용이 비면 캐시할 것이 없다');
});

test('도구 목록도 접두다 — 마지막 하나에만 걸어 그 앞을 통째로 접두로 만든다', () => {
  const b = 본문();
  assert.deepEqual(b.tools.map((t) => Boolean(t.cache_control)), [false, true],
    '중간에 걸면 뒤쪽 도구가 접두에서 빠지고, 다 걸면 구간이 쪼개진다');
});

test('도구가 없으면 도구 표식도 없다(빈 자리에 표식을 만들지 않는다)', () => {
  const b = 본문({}, []);
  assert.equal(b.tools, undefined);
  assert.equal(b.system[0].cache_control?.type, 'ephemeral', '도구가 없어도 system 접두는 산다');
});

// ── 여기가 이 검사의 핵심: 표식이 붙어 있는데 한 번도 안 맞는 상태를 막는다 ──
// 헤르메스 원칙: "대화 중 시스템 프롬프트를 흔들지 않는다." 시각 한 줄이 매 분 바뀌는데
// system 을 한 덩어리로 캐시하면 **접두 전체가 무효화**된다 — 표식은 장식이 된다.
test('시각이 바뀌어도 고정 접두는 그대로다(표식이 실제로 맞는다)', () => {
  const 만들기 = (t) => buildModelMessages(buildTaskContext({
    intent: { desiredOutcome: 'x', currentRequest: '안녕' }, selfState,
    now: { local: t, timeZone: 'Asia/Seoul' },
  }));
  const a = 만들기('2026-08-03 21:14');
  const b = 만들기('2026-08-03 21:15');
  assert.equal(a.systemStable, b.systemStable, '시각 한 줄이 접두를 통째로 무효화하면 캐시는 한 번도 안 맞는다');
  assert.notEqual(a.systemVolatile, b.systemVolatile, '변동분은 실제로 변해야 한다(경계가 헛것이 아니다)');
  assert.ok(a.systemStable.length > a.systemVolatile.length * 10, '접두가 변동분보다 압도적으로 커야 캐시가 값을 한다');
});

test('와이어는 접두에만 표식을 걸고 변동분은 따로 싣는다', () => {
  const b = 본문({ now: { local: '2026-08-03 21:14', timeZone: 'Asia/Seoul' } });
  assert.equal(b.system.length, 2, '한 덩어리면 시각이 접두를 깬다');
  assert.equal(b.system[0].cache_control?.type, 'ephemeral');
  assert.equal(b.system[1].cache_control, undefined, '변동분에 표식을 걸면 매 턴 새 캐시를 만든다');
  assert.match(b.system[1].text, /21:14/, '변동분이 사라지면 모델이 지금 몇 시인지 모른다');
});

test('매 턴 바뀌는 것이 캐시 접두로 올라오지 않는다', () => {
  const 시각 = 본문({ now: { local: '2026-08-03 21:14', timeZone: 'Asia/Seoul' } });
  const sys = 시각.system[0].text;
  // 시간대는 세션 내내 같다(접두 가능). **정확한 시각**은 매 턴 바뀐다 —
  // 예전에 이걸 위쪽에 넣어 캐시가 통째로 깨진 실측이 코드 주석에 남아 있다.
  assert.match(sys, /Asia\/Seoul/, '시간대는 안 바뀌는 사실이라 접두에 있어도 된다');
  const 앞부분 = sys.slice(0, sys.indexOf('[지금]') >= 0 ? sys.indexOf('[지금]') : sys.length);
  assert.ok(!/\d{2}:\d{2}/.test(앞부분), '정확한 시각이 접두 앞쪽에 있으면 매 턴 캐시가 깨진다');
});

// ── F-73 · 캐시 접두 불변식 (등재 2026-08-11 · 재현: 호출 15회 중 지문 6종) ──
// 흔든 것은 시각이 아니었다 — **턴 안에서 바뀌는 사실**(왕복 예산·남은 걸음·승인 대기·
// 진행 상태)이 캐시 경계 **위**(고정 접두)에 있었다. 같은 턴의 걸음마다 왕복쓴것이 올라
// 접두 지문이 갈렸고, 캐시는 사실상 매 호출 미스였다(도구 스키마 전액 재청구 — 제품 원가).
test('턴 안에서 바뀌는 사실(예산·남은 걸음·승인 대기·진행 상태)이 고정 접두를 흔들지 않는다 (F-73)', () => {
  const 만들기 = (over = {}) => buildModelMessages(buildTaskContext({
    intent: { desiredOutcome: 'x', currentRequest: '안녕' }, selfState,
    now: { local: '2026-08-12 09:00', timeZone: 'Asia/Seoul' }, ...over,
  }));
  const 예산 = (왕복쓴것) => ({
    왕복쓴것, 왕복예산: 8, 되돌릴수있는것쓴것: 왕복쓴것, 되돌릴수있는것예산: 20, 그밖쓴것: 0, 그밖예산: 4,
  });
  const a = 만들기({ toolStepsLeft: 12, turnBudget: 예산(0) });
  const b = 만들기({
    toolStepsLeft: 3, turnBudget: 예산(5), toolBudgetSpent: false,
    plan: { autoAllowed: [], needsApproval: [{ action: '전송 승인 대기' }], forbidden: [] },
    workingState: { subject: { key: '/방/큰표.csv', kind: 'file', label: '큰표.csv' } },
  });
  assert.equal(a.systemStable, b.systemStable,
    '턴 안에서 바뀌는 사실이 접두를 깨면 캐시는 매 호출 미스다(F-73 — 도구 스키마 전액 재청구)');
  // 옮겼다고 사라지면 안 된다 — 같은 사실이 변동 구역에 그대로 있다.
  assert.match(b.systemVolatile, /3번 더 이어 쓸 수 있다/, '남은 걸음 사실이 사라졌다(H08 거짓 소진 재발)');
  assert.match(b.systemVolatile, /이번 턴 예산/, '예산 사실이 사라졌다');
  assert.match(b.systemVolatile, /승인 필요/, '승인 대기 사실이 사라졌다');
});

test('이번 턴 실행 사실은 system 이 아니라 대화 쪽에 있다', () => {
  const b = 본문({
    receipts: [{
      failureState: 'none', userSafeSummary: '읽었어요.', intended: '읽기',
      actualCall: { tool: 'local.file', args: { action: 'read', path: 'x.md' } },
      result: { path: '/집/x.md', text: '정산표 3월 합계 1200' },
    }],
  });
  assert.ok(!b.system[0].text.includes('정산표 3월 합계'), '턴마다 바뀌는 실행 결과가 접두에 있으면 캐시가 매번 깨진다');
  assert.match(JSON.stringify(b.messages), /정산표 3월 합계/, '그렇다고 사라지면 안 된다 — 대화로 간다');
});
