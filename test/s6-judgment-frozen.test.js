// **판정 대조표가 동결이다** — S6-c 의 "행동 변화 0" 을 재는 자리.
//
// 오너 지시(2026-08-05):
//   *"S6-c 는 절대 게이트를 옮기는 칸이라 '행동 변화 0' 이 S6-a 보다 더 엄격해야 한다.
//     게이트가 한 건이라도 다르게 판정하면 그건 이사가 아니라 개조다."*
//
// S6-a 는 "회귀·돌연변이 불변"으로 닫았다. 그건 **덮인 것**만 말한다 —
// 검사가 안 밟은 조합에서 판정이 달라져도 초록이다.
// 그래서 **결정 공간 자체**(216칸)를 찍어 얼린다. 한 칸이라도 다르면 여기서 걸린다.
//
// §10 규율 12 그대로 — 이름·개수가 아니라 **결정**을 잰다.
//
// ── 이 검사가 실제로 잡은 것 ──────────────────────────────────────────────
// 표를 만들자마자 **내가 방금 넣은 개조**를 잡았다. `이월=true · 허락=true` 칸이
// `자동(면제:허락한손)` 으로 나왔다 — **이월된 파괴가 자동 실행**된다는 뜻이다.
// `허락한손` 은 *"이번 요청에서 허락했다"* 인데 **이월은 정의상 이번 요청이 아니다.**
// S6-b 가 면제를 `decideAutoGrant` 앞으로 옮기면서 절대 게이트를 뚫었다.
// 회귀 2,453 은 그때도 전부 초록이었다. **표가 아니었으면 못 봤다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { 표만들기, 동결본 } from '../scripts/s6/judgment-table.mjs';

test('경계의 판정 216칸이 동결본과 **한 칸도** 다르지 않다', async () => {
  const 지금 = await 표만들기();
  const 언것 = JSON.parse(await readFile(동결본, 'utf8'));

  assert.equal(지금.length, 언것.length,
    `결정 공간의 크기가 달라졌다(${언것.length} → ${지금.length}).\n`
    + '축을 늘렸으면 동결본을 갱신하고 **왜 늘렸는지** 커밋에 적어라.');

  const 다른칸 = 지금.map((r, i) => (r === 언것[i] ? null : { 전: 언것[i], 후: r })).filter(Boolean);
  assert.deepEqual(다른칸, [],
    `**판정이 달라졌다 — 이사가 아니라 개조다.**\n${
      다른칸.slice(0, 8).map((d) => `  전: ${d.전}\n  후: ${d.후}`).join('\n')
    }${다른칸.length > 8 ? `\n  …그 밖 ${다른칸.length - 8}칸` : ''}\n\n`
    + '정당한 변경이면 `node scripts/s6/judgment-table.mjs --write` 로 갱신하고\n'
    + '**어느 칸이 왜 바뀌었는지** 커밋에 적어라. 스스로 갱신되는 기준선은 기준선이 아니다.');
});

test('동결본이 **비어 있지 않다**(빈 표는 늘 통과한다)', async () => {
  const 언것 = JSON.parse(await readFile(동결본, 'utf8'));
  assert.ok(언것.length >= 100, `결정 공간이 너무 작다(${언것.length}칸) — 그물이 성긴 것이다`);
  // 결정이 한 종류뿐이면 표가 아무것도 못 가른다.
  const 종류 = new Set(언것.map((r) => r.split('→')[1]?.trim()));
  assert.ok(종류.size >= 3, `결정이 ${종류.size}종뿐이다 — 갈리는 축이 표에 없다`);
});

test('**게이트는 면제로 뚫리지 않는다** — 이월·발화밖 칸에 자동이 없다', async () => {
  const 언것 = JSON.parse(await readFile(동결본, 'utf8'));
  const 뚫린것 = 언것.filter((r) => r.includes('이월=true') && r.includes('→  자동'));
  assert.deepEqual(뚫린것, [],
    `이월된 호출이 자동으로 갔다 — 절대 게이트 "현재 요청 침해"가 면제에 뚫렸다:\n  ${
      뚫린것.slice(0, 5).join('\n  ')}`);
});
