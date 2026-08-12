// F-86 · **이름이 형식을 약속하면 실물이 그 형식이어야 한다.**
//
// 밟은 라이브(콘솔 2026-08-12 · 2회차): *"8월지출.csv 를 항목별로 합계 내서 같은 폴더에
// 엑셀로 만들어줘."* → 합계 셋은 맞았고 답은 *"엑셀 파일 열어보세요"* 였는데 실물은:
//     stat 462 바이트 · file "Unicode text, UTF-8" · xxd 앞 4바이트 `3c 77 6f 72` = "<wor"
//     unzip -l → 아카이브 아님 · 내용은 `<worksheet …><sheetData><row r="1">…`
//     mdls kMDItemContentType = org.openxmlformats.spreadsheetml.sheet   ← Spotlight 도 속았다
// 즉 `xl/worksheets/sheet1.xml` **한 조각**을 그대로 `.xlsx` 이름으로 저장했다. 안 열린다.
//
// 자는 이미 있었다 — `documentSignatureMatches`(document-intake.js:170)가 **읽는 문에만**
// 서 있었다. 이 검사는 그 자를 **쓰는 문**에도 세우고(가), 표 하나짜리 엑셀은 정말로
// 만들어 준다(나). 판정은 전부 **독립 기준자**로 한다 — 우리 코드가 "됐다"고 말하는 것이
// 아니라 `/usr/bin/unzip` 과 원시 바이트가 말하게 한다(밟은 그 자리의 교훈).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { extractDocument } from '../src/runtime/document-intake.js';

const exec = promisify(execFile);

async function 판() {
  const root = await mkdtemp(join(tmpdir(), 'gpao-t5-f86-'));
  return { root, tool: makeLocalFileTool({ roots: [root], dataDir: root }) };
}

/** 밟은 그 462바이트 — 모델이 실제로 저장했던 sheet1.xml 조각과 같은 모양. */
const 시트조각 = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
  + '<row r="1"><c r="A1" t="inlineStr"><is><t>항목</t></is></c>'
  + '<c r="B1" t="inlineStr"><is><t>합계</t></is></c></row>'
  + '<row r="2"><c r="A2" t="inlineStr"><is><t>자재비</t></is></c><c r="B2"><v>208000</v></c></row>'
  + '</sheetData></worksheet>';

const 앞4 = (bytes) => [...bytes.subarray(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join(' ');

// ── ① 밟은 그 자리 ────────────────────────────────────────────────────────
test('① XML 조각을 .xlsx 이름으로 쓰면 성공이 아니다(밟은 462바이트 그대로)', async () => {
  const { root, tool } = await 판();
  const r = await tool.handler({ action: 'write', path: '8월지출_항목별합계.xlsx', text: 시트조각 });

  assert.equal(r.blocked, true, '이름만 엑셀인 파일을 성공으로 불렀다 — 사용자는 안 열리는 파일을 받는다');
  assert.equal(r.result, undefined, '막았는데 결과 칸이 있으면 답이 완료를 말한다');
  const 남은것 = (await readdir(root)).filter((n) => !n.startsWith('.'));
  assert.deepEqual(남은것, [], '막았다면서 실물은 만들었다 — 사용자 폴더에 안 열리는 파일이 남는다');
});

// ── ② 진짜 엑셀은 그대로 지나간다 ────────────────────────────────────────
test('② zip 서명으로 시작하는 내용은 .xlsx 로 그대로 저장된다(그물이 진짜를 막지 않는다)', async () => {
  const { root, tool } = await 판();
  // 손이 받는 것은 글자다 — zip 서명 네 바이트(50 4b 03 04)는 latin1 로 그대로 실린다.
  const 진짜처럼 = `${String.fromCharCode(0x50, 0x4b, 0x03, 0x04)}그 뒤는 무엇이든`;
  const r = await tool.handler({ action: 'write', path: '정산표.xlsx', text: 진짜처럼 });

  assert.equal(r.blocked, undefined, '서명이 맞는데 막았다 — 그물이 진짜까지 문다');
  assert.equal(앞4(await readFile(join(root, '정산표.xlsx'))), '50 4b 03 04');
});

// ── ③ 그물이 안 넓어졌다 ─────────────────────────────────────────────────
test('③ .txt·.md·.csv 쓰기는 예전 그대로다(정의역이 안 넓어졌다)', async () => {
  const { root, tool } = await 판();
  for (const [이름, 글] of [['메모.txt', '아무 글'], ['정리.md', '# 제목'], ['지출.csv', '항목,금액\n자재비,120000']]) {
    const r = await tool.handler({ action: 'write', path: 이름, text: 글 });
    assert.equal(r.blocked, undefined, `${이름} 을 막았다 — 형식 서명을 모르는 자리에 자를 세웠다`);
    assert.equal(await readFile(join(root, 이름), 'utf8'), 글, `${이름} 의 내용이 달라졌다`);
  }
});

test('④ 서명을 모르는 확장자(.zzz)는 안 문다(없는 자로 막지 않는다)', async () => {
  const { root, tool } = await 판();
  const r = await tool.handler({ action: 'write', path: '무엇인가.zzz', text: '<wor 로 시작해도 상관없다' });
  assert.equal(r.blocked, undefined, '아는 형식이 아닌데 막았다 — fail-open 이 옳은 유일한 자리다');
  assert.equal(await readFile(join(root, '무엇인가.zzz'), 'utf8'), '<wor 로 시작해도 상관없다');
});

// ── ⑤ 막다른 답 금지 ─────────────────────────────────────────────────────
test('⑤ 막을 때 무엇이 왜 아닌지(기대 서명 vs 실제 앞 4바이트)와 다음 수단이 함께 온다', async () => {
  const { tool } = await 판();
  const r = await tool.handler({ action: 'write', path: '합계.xlsx', text: 시트조각 });

  assert.equal(r.blocked, true);
  assert.ok(r.userSafeSummary.includes('50 4b'), `기대한 서명이 없다: ${r.userSafeSummary}`);
  assert.ok(r.userSafeSummary.includes('3c 77 6f 72'), `실제 앞 4바이트가 없다: ${r.userSafeSummary}`);
  assert.ok(r.nextSafeAction, '막다른 답 금지 — 사용자에게 다음 한 걸음이 있어야 한다');
  assert.ok(Array.isArray(r.다음수단) && r.다음수단.length, '모델이 그대로 부를 수 있는 다음 수가 없다');
  assert.ok(r.다음수단.some((수) => 수.방법 === 'local.file'), '다음 수가 지금 쥔 손을 가리키지 않는다');
});

test('⑤-b 만들 줄 모르는 형식(.pdf·.docx)은 정직하게 못 만든다고 말한다', async () => {
  const { root, tool } = await 판();
  for (const 이름 of ['보고서.pdf', '계약서.docx']) {
    const r = await tool.handler({ action: 'write', path: 이름, text: '그냥 글' });
    assert.equal(r.blocked, true, `${이름} 을 글자 그대로 저장했다 — 안 열리는 파일이다`);
    assert.ok(r.nextSafeAction, `${이름} 에 다음 걸음이 없다`);
    assert.ok(Array.isArray(r.다음수단) && r.다음수단.length, `${이름} 에 다음 수가 없다`);
  }
  assert.deepEqual((await readdir(root)).filter((n) => !n.startsWith('.')), []);
});

// ── ⑥ (나) 능력 — 표 본문을 주면 진짜 엑셀이 나온다 ─────────────────────
test('⑥ 표 본문을 .xlsx 로 저장하면 진짜 엑셀이 된다(독립 기준자: 앞 4바이트·unzip·되읽은 셀)', async () => {
  const { root, tool } = await 판();
  // 밟은 발화의 자료 그대로: 자재비 120000+88000=208000 · 운반비 45000 · 인건비 300000
  const 표 = '항목,합계\n자재비,208000\n운반비,45000\n인건비,300000';
  const r = await tool.handler({ action: 'write', path: '8월지출_항목별합계.xlsx', text: 표 });
  assert.equal(r.blocked, undefined, `표를 줬는데 막았다: ${r.userSafeSummary}`);

  const 실물 = join(root, '8월지출_항목별합계.xlsx');
  const bytes = await readFile(실물);
  // 기준자 1 — 원시 바이트. 밟은 회차는 `3c 77 6f 72` 였다.
  assert.equal(앞4(bytes), '50 4b 03 04', '이름만 엑셀이고 실물은 아니다');
  // 기준자 2 — 우리 코드가 아닌 /usr/bin/unzip 이 아카이브라고 말해야 한다.
  const { stdout } = await exec('/usr/bin/unzip', ['-Z1', 실물], { timeout: 15_000 });
  const 칸들 = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  for (const 필수 of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml']) {
    assert.ok(칸들.includes(필수), `엑셀 필수 부품이 없다: ${필수} (있는 것: ${칸들.join(' · ')})`);
  }
  // 기준자 3 — 읽는 문으로 되읽어 셀 값이 원본 합계와 같은지 본다.
  const 되읽음 = await extractDocument(실물, bytes);
  assert.equal(되읽음.error, undefined, `되읽지 못했다: ${되읽음.error}`);
  for (const 값 of ['항목', '자재비', '208000', '45000', '300000']) {
    assert.ok(되읽음.text.includes(값), `되읽은 표에 ${값} 이 없다:\n${되읽음.text}`);
  }
  // 숫자는 숫자 칸이어야 엑셀에서 합계가 된다(문자열이면 사용자가 다시 손봐야 한다).
  const 시트 = (await exec('/usr/bin/unzip', ['-p', 실물, 'xl/worksheets/sheet1.xml'], { timeout: 15_000 })).stdout;
  assert.ok(/<c r="B2"><v>208000<\/v><\/c>/.test(시트), `숫자가 숫자 칸이 아니다:\n${시트}`);
});

test('⑦ 조립 부스러기가 사용자 폴더에 하나도 안 남는다', async () => {
  const { root, tool } = await 판();
  await tool.handler({ action: 'write', path: '합계.xlsx', text: '항목,합계\n자재비,208000' });
  const 남은것 = (await readdir(root)).filter((n) => !n.startsWith('.'));
  // 1회차 라이브는 `[Content_Types].xml`·`_rels`·`xl`·`docProps` 를 오너 폴더에 그대로 풀었다.
  assert.deepEqual(남은것, ['합계.xlsx'], `완성품 말고 다른 것이 남았다: ${남은것.join(' · ')}`);
});

// ── 봉인이 원본을 죽이지 않는다 ──────────────────────────────────────────
test('막힌 덮어쓰기는 원본을 그대로 둔다(봉인이 사용자 파일을 잡아먹지 않는다)', async () => {
  const { root, tool } = await 판();
  const 원본 = join(root, '정산표.xlsx');
  const 원본바이트 = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('진짜 원본', 'utf8')]);
  await writeFile(원본, 원본바이트);

  const r = await tool.handler({ action: 'write', path: '정산표.xlsx', text: 시트조각 });
  assert.equal(r.blocked, true);
  assert.deepEqual(await readFile(원본), 원본바이트,
    '막으면서 원본을 휴지통으로 보냈다 — 사용자 파일이 사라진다');
});

test('만든 엑셀은 되돌릴 수 있다(카드가 약속한 것을 지킨다)', async () => {
  const { root, tool } = await 판();
  await tool.handler({ action: 'write', path: '합계.xlsx', text: '항목,합계\n자재비,208000' });
  const r = await tool.handler({ action: 'undo' });
  assert.equal(r.blocked, undefined, `되돌리지 못했다: ${r.userSafeSummary}`);
  assert.deepEqual((await readdir(root)).filter((n) => !n.startsWith('.')), []);
});

// ── ⑧ 라이브가 가르쳐 준 자리 — 부품을 사용자 폴더에 풀지 않는다 ─────────
//
// 콘솔 라이브 4/4(2026-08-12 · 내가 직접 돌렸다): 모델은 `.xlsx` 쓰기를 **한 번도 시도하지
// 않았다.** 대신 자기가 아는 방법 — xlsx 부품을 폴더에 풀고 `zip` 으로 묶기 — 으로 갔고,
// 묶는 손이 없어 매번 마지막 계단에서 끝났다. 사용자 폴더에 남은 것:
//     `.rels` · `[Content_Types].xml` · `sheet1.xml` · `workbook.xml` · `workbook.xml.rels`
// 그리고 답은 *"터미널에서 아래만 실행하면 돼요"* 로 사용자에게 zip 명령을 넘겼다(개발자 떠넘김).
//
// 부품 쓰기는 **내 손을 지나간다** — T5 가 "지금 모델이 엑셀을 손수 조립하는 중"임을 아는
// 유일한 지점이다. 그 자리에서 막고 완성품으로 가는 길을 준다. 판정은 이름이 아니라
// **내용**(OOXML 꾸러미 네임스페이스)으로 한다 — 이름은 근거가 아니라는 것이 이 매듭의 교훈이다.
test('⑧ 엑셀 부품을 사용자 폴더에 풀면 막고, 완성품을 만드는 길을 준다', async () => {
  const { root, tool } = await 판();
  const 부품 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>';
  const r = await tool.handler({ action: 'write', path: '[Content_Types].xml', text: 부품 });

  assert.equal(r.blocked, true, '부품이 사용자 폴더에 그대로 풀렸다 — 라이브 4/4 가 이 자리다');
  assert.ok(r.nextSafeAction, '막다른 답 금지');
  assert.ok(Array.isArray(r.다음수단) && r.다음수단.some((수) => 수.방법 === 'local.file'),
    '모델이 그대로 부를 수 있는 완성품 경로가 없다');
  assert.ok(JSON.stringify(r.다음수단).includes('.xlsx'), '다음 수가 엑셀 완성품을 가리키지 않는다');
  assert.deepEqual((await readdir(root)).filter((n) => !n.startsWith('.')), [], '막았다면서 부품은 남겼다');

  // **다음 수의 자리는 모델이 부를 수 있는 자리여야 한다.** 라이브 실측(2026-08-12)에서
  // 홈이 뿌리인 구성이 `jyp/GPAO-T5/…` 라는 반쪽 경로를 냈다 — 그대로 부르면 엉뚱한 자리다.
  const 절대 = await tool.handler({ action: 'write', path: `${root}/부품/[Content_Types].xml`, text: 부품 });
  assert.equal(절대.다음수단[0].path, `${root}/부품/결과.xlsx`,
    `다음 수의 자리가 모델이 보낸 표기와 다르다: ${절대.다음수단[0].path}`);
});

test('⑧-b 부품 판정은 이름이 아니라 내용으로 한다(그물이 평범한 xml 을 안 문다)', async () => {
  const { root, tool } = await 판();
  // 같은 이름인데 OOXML 꾸러미가 아니면 지나간다 — 없는 자로 막지 않는다.
  const r = await tool.handler({ action: 'write', path: 'workbook.xml', text: '<메모>그냥 내 xml</메모>' });
  assert.equal(r.blocked, undefined, '이름만 보고 막았다 — 사용자의 평범한 xml 을 잡아먹는다');
  assert.equal(await readFile(join(root, 'workbook.xml'), 'utf8'), '<메모>그냥 내 xml</메모>');
});
