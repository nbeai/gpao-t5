// H08 · "다운로드 폴더에 방금 받은 견적서 찾아서 최종본만 보기 좋게 정리해줘. 원본은 건드리지 마."
//
// 인간 기준선 실패 3/3 의 확정 뿌리 두 개를 반대시험으로 잠근다:
//   ① file-scope 허용 루트가 1개(~/GPAO-T5)뿐 — 다운로드 폴더가 처음부터 범위 밖이었다.
//   ② local-locate 가 폴더만 후보로 올려 파일(견적서.pdf)을 영영 못 찾았다.
// 그리고 판정 문장의 나머지 반:
//   · 최종본은 이름의 "최종/final"이 아니라 **수정 시각과 실제 내용**으로 판별한다.
//   · 원본은 절대 바꾸지 않는다 — 결과물은 별도 파일이다.
//   · 읽지 못한 것은 읽은 척하지 않는다(모름을 사실로 전달).
//
// fixture 는 전부 mkdtemp 다 — 실제 사용자 Downloads·Documents 는 읽지도 쓰지도 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, utimes, chmod } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { makeLocalLocateTool } from '../src/runtime/local-locate.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { defaultFileRoots, resolveInScope, ScopeError } from '../src/runtime/file-scope.js';

/** 파일 수정 시각을 며칠 전으로 돌린다 — 최종본 판별은 시각이 근거라 시각을 심어야 검사가 된다. */
async function 며칠전(path, 일) {
  const t = new Date(Date.now() - 일 * 86_400_000);
  await utimes(path, t, t);
}

// ── 뿌리 ① · 허용 루트 — 다운로드·문서·바탕화면이 범위에 들어온다 ─────────
test('기본 루트: 표준 사용자 폴더까지 열린다 — 루트 1개면 다운로드가 처음부터 범위 밖이다(H08 뿌리 ①)', () => {
  const roots = defaultFileRoots({});
  assert.ok(roots[0].endsWith('GPAO-T5'), '작업 루트가 첫째다(상대 경로·휴지통·새 파일의 기준)');
  for (const 이름 of ['Downloads', 'Documents', 'Desktop']) {
    assert.ok(roots.includes(join(homedir(), 이름)), `${이름} 이 범위에 없다 — "다운로드 폴더의 견적서"가 시작도 못 한다`);
  }
  assert.ok(!roots.includes(homedir()), '홈 전체를 기본으로 열지 않는다 — 넓힘은 표준 사용자 폴더까지만');
  assert.ok(roots.every((r) => r.startsWith(homedir())), '루트는 전부 사용자 홈 하위다');
});

test('여러 루트: 둘째 루트 안 절대 경로도 범위 안이고, 상대 경로는 여전히 첫 루트 기준이다', async () => {
  const 작업 = await mkdtemp(join(tmpdir(), 'gpao-t5-작업-'));
  const 다운로드 = await mkdtemp(join(tmpdir(), 'gpao-t5-받은-'));
  await writeFile(join(다운로드, '견적서.pdf'), '견적 내용');

  const 파일 = await resolveInScope(join(다운로드, '견적서.pdf'), { roots: [작업, 다운로드] });
  assert.ok(파일.endsWith('견적서.pdf'), '둘째 루트 안 파일이 범위 밖으로 오판된다');

  const { realpath } = await import('node:fs/promises');
  const 상대 = await resolveInScope('메모.md', { roots: [작업, 다운로드] });
  assert.ok(상대.startsWith(await realpath(작업)), '상대 경로의 기준은 첫 루트여야 한다');

  await assert.rejects(() => resolveInScope('/etc/hosts', { roots: [작업, 다운로드] }), (e) => e instanceof ScopeError);
});

// ── 뿌리 ② · locate 가 파일을 찾는다 ─────────────────────────────────────
async function 다운로드판() {
  const home = await mkdtemp(join(tmpdir(), 'gpao-t5-h08홈-'));
  const dl = join(home, 'Downloads');
  await mkdir(dl, { recursive: true });
  await writeFile(join(dl, '견적서-냉난방-v1.pdf'), '1차 견적');
  await writeFile(join(dl, '견적서-냉난방-v2.pdf'), '2차 견적 — 금액 수정');
  await writeFile(join(dl, '견적서-냉난방-최종.pdf'), '1차 견적');
  await writeFile(join(dl, '설치안내.hwp'), '안내문');
  await 며칠전(join(dl, '견적서-냉난방-v1.pdf'), 3);
  await 며칠전(join(dl, '견적서-냉난방-최종.pdf'), 2);
  return { home, dl };
}

test('다운로드의 견적서 **파일**이 후보로 나온다 — 폴더만 찾으면 영영 못 찾는다(H08 뿌리 ②)', async () => {
  const { home } = await 다운로드판();
  const r = await makeLocalLocateTool({ home }).handler({ what: '다운로드 폴더에 방금 받은 견적서 찾아서' });
  const 파일후보 = r.result.candidates.filter((c) => c.kind === 'file');
  assert.ok(파일후보.length >= 3, `견적서 파일이 후보에 없다 — ${JSON.stringify(r.result.candidates.map((c) => c.path))}`);
  assert.ok(파일후보.every((c) => /견적서/.test(c.path)), '이름이 안 맞는 파일이 후보에 섞였다');
  assert.equal(r.result.candidates[0].kind, 'file', '으뜸 후보가 파일이어야 한다 — 사용자가 찾는 건 폴더가 아니다');
  assert.equal(r.result.candidates[0].confidence, 'high');
  assert.ok(파일후보.every((c) => c.why), '근거 없는 후보는 사용자가 고를 수 없다');
});

test('"다운로드"라는 우리말 이름으로도 그 자리를 찾는다(사용자는 Downloads 라고 부르지 않는다)', async () => {
  const { home, dl } = await 다운로드판();
  const r = await makeLocalLocateTool({ home }).handler({ what: '견적서', from: '다운로드' });
  assert.equal(r.result.unknownPlace, undefined, `다운로드를 모르는 자리라고 했다 — ${r.userSafeSummary}`);
  assert.equal(r.result.searched.from, dl, '다운로드라는 부름이 Downloads 자리로 이어져야 한다');
  assert.ok(r.result.candidates.some((c) => c.kind === 'file'));
});

// ── 최종본 판별 — 이름이 아니라 수정 시각·실제 내용 ──────────────────────
const 판 = async () => {
  const root = await mkdtemp(join(tmpdir(), 'gpao-t5-최종-'));
  return { root, tool: makeLocalFileTool({ roots: [root], dataDir: root }) };
};

test('이름의 "최종"보다 더 최근이고 내용도 다른 파일이 있으면 — 추측하지 않고 사실을 말한다', async () => {
  const { root, tool } = await 판();
  await writeFile(join(root, '견적서-최종.pdf'), '옛 금액');
  await writeFile(join(root, '견적서-v2.pdf'), '새 금액');
  await 며칠전(join(root, '견적서-최종.pdf'), 2);

  const r = await tool.handler({ action: 'versions', path: '.', name: '견적서' });
  assert.equal(r.blocked, undefined, `판별 자체가 막혔다 — ${r.userSafeSummary}`);
  assert.equal(r.result.final, null, '이름만 보고 최종을 골랐다 — 수정 시각과 내용이 갈리면 고르면 안 된다');
  assert.equal(r.result.ambiguous, true);
  assert.match(r.userSafeSummary, /견적서-최종\.pdf/);
  assert.match(r.userSafeSummary, /견적서-v2\.pdf/);
  assert.ok(r.nextSafeAction, '모호하면 최소 질문으로 이어질 근거를 줘야 한다');
});

test('이름은 갈려도 내용이 같으면 같은 판이다 — 질문하지 않는다(자동성)', async () => {
  const { root, tool } = await 판();
  await writeFile(join(root, '견적서-최종.pdf'), '같은 금액');
  await writeFile(join(root, '견적서-v3.pdf'), '같은 금액');
  await 며칠전(join(root, '견적서-최종.pdf'), 2);

  const r = await tool.handler({ action: 'versions', path: '.', name: '견적서' });
  assert.ok(r.result.final, '내용이 같은데도 물어보면 승인으로 안전을 산 것이다');
  assert.equal(r.result.ambiguous, undefined);
  const 늦은것 = r.result.files.find((f) => f.name === '견적서-최종.pdf');
  assert.equal(늦은것.sameContentAs, '견적서-v3.pdf', '같은 내용이라는 사실이 남아야 한다');
});

test('최종 표시가 가장 최근이면 그것이 최종본이다(이름과 시각이 같은 답을 준다)', async () => {
  const { root, tool } = await 판();
  await writeFile(join(root, '견적서-v1.pdf'), '1차');
  await writeFile(join(root, '견적서-최종.pdf'), '확정');
  await 며칠전(join(root, '견적서-v1.pdf'), 3);

  const r = await tool.handler({ action: 'versions', path: '.', name: '견적서' });
  assert.equal(r.result.final?.name, '견적서-최종.pdf');
  assert.match(r.result.final.why, /최근/, '이름이 아니라 시각이 근거로 남아야 한다');
});

test('최종 표시가 없으면 수정 시각으로 본다', async () => {
  const { root, tool } = await 판();
  await writeFile(join(root, '견적서-v1.pdf'), '1차');
  await writeFile(join(root, '견적서-v2.pdf'), '2차');
  await 며칠전(join(root, '견적서-v1.pdf'), 3);

  const r = await tool.handler({ action: 'versions', path: '.', name: '견적서' });
  assert.equal(r.result.final?.name, '견적서-v2.pdf');
});

test('읽지 못한 파일은 읽은 척하지 않는다 — 비교하지 못했다는 사실이 남는다', async () => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return; // root 는 다 읽어버린다
  const { root, tool } = await 판();
  await writeFile(join(root, '견적서-최종.pdf'), '옛 것');
  await writeFile(join(root, '견적서-v2.pdf'), '새 것');
  await 며칠전(join(root, '견적서-최종.pdf'), 2);
  await chmod(join(root, '견적서-v2.pdf'), 0o000);

  const r = await tool.handler({ action: 'versions', path: '.', name: '견적서' });
  await chmod(join(root, '견적서-v2.pdf'), 0o644);
  const 못읽은 = r.result.files.find((f) => f.name === '견적서-v2.pdf');
  assert.equal(못읽은.contentUnread, true, '못 읽었다는 사실이 안 남으면 읽은 척이 된다');
  assert.equal(못읽은.sameContentAs, undefined, '안 읽고 내용이 같다/다르다를 말하면 안 된다');
  assert.equal(r.result.final, null, '내용을 못 본 채로 최종본을 확정하면 추측이다');
  assert.match(r.userSafeSummary, /읽지 못해|비교하지 못했/, '모름이 사실로 전달돼야 한다');
});

// ── 원본 보호 — 결과물은 별도 파일 ───────────────────────────────────────
test('원본 자리에 결과물을 쓰려 하면 막는다("원본은 건드리지 마"의 구조적 보증)', async () => {
  const { root, tool } = await 판();
  await writeFile(join(root, '견적서-최종.pdf'), '원본 그대로');

  const r = await tool.handler({ action: 'write', path: '견적서-최종.pdf', text: '정리한 내용', source: '견적서-최종.pdf' });
  assert.equal(r.blocked, true, '원본을 덮어썼다 — 휴지통이 있어도 원본을 건드린 것이다');
  assert.ok(r.nextSafeAction, '막다른 답 금지 — 별도 이름을 제안해야 한다');
  assert.equal(await readFile(join(root, '견적서-최종.pdf'), 'utf8'), '원본 그대로', '원본 바이트가 달라졌다');
});

test('결과물은 별도 파일로 — 원본은 그대로고, 안 건드렸다는 사실이 결과에 남는다', async () => {
  const { root, tool } = await 판();
  await writeFile(join(root, '견적서-최종.pdf'), '원본 그대로');

  const r = await tool.handler({ action: 'write', path: '견적서-정리본.md', text: '# 보기 좋게 정리', source: '견적서-최종.pdf' });
  assert.equal(r.blocked, undefined);
  assert.equal(r.result.originalUntouched, true, '원본을 안 건드렸다는 사실이 안 남으면 사용자에게 말할 수 없다');
  assert.equal(await readFile(join(root, '견적서-최종.pdf'), 'utf8'), '원본 그대로');
  assert.equal(await readFile(join(root, '견적서-정리본.md'), 'utf8'), '# 보기 좋게 정리');
});
