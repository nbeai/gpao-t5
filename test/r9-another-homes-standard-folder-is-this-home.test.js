// **다른 집의 표준 폴더를 가리키는 절대 경로는 이 집의 그 자리다** (6단계 ⑫ R3 봉인 · 2026-08-09).
//
// 원장 사실(evidence/step6-compare-2026-08-09/R3-item12/회차.json):
//   발화 "…바탕화면에 저장해줘" · unconfirmed ×4 "…은(는) 파일 도구의 작업 폴더 밖이에요."
//   → 실물은 작업 폴더에 남고 답은 "드래그해서 바탕화면으로 옮기면 끝이야"(자리 이탈 + 떠넘김).
// 전수 프로브(수리 라인 2026-08-09): 그 회차 구성(roots=[방/GPAO-T5], home=방)에서 상대·`~`·
// `Desktop/` 표기는 전부 범위 안이고, **절대 경로(지어낸 홈 꼴 `/Users/<이름>/Desktop/…`)만**
// 그 거절 문장을 만든다 — 모델이 바탕화면을 절대 경로 코트로 짚은 것이 원인이다.
//
// 수리: 상대 표기 규칙(relative-standard-folder-anchors-home 봉인)과 같은 원리를 절대 코트에
// 잇는다 — 사용자의 바탕화면은 하나다. 홈 꼴만 옮기고, 실제 다른 자리(/Volumes/…)는 그대로
// 거절한다. 부름말(문서·바탕화면) 상대 경로는 여전히 가로채지 않는다(기존 봉인 유지 · F-50).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

// tmp 밖의 홈 모양 — F7.3(시스템을 품는 임시 경로 면제 제거)을 안 밟는 자리(기존 봉인에서 배움).
// 단 저장소 루트에 바로 파면 안 된다: `artifactIdentity`(scripts/human-use/harness-qualification.mjs:228)
// 가 `git ls-files --others --exclude-standard` 로 뜬 목록을 300ms 동안 훑는데, 그 사이 만들었다
// 지운 방이 ENOENT 를 만들어 전체 회귀가 간헐로 빨개졌다(2026-08-12 실측). `tmp/` 는 .gitignore
// 되어 있어 그 정의역 밖이면서 SCRATCH(os.tmpdir·/tmp)도 아니다 — 두 성질을 다 지킨다.
const 방뿌리 = join(process.cwd(), 'tmp');

async function 무대() {
  await mkdir(방뿌리, { recursive: true });
  const H = await mkdtemp(join(방뿌리, '.tmp-abs-anchor-'));
  const A = join(H, 'GPAO-T5');
  await mkdir(A, { recursive: true });
  await mkdir(join(H, 'Desktop'), { recursive: true });
  return { H, A, 손: makeLocalFileTool({ roots: [A], homeDir: H, dataDir: A }) }; // 회차 방과 같은 구성
}

test('지어낸 홈 꼴 절대 경로 write 가 이 집 바탕화면 실물에 닿는다 — R3 의 네 번 거절이 이 자리다', async () => {
  const { H, A, 손 } = await 무대();
  try {
    for (const 경로 of ['/Users/누군가/Desktop/요약.txt', '/Desktop/요약.txt']) {
      const r = await 손.handler({ action: 'write', path: 경로, text: 'x' }, {});
      assert.ok(!r.blocked && !r.failed, `${경로} write 가 거절됐다 — R3 자리 이탈이 그대로다: ${r.userSafeSummary}`);
      assert.equal(r.result?.path, join(H, 'Desktop', '요약.txt'), `${경로} 가 홈 바탕화면이 아닌 곳에 풀렸다`);
      await rm(join(H, 'Desktop', '요약.txt'), { force: true }); // 다음 대조가 덮어쓰기 갈래로 새지 않게
    }
    assert.ok(!existsSync(join(A, 'Desktop')), '루트 안 Desktop 이 생겼다 — 앵커가 갈렸다');
  } finally { await rm(H, { recursive: true, force: true }); }
});

test('카드도 같은 자리를 말한다 — 실행과 카드가 한 함수를 지난다(두 진실 금지)', async () => {
  const { H, 손 } = await 무대();
  try {
    const 카드 = 손.previewOf({ action: 'write', path: '/Users/누군가/Desktop/요약.txt', text: 'x' });
    assert.equal(카드.scope.includes('누군가'), false, `카드가 지어낸 집을 말한다: ${카드.scope}`);
    assert.ok(String(카드.scope).includes(join('Desktop', '요약.txt')),
      `카드가 실행과 다른 자리를 말한다: ${카드.scope}`);
  } finally { await rm(H, { recursive: true, force: true }); }
});

test('반대시험: 실제 다른 자리는 옮기지 않는다 — 외장 디스크·홈 꼴 아님·표준 폴더 없음은 그대로 거절', async () => {
  const { H, 손 } = await 무대();
  try {
    const 경우들 = [
      '/Volumes/외장/Desktop/요약.txt',            // 실제 다른 자리 — 조용한 바꿔치기 금지
      '/Users/누군가/시안/요약.txt',               // 표준 폴더가 없다 — 번역할 말이 없다
      '/Users/누군가/작업/Desktop/요약.txt',        // 홈 바로 아래가 아니다 — 홈 꼴이 아니다
      '/opt/Desktop아님/요약.txt',                 // 아무 것도 아니다
    ];
    for (const 경로 of 경우들) {
      const r = await 손.handler({ action: 'write', path: 경로, text: 'x' }, {});
      assert.ok(r.blocked, `${경로} 가 허용됐다 — 바꿔치기다: ${r.userSafeSummary}`);
      assert.ok(!existsSync(join(H, 'Desktop', '요약.txt')), `${경로} 실물이 홈 바탕화면에 생겼다`);
    }
  } finally { await rm(H, { recursive: true, force: true }); }
});

test('반대시험: 홈 앵커를 지나 홈 밖으로 나가는 절대 경로는 거절된다 — 정규화 뒤에는 표준 폴더가 없다', async () => {
  const { H, 손 } = await 무대();
  try {
    const r = await 손.handler({ action: 'write', path: '/Users/누군가/Desktop/../../../탈출.txt', text: 'x' }, {});
    assert.ok(r.blocked, `탈출 경로가 허용됐다: ${r.userSafeSummary}`);
    assert.ok(!existsSync(join(H, '..', '탈출.txt')), '홈 밖에 실물이 생겼다');
  } finally { await rm(H, { recursive: true, force: true }); }
});

test('행동 보존: 홈 안을 가리킨 절대 경로·부름말 상대 경로는 예전 그대로다', async () => {
  const { H, A, 손 } = await 무대();
  try {
    // 홈 안 절대 경로 — 범위 안이라 번역 자리에 아예 안 온다.
    const r1 = await 손.handler({ action: 'write', path: join(H, 'Desktop', '직접.txt'), text: 'x' }, {});
    assert.equal(r1.result?.path, join(H, 'Desktop', '직접.txt'));
    // 부름말 상대 경로는 여전히 평범한 폴더 이름이다(F-50 열린 채 유지 · 기존 봉인과 같은 선).
    const r2 = await 손.handler({ action: 'write', path: '문서/메모.md', text: 'x' }, {});
    assert.ok(existsSync(join(A, '문서', '메모.md')), '부름말 상대 경로를 가로챘다 — 기존 봉인 위반');
  } finally { await rm(H, { recursive: true, force: true }); }
});
