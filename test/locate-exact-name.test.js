// **커널은 "이름이 맞다"를 확신할 수 있을 때만 말한다.**
//
// 라이브 사고(오너 2026-08-05): `내 컴퓨터에서 지침.md 파일 찾아서 읽어줘` 에
// T5 가 **《Mixtral 8x7B 최적화형 존재 프롬프트 설계 지침》.md** 를 열어 요약했다.
// 그 화면 아래에는 같은 턴의 다른 사실이 함께 떴다 — *"지침.md 에 딱 맞는 자리는 못 찾았어요."*
// **한 답에 두 진실이 나갔다.** 그리고 진짜 `지침.md` 는 `~/GPAO-T5/지침.md` 에 있었다.
//
// ── 매듭은 판정 한 줄이다 ──────────────────────────────────────────────────
//   function 이름이맞나(name, 낱말들) { return 낱말들.some((w) => 이름.includes(w)); }
// **포함이면 "이름이 맞아요 · confidence:high"** 였다. 정확 일치와 부분 포함이 같은 답을 받는다.
//
// 이 파일 53~54 줄에 같은 병의 앞선 기록이 있다:
//   *"`YOON.md` 를 찾자 `md` 로 모든 `.md` 파일이 `이름이 맞아요 · high` 로 돌아갔다.
//     `계약서.pdf` 도 같다 — 모든 PDF 가 '이름이 맞아요'가 된다.
//     **커널이 프로세스에게 거짓말한 것이다.**"*
// S3 는 그때 **입력 쪽**(확장자를 낱말로 만들지 않기)만 고쳤다. **판정 쪽은 그대로**라
// 같은 매듭이 두 번째 얼굴로 돌아왔다. 여기서 판정을 고친다.
//
// §10 규율 12 — 개수가 아니라 **계약**을 잰다:
//   "정확 일치를 앞세운다"(순서) ❌
//   → **"확신을 지어내지 않는다 · 정확한 것이 있으면 그렇게 말한다 ·
//      없으면 후보라고 말하고 빈손으로 끝내지 않는다"**(계약) ⭕
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalLocateTool } from '../src/runtime/local-locate.js';

/** 라이브 사고를 그대로 세운 무대 — 정확한 것 하나, 낱말만 포함한 것 하나. */
async function 무대() {
  const 홈 = await mkdtemp(join(tmpdir(), 't5-locate-'));
  await mkdir(join(홈, 'GPAO-T5'), { recursive: true });
  await mkdir(join(홈, 'Documents', '보관'), { recursive: true });
  // **이름이 그대로 든 폴더.** 라이브에서 올라온 폴더들(`Developer` 등)은 성격 후보였지
  // 이름 후보가 아니었다 — 처음엔 그걸 착각해 안 잰 문제에 방어를 붙였고, 돌연변이 스윕이
  // 그 방어가 무방비라고 알려 줬다(2026-08-05). 그래서 **실제로 무는 판**으로 바꾼다.
  await mkdir(join(홈, 'Documents', '지침'), { recursive: true });
  await writeFile(join(홈, 'GPAO-T5', '지침.md'), '# 진짜\n', 'utf8');
  await writeFile(join(홈, 'Documents', '보관', '《Mixtral 최적화형 존재 프롬프트 설계 지침》.md'), '# 다른 것\n', 'utf8');
  await writeFile(join(홈, 'Documents', '계약서.pdf'), 'x', 'utf8');
  await writeFile(join(홈, 'Documents', '메모.md'), 'x', 'utf8');
  return 홈;
}

const 찾기 = async (홈, what, from = '') => {
  const t = makeLocalLocateTool({ home: 홈 });
  return t.handler({ what, from, depth: 5 });
};
const 후보들 = (r) => r?.result?.candidates ?? [];
const 이름맞음 = (r) => 후보들(r).filter((c) => String(c.why ?? '').includes('이름이 맞아요'));

test('① **낱말만 포함한 것을 "이름이 맞아요"라고 하지 않는다** — 커널이 거짓말하지 않는다', async () => {
  const 홈 = await 무대();
  const r = await 찾기(홈, '지침.md');
  const 거짓말 = 이름맞음(r).filter((c) => !String(c.path).endsWith('/지침.md'));
  assert.deepEqual(거짓말.map((c) => c.path), [],
    '**이름이 안 맞는 것에 "이름이 맞아요"가 붙었다.**\n'
    + `  ${거짓말.map((c) => `${c.path} → ${c.why} (${c.confidence})`).join('\n  ')}\n`
    + '`지침` 이라는 낱말이 든 모든 파일이 "그 파일"이 된다 — 이 파일 53줄이 적어 둔 그 거짓말이다.');
});

test('② **정확히 그 이름인 것이 있으면 그렇게 말한다** — 후보 다섯으로 뭉개지 않는다', async () => {
  const 홈 = await 무대();
  const r = await 찾기(홈, '지침.md');
  const 정확 = 후보들(r).filter((c) => String(c.path).endsWith('/지침.md'));
  assert.equal(정확.length, 1, `정확히 이름이 맞는 것을 못 찾았다: ${JSON.stringify(후보들(r).map((c) => c.path))}`);
  assert.equal(정확[0].confidence, 'high', '정확히 맞는 것에 확신을 안 줬다');
  assert.match(r.userSafeSummary ?? '', /지침\.md/,
    `**정확한 답을 갖고도 "N곳이 후보예요"로 뭉갰다.**\n`
    + `  말한 것: ${r.userSafeSummary}\n`
    + '모델은 후보 목록을 받으면 그중 하나를 골라야 하고, 그때 엉뚱한 것을 고른다(라이브 사고 그대로).');
});

test('③ **파일 이름을 물었으면 폴더를 "이름이 맞음"으로 올리지 않는다**', async () => {
  const 홈 = await 무대();
  const r = await 찾기(홈, '지침.md');
  const 폴더 = 이름맞음(r).filter((c) => c.kind !== 'file');
  assert.deepEqual(폴더.map((c) => c.path), [],
    `**\`.md\` 파일을 물었는데 폴더가 "이름이 맞아요"로 올라왔다**: ${JSON.stringify(폴더.map((c) => c.path))}`);
});

test('④ **정확한 것이 없으면 후보라고 말하고 빈손으로 끝내지 않는다**', async () => {
  const 홈 = await 무대();
  const r = await 찾기(홈, '설계 지침');   // 정확히 이 이름인 파일은 없다
  assert.ok(후보들(r).length > 0,
    '낱말이 든 것이 실제로 있는데 아무 후보도 안 줬다 — 막다른 답 금지');
  assert.doesNotMatch(r.userSafeSummary ?? '', /정확히 맞아요/,
    `정확한 것이 없는데 정확하다고 말했다: ${r.userSafeSummary}`);
  // (후보 목록 자체가 다음 길이다 — `nextSafeAction` 까지 요구한 것은 내 전제가 과했다.)
});

// ── ⑤ S3 회귀 보호 ────────────────────────────────────────────────────────
// 확장자만으로는 여전히 안 맞는다. 그때 고친 것을 이번 수정이 되돌리면 안 된다.
test('⑤ **확장자만 같은 것은 "이름이 맞아요"가 아니다**(S3 회귀 보호)', async () => {
  const 홈 = await 무대();
  const r = await 찾기(홈, '지침.md');
  const 메모 = 이름맞음(r).filter((c) => String(c.path).endsWith('메모.md'));
  assert.deepEqual(메모, [], '`.md` 라는 이유로 무관한 파일이 "이름이 맞아요"가 됐다 — S3 로 고친 자리다');
});

test('⑥ **낱말로 부른 요청은 그대로 넓게 찾는다** — 정확 일치 강화가 평소 찾기를 좁히지 않는다', async () => {
  const 홈 = await 무대();
  const r = await 찾기(홈, '계약서');
  assert.ok(후보들(r).some((c) => String(c.path).endsWith('계약서.pdf')),
    `이름 일부로 부른 평범한 요청이 안 걸렸다 — 좁히기가 지나쳤다: ${JSON.stringify(후보들(r).map((c) => c.path))}`);
});
