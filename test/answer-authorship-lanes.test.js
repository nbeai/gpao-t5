// **답의 저작권은 누구에게 있는가 — 세 칸 계약.**
//
// 전환의 명제: *"연결을 제대로 하면 제어가 필요 없어진다."*(S2·F-15 에서 실물 확인)
// 그런데 그것을 **"모델의 답에 손대는 자리 22곳 → 0"** 이라는 숫자로 세웠던 것이 잘못이었다
// (검토 지적 2026-08-05, 오너 원칙: **대리지표를 결과로 세우지 말 것**).
//
// 22 → 0 을 목표로 삼으면:
//   · 렌더 12곳을 뜯어 **내부 표식이 사용자 화면으로 샌다**
//   · 빈 답 안전망을 뜯어 *"빈 답이 네 번 연속 나갔다"*(turn.js 주석, 오너 실사용) 가 재현된다
//   · 22 → 8 이 큰 진전처럼 보이는데 **진짜 것은 하나도 안 바뀔 수 있다**
//
// 그래서 숫자가 아니라 **칸**을 계약으로 둔다. 숫자는 늘었다 줄지만 칸은 계약이다.
//
//   ┌ 갈아치움(replace) — 모델의 답을 **런타임이 쓴 다른 문장**으로 바꾼다 → **0 이 목표**
//   ├ 반환(return)     — 원장과 대조해 **모델에게 되돌린다**. 고쳐 쓰는 것도 모델 → 있어도 된다
//   └ 렌더(render)     — 내부 표식 제거·순서 정리 → **있어야 한다**
//
// OpenClaw 도 0 이 아니다 — `heartbeat-runner.ts` 가 빈 답을 다룬다. 다만 **없으면 없는 것으로
// 두고**(빈 하트비트로 처리), T5 는 원장 사실로 채운다. 안 만지는 게 아니라 다르게 다룬다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const 뿌리 = join(dirname(fileURLToPath(import.meta.url)), '..');
const 읽기 = (p) => readFile(join(뿌리, p), 'utf8');

test('① **런타임 문장이 최종답이 되는 자리의 정의역** — 새 자리가 생기면 여기서 걸린다', async () => {
  // J12(2026-08-15 · 손 관리자 실측): 옛 자는 「정직한답」 낱말 세기라 정의역 중 2만
  // 물었고, 31행 주석("유일한 통로")이 코드와 어긋난 거짓 문장이었다. 재는 자가 틀리면
  // 재는 것이 전부 거짓 — 정의역을 **기제별로 열거**하고 개수를 갈래에서 도출한다.
  //
  // **무는 범위와 안 무는 범위**(감시자 검문 2026-08-15 — 이름으로 닫지 않기):
  //   문다   기제 A(정직한답)·B(fallbackReplyFrom) 의 **인스턴스 증가** — 새 호출부가
  //          생기면 갈래 계수가 어긋나 빨개진다(변이 양성 대조는 B 에서 성립 확인)
  //   못 문다 새 리터럴 문장(기제 C 는 등록 문자열 자체가 정의역이라 새 문장을 모른다) ·
  //          모델이 말하기 전에 끝나는 경로의 런타임 답(예: turn.js 승인 못찾음/만료
  //          리터럴 둘 — 모델 답 대체가 아니라 모델 이전 경로라 이 자의 정의역 밖)
  const turn = await 읽기('src/kernel/turn.js');

  // ── 기제 A · 정직한답 — P0 거짓 성공 게이트 (갈아치움 칸 · 목표 0 유지) ─────────────
  const A등록 = [
    /거짓성공\?\.blocked\) return 거짓성공\.정직한답/,
    /거짓성공정렬후\?\.blocked\) reply = 거짓성공정렬후\.정직한답/,
  ];
  const A실측 = [...turn.matchAll(/정직한답/g)].length;
  assert.equal(A실측, A등록.length,
    `정직한답 자리가 등록(${A등록.length})과 다르다(실측 ${A실측}). 늘렸다면 **왜 모델에게\n`
    + '돌려주지 않고 갈아치우는지**부터 답하고 여기 서명을 등록하라 — 이 칸의 목표는 0 이다.');
  for (const 서명 of A등록) assert.match(turn, 서명, `등록된 게이트 모양이 사라졌다: ${서명}`);

  // ── 기제 B · fallbackReplyFrom — 원장 문장이 최종답이 되는 호출부 ────────────────
  // B1 :708  `다시 || fallbackReplyFrom` — **빈 답 안전망(세 칸 밖 공백 처리) 판정**
  //          (손 관리자 지시로 자에 적는다 · 칸 이름은 계획 §3-A 의 셋을 늘리지 않는다):
  //          모델이 재시도 후에도 침묵했을 때 부재를 원장 사실로 메운다. 모델 답을
  //          **대체**하는 것이 아니라 **부재를 메우는** 것이므로 갈아치움(목표 0)이 아니다.
  //          선행 재시도가 있어야 한다는 근거는 검사 ③ 이 문다.
  // B2 :848  실물 있는 이름 변형 반복 — 지어낸 이름 대신 원장의 영수증 문장으로 끝낸다
  // B3 :852  미완 고지에 막힘 원장 문장 동봉
  const B등록 = [
    /다시 \|\| fallbackReplyFrom\(receipts\)/,
    /if \(!파일계약빈손\) return fallbackReplyFrom\(receipts\);/,
    /\(막힘 \? \[fallbackReplyFrom\(receipts\)\] : \[\]\)/,
  ];
  // 주석 줄(566행 백틱 예시 등)은 호출부가 아니다 — 본문에서만 센다. 정의부도 뺀다.
  const 본문 = turn.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  const B실측 = [...본문.matchAll(/fallbackReplyFrom\(/g)].length
    - [...본문.matchAll(/function fallbackReplyFrom\(/g)].length;
  assert.equal(B실측, B등록.length,
    `fallbackReplyFrom 호출부가 등록(${B등록.length})과 다르다(실측 ${B실측}). 새 자리는\n`
    + '어느 칸(갈아치움/반환/빈답)인지 판정 근거와 함께 여기 서명을 등록하라.');
  for (const 서명 of B등록) assert.match(turn, 서명, `등록된 호출부 모양이 사라졌다: ${서명}`);

  // ── 기제 C · 런타임 작성 리터럴 — 커널이 지은 문장이 그대로 최종답 ────────────────
  const C등록 = [/방금 요청은 아직 완료하지 못했어요/];
  const C실측 = [...turn.matchAll(/방금 요청은 아직 완료하지 못했어요/g)].length;
  assert.equal(C실측, C등록.length,
    `런타임 작성 최종답 리터럴이 등록(${C등록.length})과 다르다(실측 ${C실측}).`);

  // 이 단언은 도출이 아니라 **등록표를 늘릴 때 한 번 더 멈춰 세우는 턱**이다(감시자 정정 —
  // "도출값"이라 적으면 옛 31행과 같은 거짓 주석이 된다). 등록표를 바꾸면 이 수도 함께 바꾼다.
  assert.equal(A등록.length + B등록.length + C등록.length, 6);
});

test('② **반환 칸은 모델의 답을 쓴다** — 런타임 문장으로 대체하지 않는다', async () => {
  const turn = await 읽기('src/kernel/turn.js');
  // 출구검증은 원장 불일치를 **사실로 모델에게 주고** 모델이 고쳐 쓴 답을 돌려준다.
  assert.match(turn, /const 고친답 = userFacingModelText/,
    '출구검증이 모델의 답이 아닌 것을 돌려주게 바뀌었다 — 그러면 반환이 아니라 갈아치움이다');
  assert.match(turn, /return 고친답\.trim\(\) \? 고친답 : reply/,
    '모델이 못 고쳤을 때 원래 답을 지키지 않는다 — 검증은 그물이지 관문이 아니다');
});

test('③ **빈 답 안전망은 빈 답일 때만** 쓰인다(공백 처리이지 제어가 아니다)', async () => {
  const turn = await 읽기('src/kernel/turn.js');
  // 모델이 두 번 침묵했을 때만 원장 사실로 채운다. 그 앞에 재시도가 있어야 한다.
  assert.match(turn, /다시 \|\| fallbackReplyFrom\(receipts\)/,
    '재시도 없이 곧장 원장 문장으로 답을 만든다 — 모델에게 말할 기회를 안 준 것이다');
});

test('④ **렌더 칸은 지킨다** — 없애면 내부 표식이 사용자에게 샌다', async () => {
  const turn = await 읽기('src/kernel/turn.js');
  assert.match(turn, /userFacingModelText/,
    '내부 통제 채널 이름을 걷는 자리가 사라졌다 — 라이브에서 `memory.cite:` 가 화면에 나간 적이 있다');
  // 이 칸은 **줄이는 것이 목표가 아니다.** S5 에서 기억이 파일이 되면 이유 자체가 사라진다.
});

test('⑤ 칸 분류가 문서와 일치한다(계획 §3-A)', async () => {
  const 계획 = await 읽기('design/T5-AI-OS-TRANSITION-PLAN-2026-08-05-ko.md');
  for (const 칸 of ['갈아치움', '반환', '렌더']) {
    assert.ok(계획.includes(칸), `계획 §3-A 에 "${칸}" 칸이 없다 — 검사와 계획이 갈라졌다`);
  }
  // 숫자를 **목표**로 세우지 않는다. (정정문에서 "왜 숫자가 틀렸는지" 설명하는 것은 다르다.)
  assert.ok(계획.includes('대리지표'),
    '왜 숫자 목표를 버렸는지가 계획에 안 남아 있다 — 다음 사람이 같은 지표를 다시 세운다');
  assert.ok(/\*\*갈아치움\*\*\(replace\)/.test(계획), '칸 이름이 계획에 정확히 안 적혀 있다');
});
