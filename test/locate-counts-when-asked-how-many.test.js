// **형식 질의는 「어느 것?」이 아니라 「있어? 몇 개? 어디?」다** (콘솔 라이브 6회차 · 2026-08-12).
//
// 오너 지시: *"엑셀·PDF·텍스트 파일 등을 다양하게 찾게 해봐. 폴더명을 알려주고, 안 알려주고
// 이렇게 따로. 즉, 특화된 집게가 아니라 진짜 손이 되어야 하니까."*
//
// 밟은 회차 셋 — 뿌리는 **하나**다:
//   ⑤ "문서 폴더에 텍스트 파일" → 후보 5칸을 다 쓴 목록을 「이렇게 있어요」로 냈다.
//      `~/Documents` 바로 밑 `무제 9.txt` 등이 빠졌는데 빠졌다는 말이 없다.
//   ⑥ "내 컴퓨터에 텍스트 파일" → 5칸이 전부 Downloads 로 찼고 모델이
//      *"**전부** 다운로드 폴더 안에 있습니다"* 라고 답했다. **거짓 완결.**
//   ④ "내 컴퓨터에 PDF" → 손이 못 세니 모델이 캡슐로 직접 디스크를 훑다 예산에서 죽었다.
//
// `MAX_CANDIDATES = 5` 는 **고르기 자**다(「어느 것?」에는 맞다). 세기 질문에 고르기 자를
// 대면 빠뜨리고(⑤), 빠뜨린 채 「전부」라고 말하고(⑥), 손이 못 하니 모델이 임시 도구를
// 만든다(④). **새 손도 새 갈래도 만들지 않는다 — 이미 선 형식 갈래의 자를 바꾼다.**
//
// 실물 홈 실측(2026-08-12)이 자 선택의 근거다:
//   `kMDItemFSName == '*.pdf'c`      → 14  (**점이 토크나이저를 깬다. 쓰면 안 된다**)
//   `mdfind -name '.pdf'`            → 85
//   `kMDItemContentType == 'com.adobe.pdf'` → 87 = 정확 (UTI 표가 필요하다)
//   `kMDItemFSName == '*pdf'c`       → 87 = 정확, **UTI 표가 필요 없다** ← 이걸 쓴다
// 점을 뺀 꼴은 상위집합이라 디렉터리 `…/skills/xlsx` 같은 것도 걸리는데, 그건
// **이미 있는 확장자 자**로 거른다 — 색인은 자가 아니라 **닿는 범위**를 넓히는 것뿐이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { makeLocalLocateTool } from '../src/runtime/local-locate.js';

async function 방(파일들) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'locate-count-')));
  for (const rel of 파일들) {
    const p = join(root, rel);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, 'x', 'utf8');
  }
  return root;
}
/** 색인 없음 대역 — 임시 방은 Spotlight 가 안 보는 자리이므로 이게 기본값이다. */
const 색인없음 = async () => null;
const 부르기 = async (root, 말, opts = {}) =>
  makeLocalLocateTool({ home: root, mdfind: opts.mdfind ?? 색인없음 })
    .handler({ what: 말, from: opts.from ?? root, depth: opts.depth ?? 4 });

test('① 형식 질의에 **전수**가 선다 — 5칸이 아니라 실제 개수', async () => {
  // 5칸을 넘겨야 「고르기 자」와 「세기 자」가 갈린다. 12개를 둔다.
  const 파일들 = Array.from({ length: 12 }, (_, i) => `자료/보고${i}.pdf`);
  const root = await 방([...파일들, '메모/그냥글.md']);
  try {
    const r = await 부르기(root, 'pdf 파일');
    assert.equal(r.result?.formatTotal, 12,
      `**전수를 안 센다**(5칸에 갇혔다): formatTotal=${r.result?.formatTotal}`);
    // 후보는 여전히 5칸이다 — 세기가 고르기를 밀어내지 않는다.
    assert.equal((r.result?.candidates ?? []).length, 5,
      `고르기 칸이 바뀌었다: ${(r.result?.candidates ?? []).length}`);
    assert.match(String(r.userSafeSummary), /12/,
      `사람 문장에 전수가 없다: ${r.userSafeSummary}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('② 자리별 분포가 선다 — 어디에 몇 개', async () => {
  const root = await 방([
    'ㄱ/1.pdf', 'ㄱ/2.pdf', 'ㄱ/3.pdf',
    'ㄴ/4.pdf', 'ㄴ/5.pdf',
    'ㄷ/깊이/6.pdf',
  ]);
  try {
    const r = await 부르기(root, 'pdf 파일');
    const 분포 = r.result?.formatByPlace;
    assert.ok(Array.isArray(분포) && 분포.length >= 3,
      `**분포가 없다** — ⑥의 "전부 다운로드 안에" 는 여기가 비어서 나온 말이다: ${JSON.stringify(분포)}`);
    const 맵 = Object.fromEntries(분포.map((p) => [p.path, p.count]));
    assert.equal(맵[join(root, 'ㄱ')], 3, `ㄱ 분포가 틀렸다: ${JSON.stringify(분포)}`);
    assert.equal(맵[join(root, 'ㄴ')], 2, `ㄴ 분포가 틀렸다: ${JSON.stringify(분포)}`);
    assert.equal(맵[join(root, 'ㄷ/깊이')], 1, `ㄷ/깊이 분포가 틀렸다: ${JSON.stringify(분포)}`);
    // 합이 전수와 맞아야 한다 — 안 맞으면 둘 중 하나가 거짓말이다.
    assert.equal(분포.reduce((n, p) => n + p.count, 0), r.result?.formatTotal,
      `분포 합과 전수가 다르다: ${JSON.stringify(분포)} vs ${r.result?.formatTotal}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('③ 색인이 못 쓰는 자리에서도 걸음으로 답이 나오고, **어느 자를 썼는지 말한다**', async () => {
  const root = await 방(['ㄱ/1.pdf', 'ㄴ/2.pdf', 'ㄴ/3.pdf']);
  try {
    // 색인 대역이 던져도(= mdutil 꺼짐·비색인 볼륨) 턴이 죽지 않아야 한다.
    const 던짐 = async () => { throw new Error('mdfind_unavailable'); };
    const r = await 부르기(root, 'pdf 파일', { mdfind: 던짐 });
    assert.equal(r.result?.formatTotal, 3,
      `색인이 없으면 세기를 포기한다: ${JSON.stringify(r.result?.formatTotal)}`);
    assert.equal(r.result?.countedBy, 'walk',
      `**어느 자로 쟀는지 안 말한다**: countedBy=${r.result?.countedBy}`);
    assert.match(String(r.userSafeSummary), /직접 훑/,
      `사람 문장이 자를 안 밝힌다: ${r.userSafeSummary}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('④ 색인이 **덜 센 것**을 전수로 내세우지 않는다 — 걸음이 더 봤으면 그게 남는다', async () => {
  const root = await 방(['ㄱ/1.pdf', 'ㄱ/2.pdf', 'ㄴ/3.pdf']);
  try {
    // 색인이 하나만 안다(방금 만든 파일은 색인에 아직 없다 — 실제로 흔한 일이다).
    const 덜센색인 = async () => [join(root, 'ㄱ/1.pdf')];
    const r = await 부르기(root, 'pdf 파일', { mdfind: 덜센색인 });
    assert.equal(r.result?.formatTotal, 3,
      `**색인이 놓친 2개를 없는 것으로 만들었다**: ${r.result?.formatTotal}`);
    assert.equal(r.result?.indexMissed, 2,
      `색인이 못 본 개수를 안 남긴다: indexMissed=${r.result?.indexMissed}`);
    assert.match(String(r.userSafeSummary), /색인/,
      `색인이 덜 봤다는 사실이 사람 문장에 없다: ${r.userSafeSummary}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('⑤ 이름 질의는 예전 그대로 — 세는 칸이 아예 안 선다', async () => {
  const root = await 방(['a/견적서.pdf', 'b/계약서.pdf']);
  try {
    const r = await 부르기(root, '견적서');
    assert.equal(r.result?.formatTotal, undefined,
      `**이름 질의에 세기가 새어 들어왔다**: ${JSON.stringify(r.result?.formatTotal)}`);
    assert.equal(r.result?.formatByPlace, undefined,
      `이름 질의에 분포가 섰다: ${JSON.stringify(r.result?.formatByPlace)}`);
    const 파일 = (r.result?.candidates ?? []).filter((c) => c.kind === 'file');
    assert.ok(파일.length && 파일.every((c) => c.path.includes('견적서')),
      `이름 질의에 다른 파일이 딸려 왔다: ${JSON.stringify(파일.map((c) => c.path))}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('⑥ 보호구역은 **세기에서도** 안 샌다 — 전수·분포·후보 어디에도 없다', async () => {
  const root = await 방(['ㄱ/1.txt', 'ㄱ/.env', '비밀/secret.key.txt', 'ㄴ/2.txt']);
  try {
    // 색인은 보호 파일까지 안다고 치자 — 색인이 알아도 우리가 내면 안 된다.
    const 색인 = async () => [
      join(root, 'ㄱ/1.txt'), join(root, 'ㄴ/2.txt'), join(root, '비밀/secret.key.txt'),
    ];
    const r = await 부르기(root, '텍스트 파일', { mdfind: 색인 });
    const 전부글자 = JSON.stringify(r);
    assert.ok(!전부글자.includes('secret.key'),
      `**보호 파일이 세기로 새어 나왔다**: ${전부글자.slice(0, 400)}`);
    assert.equal(r.result?.formatTotal, 2,
      `보호 파일이 전수에 섞였다: ${r.result?.formatTotal}`);
    assert.ok(!(r.result?.formatByPlace ?? []).some((p) => p.path.includes('비밀')),
      `보호 자리가 분포에 섰다: ${JSON.stringify(r.result?.formatByPlace)}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('⑧ 한글 이름을 두 번 세지 않는다 — 디스크는 NFD, 색인은 NFC 로 같은 파일을 말한다', async () => {
  // **실물 홈에서 잡은 것**(2026-08-12, 이 수리의 첫 라이브):
  //   `엑셀 파일` → *"모두 **2개**예요 — /Users/jyp/GPAO-T5/2026-08 정산(1개) ·
  //   /Users/jyp/GPAO-T5/2026-08 정산(1개)"* — 같은 자리가 두 줄, 실제 파일은 하나다.
  //   `pdf 파일` 도 170 이 나왔는데 사용자 자리 실측은 133 이었다(170 - 37 = 133 —
  //   「색인이 못 봤다」던 37개가 전부 **같은 파일의 다른 표기**였다).
  // 걸음(`readdir`)은 NFD 로, 색인(`mdfind`)은 NFC 로 같은 이름을 돌려준다. `Set` 은 그 둘을
  // 다른 문자열로 본다 — **없는 파일을 세고, 없는 자리를 만들고, 색인이 놓쳤다고 거짓말한다.**
  //
  // 이 파일은 같은 매듭을 이미 두 번 풀었다(`local-locate.js:286` 볼륨 이름 · `낱말()` 의 NFC).
  // 세는 자에서 세 번째 얼굴로 돌아온 것이다.
  // **디스크에는 NFD 로 적는다** — 실물 홈이 그 상태다(APFS 는 적은 그대로 돌려준다).
  // 그래야 `readdir` 이 NFD 를, 색인이 NFC 를 주는 라이브 조건이 그대로 선다.
  const root = await 방(['정산/2026-08 정산표.xlsx'.normalize('NFD')]);
  try {
    const 파일 = join(root, '정산/2026-08 정산표.xlsx');
    // 색인은 NFC 로 말하고, 걸음은 디스크가 준 대로(NFD) 말한다.
    const 색인 = async () => [파일.normalize('NFC')];
    const r = await 부르기(root, '엑셀 파일', { mdfind: 색인 });
    assert.equal(r.result?.formatTotal, 1,
      `**같은 파일을 두 번 셌다**: ${r.result?.formatTotal} · ${JSON.stringify(r.result?.formatByPlace)}`);
    assert.equal(r.result?.formatPlaceCount, 1,
      `같은 자리가 둘로 갈렸다: ${JSON.stringify(r.result?.formatByPlace)}`);
    assert.ok(!r.result?.indexMissed,
      `**색인이 놓쳤다고 거짓말한다**(표기만 다른 같은 파일이다): indexMissed=${r.result?.indexMissed}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('⑦ 사용자가 뜻하지 않은 자리(Library)를 뺐으면 **뺐다고 말한다**', async () => {
  const root = await 방(['ㄱ/1.pdf']);
  try {
    // 실물 홈 실측: `com.adobe.pdf` 홈 전체 511 중 **378이 ~/Library**(앱 캐시).
    // 조용히 빼면 그게 §12-J6 위반이다 — 뺀 사실이 답에 남아야 한다.
    const 색인 = async () => [
      join(root, 'ㄱ/1.pdf'),
      join(root, 'Library/Caches/앱캐시.pdf'),
      join(root, 'Library/Containers/딴것.pdf'),
    ];
    const r = await 부르기(root, 'pdf 파일', { mdfind: 색인 });
    assert.equal(r.result?.formatTotal, 1,
      `**Library 를 사용자 자료로 셌다**: ${r.result?.formatTotal}`);
    assert.equal(r.result?.excludedSystemPlaces, 2,
      `뺀 개수를 안 남긴다: excludedSystemPlaces=${r.result?.excludedSystemPlaces}`);
    assert.match(String(r.userSafeSummary), /Library|앱이 쓰는/,
      `**조용히 뺐다** — 뺀 사실이 사람 문장에 없다: ${r.userSafeSummary}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});
