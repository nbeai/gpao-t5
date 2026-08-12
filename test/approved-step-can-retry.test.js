// **사용자가 허락한 그 걸음은, 막혔다가 다시 해도 같은 질문이다.** (F-34)
//
// 라이브(2026-08-05) `계산기 앞으로 가져오고 숫자 7 눌러줘`:
//   카드 `7 누르기` → 사용자 승인 → click → A02 로 막힘(같은 이름 둘)
//   막힘 영수증에 **토큰 실린 다음 수 2건**이 실려 모델에게 갔다
//   그런데 모델은 재시도하지 않고 답했다 — *"승인이 한 번 더 필요합니다"*
//
// **모델은 정확했다. 커널이 그렇게 말했다.**
// 기계 사실(`turn.js` 를 밟아 확인):
//   ① `승인면제` 는 손 면제를 `되돌릴수있나 === true` 일 때만 준다(`rm -rf` 사고 때 좁힌 것).
//      `desktop.act` 는 `reversible` 을 선언하지 않아 **undefined** → 면제 없음.
//   ② 그래서 승인 분기로 들어가는데, 거기서 `ctx.허락한손.has(toolId)` 로 **grants 를 비운다.**
//   ③ 카드를 못 만들면 `멈춘이유` 를 세우고 **break** — 걸음이 죽는다.
//
// **면제 판정이 두 벌이라 서로 다른 답을 냈고, 그 사이에 걸음이 빠졌다.**
// 이 파일이 곳곳에서 싸우는 병 그대로다("예전엔 여기서 조용히 사라졌다").
//
// ── 고치는 방향 ──────────────────────────────────────────────────────────
// **면제는 한 곳에서만 본다** — 두 벌 판정을 한 벌로(S6-c 3번과 같은 규율).
// 그리고 면제를 **손 단위가 아니라 걸음 단위**로 연다:
//   사용자가 허락한 것은 *"7을 누른다"* 이지 *"앞으로 화면 마음대로"* 가 아니다.
//   토큰을 더해 다시 부르는 것은 **같은 질문**이고, 대상이 바뀌면 **다른 질문**이다.
//
// `rm -rf` 구멍은 안 열린다 — 그 사고는 *같은 손, 다른 대상* 이었고 대상이 키에 있다.
// 오히려 **좁아진다**: 손 단위 지름길이 걸음 경로에만 있어서 그 구멍이 여기 남아 있었다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 승인면제, 걸음신분 } from '../src/kernel/l2-plan/tool-boundary.js';

const 신분 = (toolId, 판정인자) => 걸음신분({ toolId, 판정인자 });

// ── ① 걸음 신분 — 무엇이 같은 질문인가 ───────────────────────────────────
test('토큰을 더해 다시 불러도 같은 걸음이다 — 신분은 무엇을 어디에 하느냐다', () => {
  const 처음 = 신분('desktop.act', { action: 'click', 대상: { label: '7' } });
  const 다시 = 신분('desktop.act', { action: 'click', 대상: { label: '7', 토큰: 's3:24' } });
  assert.equal(처음, 다시, '**토큰이 붙었다고 다른 질문이 된다** — 재시도가 영영 막힌다');
});

test('대상이 다르면 다른 걸음이다 — rm -rf 구멍이 안 열린다', () => {
  assert.notEqual(
    신분('local.terminal', { command: 'rm -rf ./임시' }),
    신분('local.terminal', { command: 'rm -rf /전혀다른곳' }),
  );
  assert.notEqual(
    신분('local.file', { action: 'delete', path: '/a/보고서.md' }),
    신분('local.file', { action: 'delete', path: '/a/전혀다른것.csv' }),
  );
});

test('걸음이 다르면 다른 질문이다 — 누르기를 허락했다고 끄기까지 열리지 않는다', () => {
  assert.notEqual(
    신분('desktop.act', { action: 'click', 대상: { label: '7' } }),
    신분('desktop.act', { action: 'quit', 대상: { label: '7' } }),
  );
});

test('손이 다르면 다른 질문이다', () => {
  assert.notEqual(신분('desktop.act', { action: 'click' }), 신분('local.file', { action: 'click' }));
});

// ── ② 면제 — 허락한 그 걸음만 열린다 ─────────────────────────────────────
const 걸음 = { action: 'click', 대상: { label: '7' } };
const 허락 = new Set([신분('desktop.act', 걸음)]);

test('허락한 그 걸음을 다시 부르면 안 묻는다 — 재시도가 죽던 자리', () => {
  const r = 승인면제({
    toolId: 'desktop.act',
    판정인자: { action: 'click', 대상: { label: '7', 토큰: 's3:24' } },
    허락한걸음: 허락,
  });
  assert.equal(r.면제, true, '**사용자가 방금 허락한 걸음인데 또 묻는다(그리고 카드도 못 만들어 죽는다)**');
  assert.equal(r.이유, '허락한걸음');
});

test('허락 안 한 걸음은 묻는다 — 같은 손이어도', () => {
  const r = 승인면제({ toolId: 'desktop.act', 판정인자: { action: 'click', 대상: { label: '보내기' } }, 허락한걸음: 허락 });
  assert.equal(r.면제, false, '**허락은 7 에 준 건데 보내기까지 열렸다**');
});

test('이월된 일은 허락한 걸음이어도 안 열린다 — 지금 요청이 아니다', () => {
  const r = 승인면제({ toolId: 'desktop.act', 판정인자: 걸음, 허락한걸음: 허락, 이번이월: true });
  assert.equal(r.면제, false);
});

test('발화 밖 파괴도 안 열린다', () => {
  const r = 승인면제({ toolId: 'desktop.act', 판정인자: 걸음, 허락한걸음: 허락, 발화밖: true });
  assert.equal(r.면제, false);
});

test('허락한 걸음이 없으면 예전 그대로다 — 있던 길을 안 바꾼다', () => {
  const r = 승인면제({ toolId: 'local.file', 판정인자: { action: 'list' }, 허락한손: new Set(['local.file']), 되돌릴수있나: true });
  assert.equal(r.면제, true);
  assert.equal(r.이유, '허락한손');
});

// ── ③ 걸음 경로가 면제를 다시 재지 않는다 ────────────────────────────────
// 두 벌 판정이 문제였다. `turn.js` 의 손 단위 지름길은 `승인면제` 와 **다른 답**을 냈고,
// 그 지름길에는 `rm -rf` 구멍(같은 손·다른 대상)이 그대로 남아 있었다.
test('되돌릴 수 없는 것은 손을 허락했어도 대상이 바뀌면 묻는다 — 걸음 경로의 지름길에 남아 있던 구멍', () => {
  const r = 승인면제({
    toolId: 'local.terminal',
    판정인자: { command: 'rm -rf /전혀다른곳' },
    허락한손: new Set(['local.terminal']),
    허락한걸음: new Set([신분('local.terminal', { command: 'rm -rf ./임시' })]),
    되돌릴수있나: false,
  });
  assert.equal(r.면제, false, '**승인한 것은 그 명령이지 "앞으로 터미널 마음대로"가 아니다**');
});
