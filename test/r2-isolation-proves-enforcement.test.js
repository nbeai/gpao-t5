// **격리 증명은 강제를 재야 한다.**
//
// PM 당부(2026-08-07 · 노드 R 순서 ② 선행):
//   *"`prove-isolation.mjs` 가 `scopeRoots` 가 고정판 하나인지를 봅니다. 루트를 넓히면
//     그 증명이 깨집니다. 증명이 재야 하는 것이 무엇인지 먼저 정하십시오."*
//
// 답은 **강제**다. 오늘 F-46 이 그것을 증명했다 —
// 선언은 넷(`defaultFileRoots`)인데 강제는 홈 전체(`local-file.js:331`)였고,
// 사람 셋이 그 차이에 걸렸다(PM 두 번 · 개발 라인 한 번).
// **선언이 하나인지 세는 증명은 선언이 바뀌는 순간 무너지고, 그 사이 강제는 안 재진다.**
//
// 격리에서 실제로 물어야 하는 것은 하나다: **오너 홈이 안 보이는가.**
// 터미널 손은 이미 그 축으로 잰다(④ — `ls -a ~/` 에 우리 표식이 보이고 `Library` 가 없다).
// 파일 손만 선언을 세고 있었다. 같은 축으로 세운다.
//
// ⚠ 격리는 이 저장소에서 **유일하게 되돌릴 수 없는 손해가 난 자리**다(2026-08-04·05 두 번,
// 오너 실제 파일이 위험했다). 여기서만은 한 번에 하나만 바꾼다 — 이 걸음은 증명 축만 옮긴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const 증명글 = () => readFileSync(
  fileURLToPath(new URL('../scripts/human-use/prove-isolation.mjs', import.meta.url)), 'utf8',
);

test('선언 개수를 세지 않는다 — 루트가 늘면 증명이 먼저 깨진다', () => {
  const 글 = 증명글();
  assert.doesNotMatch(글, /방들\.length === 1/,
    '**선언이 하나인지 센다** — 루트를 넓히는 순간 격리 증명이 무너진다(강제는 안 재고)');
});

test('파일 손이 보는 홈이 격리 방인지 표식으로 잰다 — 터미널과 같은 축', () => {
  const 글 = 증명글();
  assert.match(글, /파일 손[^\n]*표식|표식[^\n]*파일 손/,
    '**파일 손의 격리를 표식으로 안 잰다** — 오너 홈이 보여도 통과한다');
  assert.match(글, /격리표식/, '표식 이름이 없다');
});

test('무엇을 증명하는지 머리말이 강제를 말한다 — 다음 사람이 또 선언으로 읽지 않게', () => {
  const 머리 = 증명글().slice(0, 2000);
  assert.match(머리, /강제/,
    '**머리말이 여전히 선언 이야기다** — F-46 이 사람을 세 번 틀리게 한 그 모양이다');
});
