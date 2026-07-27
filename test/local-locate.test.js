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
test('비밀 자리는 후보로도 안 올린다', async () => {
  const home = await 가짜홈();
  await mkdir(join(home, '.ssh'), { recursive: true });
  await writeFile(join(home, '.ssh/id_rsa'), 'PRIVATE KEY');
  const 후보 = await 찾기(home, 'ssh 키');
  assert.ok(!후보.some((c) => c.path.includes('.ssh')), '비밀 자리를 후보로 보여주면 그리로 가게 된다');
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
