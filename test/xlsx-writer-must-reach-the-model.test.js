// **엑셀을 지을 수 있게 됐는데 모델이 그 사실을 못 받으면 없는 능력이다** (F-86 후속 · 2026-08-12).
//
// F-86 이 두 가지를 세웠다: (가) 이름만 `.xlsx` 인 것은 성공이 아니다(봉인) ·
// (나) 표 하나짜리 xlsx 를 T5 가 직접 짓는다(`buildXlsx`). 손은 실제로 된다 —
// 라이브 배선으로 오너 폴더에 2,702바이트짜리 `50 4b 03 04`(진짜 zip)를 만들어 확인했다.
//
// 그런데 **콘솔 라이브 7회차에서 모델이 `.xlsx` 쓰기를 한 번도 시도하지 않았다.** 매번
// 부품(`[Content_Types].xml`·`xl/`·`_rels/`)을 폴더에 풀고 `zip` 으로 묶으려다 마지막
// 계단에서 끝났다. 1회는 파일이 없는데 *"만들어 뒀어요"*(거짓 성공), 여러 회는
// *"터미널에서 아래만 실행하면 돼요"*(개발자 떠넘김).
//
// **모르는 것은 모델이지 손이 아니다.** 모델이 이 능력을 아는 자리는 도구 스키마 하나뿐인데
// 거기에 한 글자도 없었다. 오늘 같은 병을 이미 한 번 고쳤다 —
// `census-must-reach-the-model.test.js`(찾는 손이 세게 됐는데 설명서에 안 적혀 모델이
// 캡슐을 직접 짰다). **T5 3등 핵심 그대로: 차려 놓지 않은 것은 없는 것이다.**
//
// 판단은 그대로 모델의 몫이다(§24) — 다른 길을 금지하지 않고, **있는 것을 있다고 적을** 뿐이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { demoDescriptors } from '../src/surface/demo-context.js';

const 선언 = () => {
  const d = (demoDescriptors() ?? []).find((x) => x.id === 'local.file');
  assert.ok(d, '`local.file` 설명서가 없다 — 전제부터 안 선다');
  return d;
};
/** 모델이 실제로 읽는 글 전부 — 손 설명과 인자 설명은 같은 스키마 안의 한 벌이다. */
const 모델이읽는글 = () => {
  const d = 선언();
  const p = d.schema?.parameters?.properties ?? {};
  return [d.schema?.description, ...Object.values(p).map((v) => v?.description)]
    .filter(Boolean).join('\n');
};

test('전제: 손이 실제로 진짜 엑셀을 짓는다 — 없는 능력을 적으라는 게 아니다', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'xlsx-reach-')));
  try {
    const 손 = makeLocalFileTool({ roots: [root], home: root });
    const r = await 손.handler({
      action: 'write',
      path: join(root, '합계.xlsx'),
      text: '항목,합계\n자재비,208000\n운반비,45000\n',
    });
    assert.ok(!r?.blocked, `진짜 표를 .xlsx 로 못 쓴다: ${JSON.stringify(r).slice(0, 300)}`);
    const 바이트 = await readFile(join(root, '합계.xlsx'));
    assert.deepEqual([...바이트.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04],
      `zip 서명이 아니다 — 앞 4바이트: ${[...바이트.subarray(0, 4)].map((b) => b.toString(16))}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('모델 설명서가 「.xlsx 로 저장하면 진짜 엑셀이 된다」를 말한다', () => {
  const 글 = 모델이읽는글();
  assert.match(글, /xlsx/i,
    `**설명서에 xlsx 가 없다** — 모델은 이 능력을 못 본다: ${글.slice(0, 200)}…`);
  assert.match(글, /엑셀/,
    `**「엑셀」이라는 말이 없다** — 사용자는 그 말로 부른다: ${글.slice(0, 200)}…`);
});

test('부품을 폴더에 풀지 말라는 사실도 함께 간다 — 라이브 7회차가 매번 그리로 갔다', () => {
  const 글 = 모델이읽는글();
  assert.match(글, /부품|조립|풀지/,
    `**부품 조립 길을 그대로 두면 모델은 그리로 간다**(7/7 실측): ${글.slice(0, 300)}…`);
});

test('다른 손을 금지하지 않는다 — 고르는 것은 모델이다(§24)', () => {
  const 글 = 모델이읽는글();
  assert.doesNotMatch(글, /터미널을? 쓰지 *마|캡슐을? 쓰지 *마|셸을? 쓰지 *마/,
    `다른 손을 금지하는 문장이 들어갔다 — 우리는 있는 것을 적을 뿐이다: ${글}`);
});

test('반대시험: 그 문장이 빠지면 이 검사가 빨개진다 — 빈 계약이 아니다', () => {
  const 없는글 = 'write 일 때 저장할 내용';
  assert.throws(() => assert.match(없는글, /xlsx/i), '검사가 아무것도 안 재고 있다');
});
