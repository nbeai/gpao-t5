// **표면 사실은 그리기만이 아니라 받기도 말한다** — 사용자가 여기서 무엇을 건넬 수 있는가.
//
// 라이브 실측(2026-08-04 · 사람 사용시험 · 실제 브라우저 · gpt-5.1):
//   사용자 "작년결산.xlsx 열어서 매출 합계 알려줘"
//   T5    "이 컴퓨터에서 찾지 못했어요. … ① **이 대화에 파일을 직접 올려줘** —
//          채팅창에 드래그 앤 드롭하거나, **첨부 기능이 있으면** 그걸로 올려줘"
//
// 그런 문이 **어디에도 없다.** 화면의 `＋` 는 핸들러 없는 `<span>` 이고(눌러서 확인),
// 업로드 문도 없고, 채널 수신에도 첨부 경로가 없다. `document-intake` 는 **디스크에 이미
// 있는 파일**의 본문을 뽑는 것이지 사용자에게서 받는 문이 아니다.
//
// ── 무엇이 잘못됐나 ────────────────────────────────────────────────────────
// "있으면"이라는 조건부가 증거다 — 모델은 **자기 화면에 무엇이 있는지 모른 채** 답했다.
// 그리고 그 짐작이 사용자를 없는 길로 보냈다. 정본이 금지한 "못 지킬 약속"이다
// (`file-scope.js`: 열릴 수 없는 면을 약속했던 자리와 같은 병).
//
// 표면 사실(`responseSurfaceFacts`)은 **그리기**만 말하고 있었다:
//   "웹 대화 화면. 제목·목록·코드 블록이 서식으로 그려진다."
// 나가는 쪽만 있고 **들어오는 쪽이 없었다.**
//
// ── 하드코딩하지 않는다 ────────────────────────────────────────────────────
// "파일을 못 받는다"를 문장에 박으면 오늘 고친 방(`local.file` 능력 문장)과 같은 병이 된다 —
// 문이 생기는 날 그 문장이 거짓이 된다. **표면이 자기 문을 선언하고**, 사실은 거기서 나온다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveResponseSurface, responseSurfaceFacts } from '../src/kernel/l0-evidence/response-surface.js';

test('웹 표면 사실에 **받는 문**이 함께 온다(그리기만 말하지 않는다)', () => {
  const 사실 = responseSurfaceFacts(resolveResponseSurface({}));
  assert.ok(사실, '웹 표면 사실이 없다');
  assert.match(사실, /건네|건넬|올리|받|첨부/,
    `표면 사실이 나가는 쪽만 말한다 — 모델은 "첨부가 있으면"이라고 짐작하게 된다: "${사실}"`);
});

test('받는 문이 없으면 **없다고** 말한다(짐작할 여지를 남기지 않는다)', () => {
  const 사실 = responseSurfaceFacts(resolveResponseSurface({}));
  assert.doesNotMatch(사실, /있으면|있을 수|아마/, `사실 자리에 짐작이 섞였다: "${사실}"`);
  assert.match(사실, /없|못/, `받을 수 없다는 사실이 안 간다: "${사실}"`);
});

test('채널 표면도 같은 계약을 지킨다', () => {
  for (const ch of ['telegram', 'slack']) {
    const 사실 = responseSurfaceFacts(resolveResponseSurface({
      source: 'external_channel', channel: ch, channelLabel: ch,
    }));
    assert.match(사실, /건네|건넬|올리|받|첨부/, `${ch}: 받는 쪽 사실이 없다 — "${사실}"`);
  }
});

test('**하드코딩이 아니다** — 문이 생기면 사실이 바뀐다', () => {
  const 열린표면 = { ...resolveResponseSurface({}), 받는문: '파일을 이 화면에 끌어다 놓을 수 있다' };
  const 사실 = responseSurfaceFacts(열린표면);
  assert.match(사실, /끌어다 놓/,
    `표면이 선언한 문이 사실에 안 실린다 — 문장에 "없다"가 박혀 있으면 문이 생겨도 거짓말이 된다: "${사실}"`);
  assert.doesNotMatch(사실, /없어요|받지 못/, '문이 있는데 없다고 말한다');
});

// ── 화면에 **죽은 버튼**이 없다 ────────────────────────────────────────────
//
// 화면의 `＋` 는 첨부처럼 보이지만 핸들러가 없다(브라우저에서 눌러 확인: onclick 없음 ·
// file input 안 생김 · drop 핸들러 없음 · cursor:auto). 사용자는 그것을 첨부로 읽는다.
// **죽은 버튼 금지**(승인 만료 계약과 같은 규율) — 안 되는 것을 되는 것처럼 두지 않는다.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

test('화면에 **동작하지 않는 첨부 표시**가 없다', async () => {
  const 화면 = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'surface', 'web', 'index.html'), 'utf8',
  );
  const 첨부처럼 = /class="plus"/.test(화면);
  if (!첨부처럼) return;                       // 없애는 것도 정답이다
  assert.match(화면, /input[^>]*type=["']file["']|ondrop|'drop'/,
    '첨부처럼 보이는 것이 화면에 있는데 받는 배선이 없다 — 죽은 버튼이다');
});
