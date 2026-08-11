// **손이 할 수 있게 됐는데 모델이 그 사실을 못 받으면 없는 능력이다** (콘솔 라이브 2026-08-12).
//
// `local.locate` 가 형식 질의에서 전수·자리별 분포를 세게 된 뒤(`formatTotal`·`formatByPlace`),
// 라이브 회차 ④ *"내 컴퓨터에 PDF 파일 있어?"* 를 세 번 돌렸더니 **세 번 다** 모델이
// `local.file{list ~}` 뒤에 **캡슐을 직접 짜서** Desktop·Documents·Downloads 를 손으로 훑었다.
// `local.locate` 를 한 번도 안 불렀다.
//
// 모델이 잘못한 게 아니다 — **우리가 안 말했다.** 손 설명서 어디에도 「형식으로 부르면 전수와
// 자리별 분포를 준다」가 없다. 이 파일의 손 설명서는 같은 병으로 이미 한 번 고쳐진 자리다
// (`demo-context.js` 주석 2026-08-07: *"모델이 잘못한 게 아니라 이 문장이 시킨 대로 한 것이다"*).
//
// 이건 T5 3등 핵심 그대로다 — **AI 앞에 현실을 차려주는 층.** 차려 놓지 않은 것은 없는 것이다.
// 판단은 그대로 모델의 몫이다(§24): 무엇을 부를지 고르는 것은 모델이고, 우리는 **있는 것을
// 있다고 적을** 뿐이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { makeLocalLocateTool } from '../src/runtime/local-locate.js';
import { demoDescriptors } from '../src/surface/demo-context.js';

const 설명 = () => {
  const d = (demoDescriptors() ?? []).find((x) => x.id === 'local.locate');
  assert.ok(d, '`local.locate` 설명서가 없다 — 전제부터 안 선다');
  return String(d.schema?.description ?? '');
};

test('전제: 손이 실제로 센다 — 없는 능력을 적으라고 하는 게 아니다', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'census-reach-')));
  try {
    for (const rel of ['가/a.pdf', '가/b.pdf', '나/c.pdf']) {
      const p = join(root, rel);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, 'x', 'utf8');
    }
    const r = await makeLocalLocateTool({ home: root, mdfind: async () => null })
      .handler({ what: 'pdf 파일', from: root, depth: 4 });
    assert.equal(r.result?.formatTotal, 3, `전수를 안 센다: ${r.result?.formatTotal}`);
    assert.ok((r.result?.formatByPlace ?? []).length, '자리별 분포가 없다');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('모델 설명서가 「형식으로 부르면 센다」를 말한다', () => {
  const d = 설명();
  assert.match(d, /형식/,
    `**설명서에 형식 질의가 없다** — 모델은 이 능력을 못 본다: ${d.slice(0, 200)}…`);
  assert.match(d, /몇 개|개수|전수/,
    `**「몇 개인지 준다」가 없다** — 모델은 다섯 후보만 받는 손으로 읽는다: ${d.slice(0, 200)}…`);
});

test('「직접 훑지 말라」가 아니라 「이걸 부르면 된다」로 적는다 — 판단은 모델 몫이다', () => {
  const d = 설명();
  assert.doesNotMatch(d, /캡슐|스크립트를? (짜지|쓰지) *마/,
    `다른 손을 금지하는 문장이 들어갔다 — 우리는 있는 것을 적을 뿐이다(§24): ${d}`);
});

test('반대시험: 그 문장이 빠지면 이 검사가 빨개진다 — 빈 계약이 아니다', () => {
  const 없는설명 = '사용자가 부른 대상이 어디인지 후보를 찾는다. 후보가 하나면 그대로 쓴다.';
  assert.throws(() => assert.match(없는설명, /형식/),
    '검사가 아무것도 안 재고 있다');
});
