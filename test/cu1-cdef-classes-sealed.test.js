// **CU-1 계열 C·D·E·F 봉쇄.**
//
// 오늘 일곱 결함은 계열 여섯의 반복이었다. G·A·B 는 앞 파일에서 닫았다.
// 여기는 나머지 넷 — 각각 **구조 하나 + 그물 하나**.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopTool } from '../src/runtime/desktop-tool.js';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';
import { 드라이버답 } from '../src/runtime/desktop-driver-answer.js';

// ── C · 빈 것은 **왜 빈지** 함께 낸다 ────────────────────────────────────
// 조용한 0 은 오늘 세 번 났다. 거르개는 고쳤는데 **창 목록은 아직** 이유가 없다 —
// 창이 0개일 때 "없다"인지 "못 봤다"인지 모델이 구분할 방법이 없다.
test('창이 0개면 왜 0인지 함께 낸다 — "없다"와 "못 봤다"는 다르다', async () => {
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({ frontmost: { name: 'X' }, windows: [] }),
    }],
  });
  const r = await 손.handler({ action: 'observe', scope: 'screen' });
  assert.equal((r.result?.windows ?? []).length, 0);
  assert.ok(r.result?.창없음이유, `**0 만 던진다** — 모델이 "없다"로 읽는다: ${JSON.stringify(r.result).slice(0, 200)}`);
});

test('창이 있으면 이유를 안 붙인다 — 없는 걱정을 만들지 않는다', async () => {
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({ frontmost: { name: 'X' }, windows: [{ id: 1, app: 'A' }] }),
    }],
  });
  const r = await 손.handler({ action: 'observe', scope: 'screen' });
  assert.equal(r.result?.창없음이유, undefined);
});

// ── E · 문구가 아니라 **구조**로 가른다 ─────────────────────────────────
// `거절인가` 가 드라이버 오류 **문구**(`Missing required|invalid|unsupported`)로 쟀다.
// 문구 목록은 늘 뚫린다 — 드라이버가 표현을 바꾸면 그 답이 **결과로 흘러** 들어온다.
//
// 구조로 가른다: cua 는 성공하면 **구조화된 객체**를 주고, 못 하면 **텍스트 조각만** 준다.
// *"텍스트뿐이면 결과가 아니다"* 는 문구를 안 세고도 참이다. 문구는 **사유**로만 쓴다.
test('모르는 문구로 거절해도 결과로 안 흘린다 — 텍스트뿐이면 결과가 아니다', () => {
  const 새표현 = [{ type: 'text', text: 'element_token belongs to a retired snapshot' }];
  assert.equal(드라이버답(새표현).종류, '거절',
    '**문구 목록에 없다고 결과로 읽는다** — 안 나간 것을 나갔다고 하게 된다');
});

test('구조가 있으면 결과다 — 텍스트가 섞여 있어도', () => {
  assert.equal(드라이버답({ delivery: { mode: 'background' }, effect: 'unverifiable' }).종류, '모름');
  assert.equal(드라이버답({ ok: true }).종류, '값');
  assert.equal(드라이버답({ 확인됨: true, 근거: 'x' }).종류, '확인됨');
});

test('빈 배열은 거절이 아니다 — 아무 말도 안 한 것이다', () => {
  assert.notEqual(드라이버답([]).종류, '거절');
});

// ── F · 막힘은 **다음 수를 반드시** 싣는다 ──────────────────────────────
// 갈 곳 없는 막힘은 그대로 떠넘김이 된다 — 라이브에서 세 번 그랬다.
test('화면 손의 모든 막힘에 다음 수가 있다', async () => {
  const 버튼 = { id: 'b', 토큰: 's1:1', 스냅샷: 's1', role: 'AXButton', label: '7', isEnabled: true, 창: 9, pid: 77 };
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({ frontmost: { name: 'X' }, windows: [{ id: 9, pid: 77 }], elements: [버튼, { ...버튼, id: 'b2' }] }),
      act: () => ({ ok: true }),
      verify: async () => ({ 판정: 'unknown' }),
    }],
  });
  const 막힌것들 = [
    await 손.handler({ action: 'click', 대상: { label: '' } }),                       // A17 이름 없음
    await 손.handler({ action: 'click', 대상: { label: '7', 비밀칸: true } }),         // A09 비밀칸
    await 손.handler({ action: 'click', 대상: { label: '7' } }),                      // A02 같은 이름 둘
    await 손.handler({ action: 'type', 대상: { label: '없는칸' }, 값: 'x' }),          // 어디인지 모름
    await 손.handler({ action: '없는행동' }),                                          // 안 받는 행동
  ];
  for (const r of 막힌것들) {
    if (!(r.blocked ?? r.막힘)) continue;
    assert.ok((r.다음수단 ?? []).length > 0 || (r.후보 ?? []).length > 0,
      `**갈 곳 없는 막힘** — 그대로 떠넘김이 된다: ${r.userSafeSummary}`);
  }
});

// ── D · 판정은 **단일 진입점** ──────────────────────────────────────────
// 오늘 F-34 가 그 모양이었다: 면제를 두 곳에서 답해 걸음이 그 사이로 빠졌다.
// 두 번째 판정자가 생기면 **그물이 먼저 울어야** 한다.
test('승인 면제를 판정하는 곳은 하나다 — 두 번째 판정자가 생기면 문다', async () => {
  const { readFileSync } = await import('node:fs');
  const turn = readFileSync(new URL('../src/kernel/turn.js', import.meta.url), 'utf8');
  // `승인면제()` 말고 **손 단위로 면제를 다시 정하는 자리**가 있으면 안 된다.
  // (F-34: `ctx.허락한손?.has(toolId) ? [] : grants` 가 그 모양이었다.)
  const 두번째판정 = /허락한손\s*\??\.\s*has\([^)]*\)\s*\?/.test(turn);
  assert.equal(두번째판정, false,
    '**면제를 두 곳에서 답한다** — 그 사이로 걸음이 빠져 카드도 못 만들고 죽는다(F-34)');
});

// **단일 진입점은 "한 함수"이지 "한 호출자"가 아니다.** 같은 함수를 여러 곳에서 부르는 건
// 오히려 옳다 — 두 벌이란 *같은 질문에 다른 규칙*이 있는 것이다(F-34 가 그랬다).
// 그래서 재는 것은 호출 횟수가 아니라 **두 경로가 같은 답을 내는가**다.
test('계획 경로와 걸음 경로가 같은 인자에 같은 답을 낸다', async () => {
  const { toolActionKind } = await import('../src/kernel/l2-plan/action-plan.js');
  const { 실행전판정 } = await import('../src/kernel/l2-plan/tool-boundary.js');
  const selfState = { connectedTools: [{ id: 'desktop.act', toolKind: 'read' }] };
  const 버튼 = { id: 'b', 토큰: 's1:1', 스냅샷: 's1', role: 'AXButton', label: '보내기', isEnabled: true };
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({ frontmost: { name: 'X' }, windows: [{ id: 1 }], elements: [버튼] }),
      act: () => ({ ok: true }),
    }],
  });
  const args = { action: 'click', 대상: { label: '보내기' } };
  const 경계 = await 실행전판정({ toolId: 'desktop.act', args, selfState, tools: { tools: { 'desktop.act': 손 } } });
  // 계획 경로는 경계가 실은 사실(`판정인자`)을 그대로 본다 — 다시 재지 않는다.
  const 계획 = toolActionKind({ toolId: 'desktop.act', args: 경계.판정인자, selfState });
  assert.equal(계획, 경계.kind,
    `**같은 질문에 두 경로가 다른 답을 낸다** — 그 사이로 걸음이 빠진다: 경계=${경계.kind} 계획=${계획}`);
});

// ── C+F · **앞 창만 봤다는 사실**과 다른 앱을 보는 길을 함께 준다 ────────
// 오너 라이브(2026-08-06, 스크린샷): 카카오톡 `정영현` 창이 **명백히 떠 있는데**
// T5 가 *"앞 화면에 떠 있지 않아요"* 라고 답했다. 같은 세션 앞 답에서는
// *"'정영현' 창이 하나 열려 있는 건 확인된다"* 고 해 놓고서다. **두 답이 모순이다.**
//
// 원인은 계열 C 다 — `scope:'window'` 는 **앞 창**을 본 것인데, 결과가 그 사실을 안 말한다.
// 모델은 "안 보인다"를 **"없다"** 로 읽고, 앞에 없으면 못 한다고 답한다.
// 앱을 지목하면 뒤에 있어도 볼 수 있다(계열 G) — 그 길을 **결과에 실어 준다**(계열 F).
test('앞 창을 본 것이면 그렇게 말한다 — 그리고 다른 앱을 보는 길을 준다', async () => {
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({
        frontmost: { name: 'Claude' },
        windows: [{ id: 1, app: 'Claude' }, { id: 2, app: '카카오톡', title: '정영현' }],
        elements: [{ id: 'e1', type: 'AXButton', label: 'x' }],
      }),
    }],
  });
  const r = await 손.handler({ action: 'observe', scope: 'window' });
  assert.equal(r.result?.본창?.앞창인가, true,
    `**앞 창을 봤다는 사실이 없다** — 모델이 "안 보인다"를 "없다"로 읽는다: ${JSON.stringify(r.result?.본창)}`);
  assert.match(JSON.stringify(r.result?.다음수단 ?? []), /app/,
    '**다른 앱을 보는 길이 없다** — 앞에 없으면 못 한다고 답하게 된다');
});

test('앱을 지목해서 봤으면 앞 창 이야기를 안 붙인다', async () => {
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: (a) => ({
        frontmost: { name: 'Claude' },
        windows: [{ id: 2, app: '카카오톡' }],
        elements: [],
        본창: { id: 2, app: String(a?.app ?? '') },
      }),
    }],
  });
  const r = await 손.handler({ action: 'observe', scope: 'window', app: '카카오톡' });
  assert.notEqual(r.result?.본창?.앞창인가, true);
});
