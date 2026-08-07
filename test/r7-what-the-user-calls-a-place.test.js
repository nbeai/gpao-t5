// **사용자가 부르는 말과 실제 자리를 이어 준다.**
//
// PM 매듭 ①(2026-08-07 · 8판 뒤): ⑤⑬⑫ 가 한 자리다 — *"후보를 찾고 → 틀린 것을 고른다."*
// ⑫를 밟았고 모양이 이랬다:
// ```
// 사용자        "…바탕화면에 저장해줘"
// 원장 6번째    ~/GPAO-T5/Desktop/6월정산요약.txt 을(를) 읽었어요     ← 자기가 7월에 만든 것
// 원장 8번째    6-7월정산_비교요약.txt 을(를) 만들었어요              ← 그 옆에 썼다
// 실물          ~/GPAO-T5/Desktop/6-7월정산_비교요약.txt  1,128B
// ```
// **파일은 만들었고 내용도 맞다**(합계 2,440,000 · 못 본 7월까지 적혀 있다). 자리가 틀렸다.
// R2 회차에는 T5 가 스스로 *"윤님이 바로 보시는 바탕화면에는 안 보일 수 있어요"* 라고 밝혔다 —
// **거짓말이 아니라 못 이은 것이다.**
//
// 왜 못 이었나. 모델이 매 턴 받는 자리 목록이 이렇다:
// ```
// 볼 수 있는 자리: Desktop · Developer · Documents · Downloads · GPAO-T5 · …
// ```
// **이름만 있고 사용자가 부르는 말이 없다.** 사장님은 "바탕화면"이라고 하지 `Desktop` 이라
// 하지 않는다. 그 대응이 프롬프트 어디에도 없어서, 모델은 방금 읽은 `~/GPAO-T5/Desktop` 에
// 끌렸다(그 문자열이 그 턴 문맥에 21회 있었다).
//
// `local.locate` 는 이미 그 대응을 갖고 있다(`표준폴더말`) — 다만 **모델이 물어야** 쓴다.
// 자리 목록에 함께 실으면 묻지 않아도 이어진다. 낱말 목록을 새로 만드는 게 아니라
// **이미 있는 대응을 옮기는 것**이다(오늘 배운 그대로).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const 자리목록 = async (자리들) => {
  const { makeLocalLocateTool } = await import('../src/runtime/local-locate.js');
  const 손 = makeLocalLocateTool({ home: '/Users/사장님', places: async () => 자리들 });
  return String((await 손.operatorFactLine?.()) ?? (await 손.places?.().then((p) => JSON.stringify(p))) ?? '');
};

const 표준 = [
  { label: 'Desktop', path: '/Users/사장님/Desktop' },
  { label: 'Documents', path: '/Users/사장님/Documents' },
  { label: 'Downloads', path: '/Users/사장님/Downloads' },
  { label: 'GPAO-T5', path: '/Users/사장님/GPAO-T5' },
];

test('사용자가 부르는 말을 함께 준다 — 사장님은 "Desktop" 이라 하지 않는다', async () => {
  const { 부르는말붙이기 } = await import('../src/runtime/local-locate.js');
  const 글 = 부르는말붙이기(표준, { home: '/Users/사장님' });
  assert.match(글, /바탕화면/,
    `**"바탕화면"이 어느 자리인지 안 준다** — 모델이 방금 본 동명 폴더에 끌린다: ${글}`);
  assert.match(글, /문서/, `문서가 없다: ${글}`);
  assert.match(글, /다운로드/, `다운로드가 없다: ${글}`);
});

test('원래 이름도 남긴다 — 모델이 그 이름으로 손을 부른다', async () => {
  const { 부르는말붙이기 } = await import('../src/runtime/local-locate.js');
  const 글 = 부르는말붙이기(표준, { home: '/Users/사장님' });
  for (const 이름 of ['Desktop', 'Documents', 'Downloads', 'GPAO-T5']) {
    assert.ok(글.includes(이름), `**원래 이름이 사라졌다** — 손이 그 이름을 받는다: ${글}`);
  }
});

test('부르는 말이 없는 자리는 그대로 둔다 — 없는 우리말을 지어내지 않는다', async () => {
  const { 부르는말붙이기 } = await import('../src/runtime/local-locate.js');
  const 글 = 부르는말붙이기([{ label: '외장하드', path: '/Volumes/외장하드' }], { home: '/Users/사장님' });
  assert.equal(글.trim(), '외장하드', `**멀쩡한 이름에 군더더기가 붙는다**: ${글}`);
});

test('동명 폴더가 딴 데 있어도 표준 자리 하나만 그 말로 부른다', async () => {
  const { 부르는말붙이기 } = await import('../src/runtime/local-locate.js');
  const 글 = 부르는말붙이기([
    { label: 'Desktop', path: '/Users/사장님/Desktop' },
    { label: 'Desktop', path: '/Users/사장님/GPAO-T5/Desktop' },
  ], { home: '/Users/사장님' });
  assert.equal((글.match(/바탕화면/g) ?? []).length, 1,
    `**둘 다 "바탕화면"이라고 부른다** — 고르는 근거가 도로 사라진다: ${글}`);
});

// ── 그 말이 매 턴 모델에게 실린다 ───────────────────────────────────────
// `working-state.js` 가 `p.label` 만 실었다 — 이 자리를 안 고치면 위 넷이 다 초록인데
// 모델은 여전히 `Desktop · Documents` 만 본다. 오늘 아홉 번 밟은 그 병이다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('매 턴 실리는 자리 목록에 부르는 말이 붙는다 — 여기가 비면 위 넷이 장식이다', async () => {
  const { workingStateFacts } = await import('../src/kernel/l0-evidence/working-state.js');
  // **실제 홈을 쓴다** — `부르는말붙이기` 는 홈 바로 아래인지로 표준 자리를 가른다.
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  const 글 = String(workingStateFacts({
    places: [
      { label: 'Desktop', path: join(homedir(), 'Desktop') },
      { label: 'GPAO-T5', path: join(homedir(), 'GPAO-T5') },
    ],
  }) ?? '');
  assert.match(글, /바탕화면/,
    `**모델은 여전히 영어 이름만 본다** — "바탕화면에 저장해줘"를 못 잇는다: ${글}`);
});

test('그 함수를 실제로 부른다 — 안 부르면 label 만 나간다', () => {
  const 글 = readFileSync(fileURLToPath(new URL('../src/kernel/l0-evidence/working-state.js', import.meta.url)), 'utf8');
  assert.match(글, /부르는말붙이기/,
    '**자리 목록이 이름만 나간다** — 사장님이 부르는 말과 이을 근거가 없다');
});
