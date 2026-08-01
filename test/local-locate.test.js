// P6-W2 · 작업 대상 찾기 — **사용자는 경로를 말하지 않는다.**
//
// 이 파일의 검사는 전부 **가짜 홈**에서 돈다. 내 컴퓨터의 경로를 하나라도 박으면
// 그 자리에서 깨진다 — 그게 "특정 사용자 경로 하드코딩 금지"를 문장이 아니라
// 구조로 지키는 방법이다. T5 는 윤의 개발 보조기가 아니라 일반 사용자의 AI OS 다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalLocateTool } from '../src/runtime/local-locate.js';

/** 일반 사용자의 홈. 코드 프로젝트는 다섯 중 하나뿐이다 — 그게 실제 비율에 가깝다. */
async function 가짜홈() {
  const home = await mkdtemp(join(tmpdir(), 'gpao-t5-홈-'));
  const 심기 = async (p, files) => {
    await mkdir(join(home, p), { recursive: true });
    for (const f of files) await writeFile(join(home, p, f), 'x');
  };
  await 심기('회계/2026-1분기-정산', ['매출.xlsx', '매입.xlsx', '정산표.xlsx', '증빙.pdf']);
  await 심기('거래처/계약서', ['부오상회-계약.pdf', '한빛-계약.pdf', '표준약관.docx']);
  await 심기('블로그/원고', ['1월.md', '2월.md', '3월.md', '4월.md']);
  await 심기('디자인/시안', ['메인.png', '서브.png', '배너.psd', '로고.ai']);
  await 심기('work/api-server', ['package.json', 'index.js', 'server.js', 'util.js']);
  await 심기('Downloads', ['잡동사니.zip']);
  return home;
}
const 찾기 = async (home, what, extra = {}) =>
  (await makeLocalLocateTool({ home }).handler({ what, ...extra })).result.candidates;

test('업무 자료를 이름으로 찾는다 — 코드 프로젝트가 아니어도', async () => {
  const home = await 가짜홈();
  for (const [말, 기대] of [['정산 자료 봐줘', '정산'], ['계약서 찾아줘', '계약서'], ['원고 어디 있지', '원고'], ['시안 보여줘', '시안']]) {
    const [으뜸] = await 찾기(home, 말);
    assert.equal(으뜸.confidence, 'high', `${말}: 확신 못 함 — ${으뜸?.path}`);
    assert.match(으뜸.path, new RegExp(기대), `${말} → ${으뜸.path}`);
  }
});

test('코드 프로젝트도 찾는다("이 프로젝트")', async () => {
  const [으뜸] = await 찾기(await 가짜홈(), '이 프로젝트 테스트 돌려봐');
  assert.match(으뜸.path, /api-server/);
  assert.equal(으뜸.kind, 'project');
});

test('후보마다 근거·종류·확신도·수정 시각이 함께 온다', async () => {
  const [c] = await 찾기(await 가짜홈(), '정산');
  assert.match(c.why, /이름이 맞아요/, '왜 후보인지 없으면 사용자가 고를 수 없다');
  assert.match(c.why, /문서 \d+개/);
  assert.equal(c.kindLabel, '문서·자료');
  assert.ok(['high', 'medium', 'low'].includes(c.confidence));
  assert.equal(typeof c.modifiedDaysAgo, 'number');
});

test('후보는 몇 개만 준다 — 긴 목록을 모델에 넣지 않는다', async () => {
  const 후보 = await 찾기(await 가짜홈(), '자료');
  assert.ok(후보.length <= 5, `후보가 너무 많다(${후보.length})`);
  assert.ok(JSON.stringify(후보).length < 2000, '후보 블록이 프롬프트를 삼킨다');
});

// ── 못 찾은 것을 찾은 척하지 않는다 ─────────────────────────────────────
test('없는 것을 물으면 못 찾았다고 말하고 다음 길을 준다', async () => {
  const home = await 가짜홈();
  const r = await makeLocalLocateTool({ home }).handler({ what: '세무서 제출용 홍보영상' });
  assert.match(r.userSafeSummary, /못 찾았어요/, '무관한 후보를 늘어놓으면 "찾았다"는 오해가 된다');
  assert.ok(r.nextSafeAction, '막다른 답 금지');
  assert.ok(r.result.candidates.length <= 2, '못 찾았는데 지면을 채우지 않는다');
});

test('못 찾으면 더 넓게 볼 수 있다는 사실을 준다(모델이 다시 부른다)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'gpao-t5-빈홈-'));
  // 사람들은 자료를 깊이 넣어 둔다 — 홈/일/2026/회계/정산 처럼.
  await mkdir(join(home, '일/2026/회계/정산'), { recursive: true });
  await writeFile(join(home, '일/2026/회계/정산/매출.xlsx'), 'x');
  await writeFile(join(home, '일/2026/회계/정산/증빙.pdf'), 'x');

  const 얕게 = await makeLocalLocateTool({ home }).handler({ what: '정산', depth: 2 });
  assert.equal(얕게.result.candidates.length, 0);
  assert.equal(얕게.result.canWiden, true, '넓힐 수 있다는 걸 안 주면 모델이 포기한다');
  // 모델이 그 사실을 보고 다시 부른다.
  const 깊게 = await makeLocalLocateTool({ home }).handler({ what: '정산', depth: 얕게.result.suggestDepth });
  assert.match(깊게.result.candidates[0].path, /정산/, `넓혀도 못 찾았다: ${JSON.stringify(깊게.result.candidates)}`);
});

// ── 안전 ────────────────────────────────────────────────────────────────
test('숨은 폴더는 후보로 올리지 않는다', async () => {
  const home = await 가짜홈();
  await mkdir(join(home, '.ssh'), { recursive: true });
  await writeFile(join(home, '.ssh/id_rsa'), 'PRIVATE KEY');
  const 후보 = await 찾기(home, 'ssh 키');
  assert.ok(!후보.some((c) => c.path.includes('.ssh')));
});

test('비밀 자리는 **보호 판정**으로도 걸러진다(닷폴더가 아니어도)', async () => {
  // 앞 검사는 닷폴더 필터에 걸려서 통과한다 — 보호 판정을 통째로 빼도 초록이 뜬다
  // (반대 검증에서 드러났다). 실제 보호 영역 이름으로 판정 자체를 확인한다.
  const { protectionFor } = await import('../src/runtime/local-protection.js');
  const { homedir } = await import('node:os');
  for (const p of ['Library/Keychains', 'Library/Application Support/Google/Chrome']) {
    assert.ok(protectionFor(join(homedir(), p)), `보호 판정이 ${p} 를 놓친다`);
  }
  // 그리고 locate 가 그 판정을 실제로 쓰는지 — 홈을 그대로 훑어 보호 자리가 안 나오는지 본다.
  const r = await makeLocalLocateTool({ home: homedir() }).handler({ what: 'keychain', depth: 2 });
  assert.ok(!(r.result.candidates ?? []).some((c) => protectionFor(c.path)),
    '보호 영역이 후보로 나왔다 — 보여주면 그리로 가게 된다');
});

test('도구가 만든 더미는 후보를 오염시키지 않는다', async () => {
  const home = await 가짜홈();
  await mkdir(join(home, 'work/api-server/node_modules/정산-lib'), { recursive: true });
  await writeFile(join(home, 'work/api-server/node_modules/정산-lib/정산.xlsx'), 'x');
  const 후보 = await 찾기(home, '정산');
  assert.ok(!후보.some((c) => c.path.includes('node_modules')));
});

test('찾아본 범위를 남긴다("없다"와 "여기까진 봤다"는 다른 말이다)', async () => {
  const home = await 가짜홈();
  const r = await makeLocalLocateTool({ home }).handler({ what: '정산' });
  assert.equal(r.result.searched.from, home);
  assert.equal(r.result.searched.depth, 3);
  assert.ok(r.result.searched.folders > 0);
});

// ── 못 찾았을 때 경로를 복사해 오라고 하지 않는다 ────────────────────────
// 실측(라이브): "폴더를 어떻게 알려주면 돼?"에 T5 가 "Finder 우클릭 → Option → 경로명 복사
// → 붙여넣기"라고 답했다. 터미널 떠넘김의 GUI 판이다. 사용자는 경로를 모르고 알 필요도 없다 —
// **부르는 이름으로 고를 수 있어야 한다**("외장하드요", "다운로드요").
test('못 찾으면 볼 수 있는 자리를 이름으로 준다', async () => {
  const home = await mkdtemp(join(tmpdir(), 'gpao-t5-자리-'));
  const vol = await mkdtemp(join(tmpdir(), 'gpao-t5-볼륨-'));
  for (const d of ['Documents', 'Downloads', '회계']) await mkdir(join(home, d), { recursive: true });
  for (const d of ['백업디스크', '작업용SSD']) await mkdir(join(vol, d), { recursive: true });

  const r = await makeLocalLocateTool({ home, volumesDir: vol }).handler({ what: '외장하드에 있는 정산 자료' });
  const 자리 = r.result.placesToLook ?? [];
  assert.ok(자리.length > 0, '어디를 볼 수 있는지 안 주면 모델이 경로를 복사해 오라고 시킨다');
  assert.ok(자리.some((p) => p.label === '백업디스크' && p.kind === 'volume'), '연결된 디스크를 이름으로 보여줘야 한다');
  assert.ok(자리.some((p) => p.label === 'Downloads' && p.kind === 'folder'));
  // 사용자가 이름을 고르면 그 자리에서 다시 찾는다 — 경로를 물어보지 않는다.
  assert.ok(자리.every((p) => p.path && p.label), '이름과 자리가 짝지어져 있어야 골라서 이어갈 수 있다');
  assert.doesNotMatch(r.nextSafeAction, /경로|복사|붙여/, '경로를 복사해 오라고 하면 안 된다');
});

// ── 이름으로 고른 자리가 실제로 그 자리에서 찾아진다 ──────────────────────
//
// W3 의 계약은 여기서 닫힌다. 라이브 실측(a36d4627·f735d724, 2026-07-27):
// 사용자가 "작업용SSD"라고 답하자 모델은 `local.locate{ from: "작업용SSD" }` 를 골랐다.
// **모델은 옳게 골랐다.** 런타임이 그 이름을 폴더 경로로 그대로 쓰는 바람에 `folders: 0`
// 으로 끝났고, 실제 성공은 모델이 셸(`find`·`ls`·heredoc)로 우회해서 만들었다.
//
// 모델이 이름을 넘기는 건 **우리가 이름만 줬기 때문이다** — 화면에 나가는 "볼 수 있는 자리"는
// 프롬프트를 아끼려고 label 만 싣는다. 그러면 경로를 승계하는 건 런타임의 일이다.
// (§24 · 「모델이 고른 인자로 실행한다」)
async function 이름으로고르는판() {
  const home = await mkdtemp(join(tmpdir(), 'gpao-t5-이름-'));
  const vol = await mkdtemp(join(tmpdir(), 'gpao-t5-볼륨-'));
  for (const d of ['Documents', 'Downloads']) await mkdir(join(home, d), { recursive: true });
  await mkdir(join(vol, '작업용SSD', '2026 정산자료'), { recursive: true });
  for (const f of ['1분기-매입.xlsx', '1분기-매출.xlsx', '증빙.pdf', '부가세.pdf']) {
    await writeFile(join(vol, '작업용SSD', '2026 정산자료', f), 'x');
  }
  return { home, vol, tool: makeLocalLocateTool({ home, volumesDir: vol }) };
}

test('자리를 이름으로 고르면 그 자리에서 찾는다(경로를 몰라도 된다)', async () => {
  const { tool } = await 이름으로고르는판();
  // 사용자가 "작업용SSD"라고 답했을 때 모델이 고르는 바로 그 인자.
  const r = await tool.handler({ what: '정산 자료', from: '작업용SSD' });
  assert.ok(r.result.searched.folders > 0,
    `이름을 자리로 못 바꿔서 아무 데도 안 봤다 — searched=${JSON.stringify(r.result.searched)}`);
  const [으뜸] = r.result.candidates;
  assert.ok(으뜸, `"작업용SSD" 안의 정산 자료를 못 찾았다 — ${r.userSafeSummary}`);
  assert.match(으뜸.path, /작업용SSD.*정산/, `엉뚱한 자리를 짚었다: ${으뜸.path}`);
  assert.equal(으뜸.confidence, 'high');
});

test('이름을 자리로 바꿨다는 사실이 원장에 남는다(무엇을 어디로 읽었는지)', async () => {
  const { vol, tool } = await 이름으로고르는판();
  const r = await tool.handler({ what: '정산 자료', from: '작업용SSD' });
  assert.equal(r.result.searched.from, join(vol, '작업용SSD'), '실제로 본 자리가 원장에 안 남는다');
  assert.equal(r.result.searched.fromName, '작업용SSD', '어느 이름을 자리로 읽었는지 안 남으면 나중에 못 따진다');
});

test('없는 이름은 조용히 홈으로 떨어지지 않는다(엉뚱한 자리를 뒤진 걸 "못 찾았다"로 말하지 않는다)', async () => {
  const { home, tool } = await 이름으로고르는판();
  const r = await tool.handler({ what: '정산 자료', from: '없는외장하드' });
  assert.notEqual(r.result.searched.from, home,
    '모르는 이름을 홈으로 바꿔치기하면, 홈을 뒤진 결과를 그 자리 결과인 척 말하게 된다');
  assert.equal(r.result.candidates.length, 0);
  assert.match(r.userSafeSummary, /없는외장하드/, '어느 이름이 안 보이는지 말해야 사용자가 고쳐 부른다');
  assert.ok((r.result.placesToLook ?? []).length > 0, '대신 볼 수 있는 자리를 줘야 이어갈 수 있다');
  assert.doesNotMatch(r.nextSafeAction ?? '', /경로|복사|붙여/);
});

// 라이브 실측(369d8d0d, 2026-07-27): 볼륨이 **붙어 있는데도** "작업용SSD라는 자리는 지금
// 안 보여요"라고 답했다. 모델이 원인을 정확히 짚었다 — "글자는 같아 보이는데 내부 표기가 달라서".
// macOS 는 마운트된 볼륨 이름을 **NFD(자모 분해)** 로 돌려주고, 모델은 **NFC** 로 보낸다.
// 눈에 같은 글자가 `===` 로는 다르다. 한글 이름의 외장 디스크는 전부 여기서 죽는다.
test('한글 자리 이름은 표기가 달라도 같은 자리로 읽는다(NFC/NFD)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'gpao-t5-정규화-'));
  const vol = await mkdtemp(join(tmpdir(), 'gpao-t5-볼륨-'));
  // 디스크에는 macOS 가 돌려주는 그 모양(NFD)으로 만든다.
  const 분해된 = '작업용SSD'.normalize('NFD');
  await mkdir(join(vol, 분해된, '2026 정산자료'), { recursive: true });
  for (const f of ['매입.xlsx', '매출.xlsx', '증빙.pdf']) {
    await writeFile(join(vol, 분해된, '2026 정산자료', f), 'x');
  }
  const tool = makeLocalLocateTool({ home, volumesDir: vol });
  // 모델은 사용자가 친 그대로(NFC) 보낸다.
  const r = await tool.handler({ what: '정산 자료', from: '작업용SSD'.normalize('NFC') });
  assert.equal(r.result.unknownPlace, undefined,
    `붙어 있는 자리를 "안 보인다"고 했다 — ${r.userSafeSummary}`);
  assert.ok(r.result.candidates.length > 0, `그 자리에서 못 찾았다 — ${r.userSafeSummary}`);
});

test('진짜 경로를 주면 그대로 쓴다(이름 승계가 경로를 가로채지 않는다)', async () => {
  const { vol, tool } = await 이름으로고르는판();
  const r = await tool.handler({ what: '정산 자료', from: join(vol, '작업용SSD') });
  assert.equal(r.result.searched.from, join(vol, '작업용SSD'));
  assert.equal(r.result.searched.fromName, undefined, '경로를 준 것을 이름으로 읽었다고 하면 거짓이다');
  assert.ok(r.result.candidates.length > 0);
});

// ── H08 · 파일도 후보다 ──────────────────────────────────────────────────
// "다운로드 폴더에 방금 받은 견적서" — 사용자가 찾는 건 폴더가 아니라 파일이다.
// 폴더만 후보로 올리면 이 문장은 영영 못 끝난다(인간 기준선 실패 3/3 의 뿌리 ②).
test('이름이 맞는 파일은 파일로 후보에 오른다 — 폴더만 찾으면 견적서를 못 찾는다', async () => {
  const home = await mkdtemp(join(tmpdir(), 'gpao-t5-파일후보-'));
  await mkdir(join(home, 'Downloads'), { recursive: true });
  await writeFile(join(home, 'Downloads', '견적서-보일러.pdf'), 'x');
  await writeFile(join(home, 'Downloads', '무관한것.zip'), 'x');

  const 후보 = await 찾기(home, '견적서 찾아줘');
  const 파일 = 후보.find((c) => c.kind === 'file');
  assert.ok(파일, `파일이 후보에 없다 — ${JSON.stringify(후보.map((c) => [c.kind, c.path]))}`);
  assert.match(파일.path, /견적서-보일러\.pdf$/);
  assert.equal(파일.confidence, 'high');
  assert.ok(!후보.some((c) => c.path.endsWith('무관한것.zip')), '이름이 안 맞는 파일까지 올리면 소음이다');
});

test('비밀 이름 파일은 파일 후보로도 안 오른다 — 파일 포함이 보호를 뚫지 않는다', async () => {
  const home = await mkdtemp(join(tmpdir(), 'gpao-t5-비밀파일-'));
  await mkdir(join(home, 'Downloads'), { recursive: true });
  await writeFile(join(home, 'Downloads', 'api-token.txt'), 'sk-메아리');

  const 후보 = await 찾기(home, 'token 정리');
  assert.ok(!후보.some((c) => c.path.includes('token')), '비밀 이름 파일이 후보로 나왔다 — 보여주면 그리로 가게 된다');
});

test('찾았을 때는 자리 목록으로 지면을 채우지 않는다', async () => {
  const [c] = await 찾기(await 가짜홈(), '정산');
  assert.ok(c, '찾았어야 한다');
  const r = await makeLocalLocateTool({ home: await 가짜홈() }).handler({ what: '정산' });
  assert.equal(r.result.placesToLook, undefined, '이미 찾았는데 다른 자리를 늘어놓으면 헷갈린다');
});
