// **노드 W 봉인 — 창을 알면 상한이 파생값이 되고, 읽은 것이 접히지 않는다** (2단계 · 2026-08-08).
//
// 재는 것 넷:
//   ① 예산이 계산식대로 선다 · 모르는 모델은 null(지어내지 않는다) · 덮으면 작은 쪽
//   ② 읽은 것이 접히지 않는다 — 4,588자 웹 본문이 1,183자로 접혀 "31도"가 나간 사고(08-05)와
//      locate 후보가 "(가운데 621자 생략)"으로 접힌 실측(08-08)의 봉인
//   ③ ⑪의 기제 — 스무 턴 잡담 뒤에도 아침 발화가 이력에 남는다
//   ④ 결과몫걸음이 turn.js 의 MAX_TOOL_STEPS 와 같다(순환 없이 두 값의 일치를 잰다)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { 창예산, 창표, 결과몫걸음 } from '../src/kernel/l1-intent/model-window.js';
import { compactResult } from '../src/kernel/l1-intent/task-context.js';
import { recentTurns } from '../src/kernel/l1-intent/conversation.js';

test('창을 알면 예산이 계산식대로 선다 — 상한은 파생값이다', () => {
  for (const [id, { 입력토큰 }] of Object.entries(창표)) {
    const b = 창예산({ modelId: id });
    const 쓸자 = Math.floor(입력토큰 * 0.5);
    assert.equal(b.이력자, Math.floor(쓸자 * 0.5), id);
    assert.equal(b.발화자, Math.floor(b.이력자 * 0.3), id);
    assert.equal(b.결과자, Math.floor((쓸자 - b.이력자) / 결과몫걸음), id);
    assert.ok(b.결과자 > 4588, `${id}: 결과 몫이 그날의 웹 본문(4,588자)도 못 담는다`);
  }
});

test('모르는 모델은 null — 큰 예산을 지어내면 요청이 통째로 터진다', () => {
  assert.equal(창예산({ modelId: '처음보는-모델' }), null);
  assert.equal(창예산({}), null);
});

test('설정으로 덮으면 작은 쪽이 이긴다 — 안전 쪽 오차', () => {
  assert.equal(창예산({ modelId: 'gpt-5.1', 설정입력토큰: 100_000 }).입력토큰, 100_000);
  assert.equal(창예산({ modelId: 'gpt-5.1', 설정입력토큰: 999_999_999 }).입력토큰, 272_000);
  assert.equal(창예산({ modelId: '처음보는-모델', 설정입력토큰: 50_000 }).입력토큰, 50_000);
});

test('봉인: 읽은 것이 접히지 않는다 — 창 예산이 오면 웹 본문이 원문으로 간다', () => {
  const 본문 = '기온 43.7도 폭염경보. '.repeat(400); // ≈ 8,800자 — 그날 본문의 두 배
  const 결과 = { url: 'https://w.example', text: 본문 };
  const 옛것 = compactResult(결과);
  assert.match(String(옛것), /생략/, '옛 상한이 안 접으면 이 봉인은 재는 것이 없다');
  const 새것 = compactResult(결과, 창예산({ modelId: 'gpt-5.1' }).결과자);
  assert.doesNotMatch(String(새것), /생략/, '창을 아는데도 읽은 것이 접혔다 — 08-05 사고 그대로다');
  assert.match(String(새것), /43\.7/);
});

test('봉인: 스무 턴 잡담 뒤에도 아침 발화가 남는다 — ⑪의 기제', () => {
  const 대화 = [{ role: 'user', text: '아침에 보리차 마셨어. 기억해 둬.' }];
  for (let i = 0; i < 20; i += 1) {
    대화.push({ role: 'assistant', text: `${i} 답` }, { role: 'user', text: `${i + 1} 더하기 1은?` });
  }
  const 창 = 창예산({ modelId: 'gpt-5.1' });
  const 실림 = recentTurns(대화, { maxTurns: Infinity, maxChars: 창.이력자, maxPerTurn: 창.발화자 });
  assert.ok(실림.some((t) => t.text.includes('보리차')), '스무 턴 뒤 아침 발화가 상한 밖으로 밀렸다');
  // 반대 확인 — 옛 고정값이면 실제로 밀린다. 안 밀리면 이 봉인은 아무것도 안 재는 것이다.
  const 옛실림 = recentTurns(대화);
  assert.ok(!옛실림.some((t) => t.text.includes('보리차')), '옛 상한이 안 자르면 봉인의 대조군이 없다');
});

// ④ **끊긴 등식**(오너 지시 2026-08-11 · 아껴 쓰지 않게 한다).
//
// 옛 검사는 `결과몫걸음 === turn.js 의 MAX_TOOL_STEPS` 를 「두 진실 금지」로 쟀다.
// 그 등식은 두 질문에 한 답을 주고 있었다 — *한 턴이 얼마나 길어질 수 있나*(폭주 정지선)와
// *한 결과를 얼마나 크게 실을 수 있나*(창 나눔)는 다른 것이다. 걸음 정지선을 6→40 으로
// 올릴 때 창 나눔이 따라가면 `결과자` 가 1,700자로 떨어져 **바로 위 봉인이 깨진다.**
// 그래서 이제 재는 것은 일치가 아니라 **관계**다: 창 나눔은 정지선을 따라가지 않고,
// 정지선은 창 나눔보다 작아지지 않는다(작아지면 예산을 올린 것이 시늉이 된다).
test('창 나눔은 걸음 정지선을 따라가지 않는다 — 두 값은 다른 것을 잰다', async () => {
  const src = await readFile(new URL('../src/kernel/turn.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /const MAX_TOOL_STEPS/,
    '한 상수가 두 질문에 답하던 자리가 되살아났다 — 걸음 정지선과 창 나눔은 갈라 세운다');
  const m = src.match(/const 걸음정지선 = (\d+)/);
  assert.ok(m, 'turn.js 에서 걸음 정지선을 못 읽었다');
  assert.ok(Number(m[1]) >= 결과몫걸음,
    `걸음 정지선(${m[1]})이 창 나눔(${결과몫걸음})보다 작다 — 창은 넉넉한데 걸음이 먼저 문다`);
  // 창 나눔이 정지선을 따라 올라가면 이 파일 위쪽 봉인이 그 자리에서 깨진다. 그 사실을 못 박는다.
  assert.ok(창예산({ modelId: 'gpt-5.1' }).결과자 > 4588,
    '창 나눔이 걸음 정지선을 따라갔다 — 읽은 것이 다시 접힌다(08-05 사고)');
});
