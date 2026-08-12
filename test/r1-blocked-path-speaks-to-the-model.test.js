// **막혔을 때 모델에게는 길을, 사용자에게는 말을.**
//
// 노드 R 첫 걸음(계획서 `4dc9a17` · 순서 ①). 판 ⑫가 3/3 실패했고 손이 없어서가 아니었다.
//
// ```
// 원장(unconfirmed)  "제가 다루는 폴더(…) 안에서 /Users/jyp/Desktop/지난달 정산 파일 을(를)
//                     찾지 못했어요"
// 답                 "지금 제 손이 닿는 범위 … 안에서 찾지 못했어요"  → 사장님께 되물었다
// 같은 회차 ②        ~/GPAO-T5/지난달 정산 파일/6월 정산내역.csv 를 **실제로 읽었다**
// ```
//
// 멈춘 지점은 실패 메시지의 **둘째 줄**이다:
//   `"다른 폴더에 있다면 그 폴더를 열어 주시면 바로 볼게요."`
//
// 이 칸(`nextSafeAction`)은 **소비자가 둘**이다. 표면은 사용자에게 보여 주고
// (`server.js:1475` `recoverable_error`), **원장은 그것을 요약에 붙여 모델에게 보낸다**:
//
// ```
// ledger.js:59   unconfirmed.push(e.userSafeSummary + ` — ${e.nextSafeAction}`)
// ```
//
// 그래서 모델이 받은 문장이 *"…찾지 못했어요 — 다른 폴더에 있다면 그 폴더를 열어 주시면"* 이었다.
// **모델의 다음 행동이 "사용자에게 물어라"가 된 것**이고, 모델은 시킨 대로 했다.
// 같은 날 화면 손에서 고친 *"창제목으로 짚어 주세요"* 와 완전히 같은 병이다.
//
// **한 자리에서 고친다.** 영수증에 모델용 칸(`다음수단`)을 두고 원장이 그것을 먼저 쓴다 —
// 손마다 문구를 고치는 길은 손이 늘 때마다 다시 샌다(계획서: 문구가 아니라 구조).
//
// **금지 문구로 막지 않는다**(계획서 ⛔). 물어야 할 때는 실제로 있다.
// 막을 게 아니라 **길을 준다** — T5 에는 `local.locate` 라는 찾는 손이 있고,
// 같은 회차 ②가 그 파일을 읽었다는 것이 찾을 수 있다는 증거다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectReceipts } from '../src/kernel/l0-evidence/ledger.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

const 막힌영수증 = (더할것) => [{
  failureState: 'blocked',
  userSafeSummary: '제가 다루는 폴더 안에서 지난달 정산 파일 을(를) 찾지 못했어요.',
  nextSafeAction: '다른 폴더에 있다면 그 폴더를 열어 주시면 바로 볼게요.',
  ...더할것,
}];

test('모델이 받는 원장에는 모델용 다음 길이 간다 — 사용자용이 가면 그대로 되묻는다', () => {
  const { unconfirmed } = projectReceipts(막힌영수증({
    다음수단: [{ 방법: 'local.locate', 왜: '`local.locate` 로 그 이름이 어느 자리에 있는지 찾는다' }],
  }));
  const 줄 = unconfirmed.join(' ');
  assert.match(줄, /local\.locate/,
    `**모델에게 찾으라고 안 한다** — 손이 있는데 사장님께 떠넘긴다: ${줄}`);
  assert.doesNotMatch(줄, /열어 주시면/,
    `**사용자용 문장이 모델의 다음 행동이 된다** — 판 ⑫ 0/3 의 근인이다: ${줄}`);
});

// **폴백을 두지 않는다**(PM 지적 2026-08-07 · 커밋 직전).
// `다음수단` 이 없을 때 사람용 문장으로 메우면 그건 **옵트인**이고, 채워야 할 손 목록이 생긴다 —
// `local-file.js` 의 `fail()` 만 22곳이고 `nextSafeAction` 을 쓰는 손이 12개 파일이다.
// 그 목록이 정확히 오늘 하루 종일 앓은 병(만든 것과 닿은 것)이다.
// 그리고 폴백이 있으면 **아래 반대시험을 못 세운다** — 19곳이 다 빨개져 시험 자체가 안 선다.
test('모델용 길이 없으면 아무것도 안 준다 — 비어 있는 것보다 틀린 것이 나쁘다', () => {
  const { unconfirmed } = projectReceipts(막힌영수증({}));
  assert.doesNotMatch(unconfirmed.join(' '), /열어 주시면/,
    `**사용자용 문장이 폴백으로 샌다** — 손 12개 파일이 그대로 옛 병을 유지한다: ${unconfirmed.join(' ')}`);
  assert.match(unconfirmed.join(' '), /찾지 못했어요/,
    `막힌 사실 자체는 남아야 한다: ${unconfirmed.join(' ')}`);
});

test('모델에게 가는 칸에는 사람에게 시키는 말이 없다 — 새 손이 같은 실수를 해도 여기서 잡힌다', () => {
  const 시키는말 = /주세요|주시면|열어 주|골라 주|알려 주|말씀해/;
  const { unconfirmed } = projectReceipts(막힌영수증({
    다음수단: [{ 방법: 'local.locate', 왜: '그 이름이 어느 자리에 있는지 찾는다' }],
  }));
  assert.doesNotMatch(unconfirmed.join(' '), 시키는말,
    `**모델의 다음 행동이 "사용자에게 물어라"가 된다**: ${unconfirmed.join(' ')}`);
});

test('해낸 걸음은 안 건드린다 — 모델용 칸이 확인된 사실을 오염시키지 않는다', () => {
  // **가짜가 실물 조건을 안 채우면 계약이 아니라 모양만 지킨다** — `확인된사실` 은
  // `actualCall`·`result` 까지 본다(같은 병을 오늘 두 번 밟았다).
  const { confirmed, unconfirmed } = projectReceipts([{
    failureState: 'none', lifecycle: 'delivered', deliverableRefs: ['x'],
    actualCall: { tool: 'local.file', action: 'read' }, result: { ok: true },
    userSafeSummary: '6월 정산내역.csv 를 읽었어요.',
    다음수단: [{ 방법: 'local.locate', 왜: '이런 건 안 붙어야 한다' }],
  }]);
  assert.equal(unconfirmed.length, 0, `해낸 것이 미확인으로 갔다: ${JSON.stringify(unconfirmed)}`);
  assert.deepEqual(confirmed, ['6월 정산내역.csv 를 읽었어요.'],
    `**확인된 사실에 다음 길이 섞인다**: ${JSON.stringify(confirmed)}`);
});

// ── 손이 그 칸을 실제로 채운다 ──────────────────────────────────────────
test('파일을 못 찾으면 찾는 손으로 가라고 모델에게 말한다', async () => {
  const 손 = makeLocalFileTool({ roots: ['/없는루트'], homeDir: '/없는홈' });
  const r = await 손.handler({ action: 'read', path: '지난달 정산 파일/6월.csv' });
  assert.equal(r.blocked, true, `못 찾은 것이 막힘으로 안 온다: ${JSON.stringify(r).slice(0, 200)}`);
  assert.match(JSON.stringify(r.다음수단 ?? []), /locate|찾/,
    `**모델에게 다음 길이 없다** — "못 찾았다"에서 끝나 사장님께 되묻는다: ${JSON.stringify(r).slice(0, 300)}`);
});

test('사용자에게 하는 말은 그대로 남는다 — 표면이 읽을 문장이 사라지면 안 된다', async () => {
  const 손 = makeLocalFileTool({ roots: ['/없는루트'], homeDir: '/없는홈' });
  const r = await 손.handler({ action: 'read', path: '지난달 정산 파일/6월.csv' });
  assert.ok(String(r.userSafeSummary ?? '').trim(), `사용자 말이 비었다: ${JSON.stringify(r)}`);
  assert.ok(String(r.nextSafeAction ?? '').trim(), `사용자용 다음 말이 비었다: ${JSON.stringify(r)}`);
});

test('못 찾은 것과 없는 것을 가른다 — "없다"로 단정하지 않는다', async () => {
  const 손 = makeLocalFileTool({ roots: ['/없는루트'], homeDir: '/없는홈' });
  const r = await 손.handler({ action: 'read', path: '지난달 정산 파일/6월.csv' });
  assert.doesNotMatch(JSON.stringify(r.다음수단 ?? []), /없어요|존재하지 않/,
    `**없다고 단정한다** — 자리를 모르는 것뿐이다: ${JSON.stringify(r).slice(0, 200)}`);
});

// ── 손이 늘어도 다시 안 새게 ────────────────────────────────────────────
// PM 지적(2026-08-07): `local-file.js` 의 `fail()` 만 22곳이고 `nextSafeAction` 을 쓰는 손이
// 12개 파일이다. **손으로 훑을 수 없다.** 폴백을 끊었으니 새는 건 멈췄지만, 앞으로 누가
// `다음수단` 에 사람용 문장을 넣으면 같은 병이 돌아온다. 그 자리를 기계로 막는다.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('손이 모델에게 주는 길에 사람에게 시키는 말이 없다', () => {
  const 뿌리 = fileURLToPath(new URL('../src/runtime', import.meta.url));
  const 시키는말 = /주세요|주시면|알려\s*주|골라\s*주|열어\s*주|말씀해/;
  const 걸린것 = [];
  for (const 이름 of readdirSync(뿌리)) {
    if (!이름.endsWith('.js')) continue;
    const 글 = readFileSync(join(뿌리, 이름), 'utf8');
    글.split('\n').forEach((줄, i) => {
      // `다음수단` 항목의 `왜:` 는 **모델이 읽는 글**이다. 사용자에게 하는 말은
      // `userSafeSummary`·`nextSafeAction` 자리이지 여기가 아니다.
      if (!/왜:/.test(줄) || !시키는말.test(줄)) return;
      if (/^\s*\/\//.test(줄)) return;   // 주석은 사람이 읽는 글이다
      걸린것.push(`${이름}:${i + 1} ${줄.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(걸린것, [],
    `**모델이 읽는 길에 사용자에게 시키는 말이 있다** — 모델은 그걸 그대로 사용자에게 옮긴다:\n${걸린것.join('\n')}`);
});
