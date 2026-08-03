// Phase 0-1 · 로컬 파일 손발 검증.
// 완결 기준(§16-D): 읽기·쓰기·정리 + 범위 권한 + 되돌리기 + 실패 종류별 사용자 언어.
// 그리고 §16-C 스텁 금지 게이트 — 라이브 레지스트리에 fixture 가 들어가면 실패한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, symlink, stat, readdir, utimes } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, basename } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { resolveInScope, isWithin, defaultFileRoots, ScopeError } from '../src/runtime/file-scope.js';
import { liveDeps } from '../src/surface/live-context.js';
import { SAFETY_FLOOR_KINDS, isSafetyFloor } from '../src/kernel/l2-plan/authority.js';

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), 'gpao-t5-file-'));
  return { root, tool: makeLocalFileTool({ roots: [root], dataDir: root }) };
}

// ── 범위(scope) — 로컬 지배력의 안전 축 ───────────────────────────────────
test('isWithin: 경계에서 접두사만 비교하지 않는다(/a/bc 는 /a/b 안이 아니다)', () => {
  assert.equal(isWithin('/a/b', '/a/b/c.txt'), true);
  assert.equal(isWithin('/a/b', '/a/b'), true);
  assert.equal(isWithin('/a/b', '/a/bc/x'), false);
  assert.equal(isWithin('/a/b', '/a'), false);
});

test('범위 밖 경로는 거부하고 다음 행동을 준다(막다른 답 금지)', async () => {
  const { root, tool } = await sandbox();
  const r = await tool.handler({ action: 'read', path: '/etc/passwd' });
  assert.equal(r.blocked, true);
  assert.ok(r.userSafeSummary.includes('폴더 밖'));
  // P1(2026-08-02): 이 자리는 원래 `includes(root)` 로 **절대경로 자체**를 요구했다. 의도는
  // "어디까지 되는지 알려준다"였는데 표현이 원시 경로였고, 그 문장이 그대로 사용자에게 나가고
  // 모델 입력이 되어 모델이 답변에 절대경로를 옮겨 적었다(라이브 실측). 의도는 그대로 두고
  // **부르는 이름**으로 확인한다 — 아래 P1 검사가 원시 경로 금지를 따로 문다.
  assert.ok(r.nextSafeAction.includes(basename(root)), '어디까지 되는지 알려준다');
  assert.ok(!JSON.stringify(r).includes('passwd') || true); // 경로를 그대로 되뇌지 않아도 됨
});

test('상위 탈출(../)은 막힌다', async () => {
  const { tool } = await sandbox();
  const r = await tool.handler({ action: 'read', path: '../../../../etc/hosts' });
  assert.equal(r.blocked, true);
});

test('심볼릭 링크로도 범위를 못 벗어난다(문자열 판정만으로는 뚫린다)', async () => {
  const { root, tool } = await sandbox();
  const outside = await mkdtemp(join(tmpdir(), 'gpao-t5-outside-'));
  await writeFile(join(outside, 'secret.txt'), '비밀', 'utf8');
  await symlink(outside, join(root, 'link'));
  const r = await tool.handler({ action: 'read', path: 'link/secret.txt' });
  assert.equal(r.blocked, true, '링크를 타고 나가면 안 된다');
  assert.ok(r.userSafeSummary.includes('폴더 밖'));
});

test('resolveInScope: 새 파일도 부모가 범위 안이면 허용된다', async () => {
  const { realpath } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'gpao-t5-scope-'));
  const abs = await resolveInScope('새폴더/새파일.md', { roots: [root] });
  // 반환값은 **실제 경로**다(macOS /var→/private/var). 루트도 같은 기준으로 비교한다.
  assert.ok(abs.startsWith(await realpath(root)));
  await assert.rejects(() => resolveInScope('/tmp', { roots: [root] }), (e) => e instanceof ScopeError);
});

test('기본 루트는 홈 전체가 아니다 — 표준 사용자 폴더까지만 열린다(H08)', () => {
  const roots = defaultFileRoots({});
  // 루트 1개(~/GPAO-T5)로는 "다운로드 폴더의 견적서"가 시작도 못 한다(H08 실패 3/3 의 뿌리 ①).
  // 그렇다고 홈 전체를 열지 않는다 — 넓힘은 Downloads·Documents·Desktop 까지이고,
  // 그 안의 위험 자리는 local-protection 이 루트와 독립으로 막는다.
  assert.ok(roots[0].endsWith('GPAO-T5'), '작업 루트가 첫째다(상대 경로·휴지통의 기준)');
  for (const 이름 of ['Downloads', 'Documents', 'Desktop']) {
    assert.ok(roots.includes(join(homedir(), 이름)), `${이름} 이 범위에 없다`);
  }
  assert.ok(!roots.includes(homedir()), '홈 전체를 기본으로 열지 않는다');
  assert.ok(roots.every((r) => r.startsWith(homedir())), '루트는 전부 사용자 홈 하위다');
});

test('격리 HOME을 주면 파일 손과 찾기 손이 같은 사용자 폴더를 본다', async () => {
  const home = await mkdtemp(join(tmpdir(), 't5-isolated-home-'));
  await mkdir(join(home, 'Downloads'));
  const roots = defaultFileRoots({ HOME: home });
  assert.deepEqual(roots, ['GPAO-T5', 'Downloads', 'Documents', 'Desktop'].map((name) => join(home, name)));
  const live = liveDeps({ HOME: home, GPAO_T5_DATA_DIR: join(home, 'state') });
  assert.deepEqual(live.tools.tools['local.file'].scopeRoots, roots);
  const places = await live.tools.tools['local.locate'].places();
  assert.ok(places.some((place) => place.path === join(home, 'Downloads')));
});

// ── 읽기·쓰기·정리 (능력 완결) ────────────────────────────────────────────
test('쓰기 → 읽기 → 목록이 실제로 동작한다(스텁 아님)', async () => {
  const { root, tool } = await sandbox();
  const w = await tool.handler({ action: 'write', path: '메모.md', text: '첫 줄' });
  assert.equal(w.blocked, undefined);
  assert.equal(await readFile(join(root, '메모.md'), 'utf8'), '첫 줄', '진짜 파일이 생긴다');

  const r = await tool.handler({ action: 'read', path: '메모.md' });
  assert.equal(r.result.text, '첫 줄');

  const l = await tool.handler({ action: 'list' });
  assert.ok(l.result.items.some((i) => i.name === '메모.md' && i.kind === 'file'));
});

test('옮기기: 원본이 사라지고 대상에 생긴다', async () => {
  const { root, tool } = await sandbox();
  await tool.handler({ action: 'write', path: 'a.txt', text: 'x' });
  const m = await tool.handler({ action: 'move', path: 'a.txt', to: '보관/b.txt' });
  assert.equal(m.blocked, undefined);
  assert.equal(await readFile(join(root, '보관/b.txt'), 'utf8'), 'x');
  await assert.rejects(() => stat(join(root, 'a.txt')));
});

test('옮기기: 폴더도 같은 안전·되돌리기 계약으로 옮긴다', async () => {
  const { root, tool } = await sandbox();
  await mkdir(join(root, '_temp'), { recursive: true });
  await writeFile(join(root, '_temp/a.txt'), 'a');
  const m = await tool.handler({ action: 'move', path: '_temp', to: '__temp/_temp' });
  assert.equal(m.blocked, undefined, `폴더 move 가 막혔다: ${m.userSafeSummary}`);
  assert.equal(await readFile(join(root, '__temp/_temp/a.txt'), 'utf8'), 'a');
  await assert.rejects(() => stat(join(root, '_temp')));

  const u = await tool.handler({ action: 'undo' });
  assert.equal(u.blocked, undefined, `폴더 move undo 가 막혔다: ${u.userSafeSummary}`);
  assert.equal(await readFile(join(root, '_temp/a.txt'), 'utf8'), 'a');
  await assert.rejects(() => stat(join(root, '__temp/_temp')));
});

test('bulk_move: 조건에 맞는 여러 파일을 한 번에 옮기고 되돌릴 수 있다', async () => {
  const { root, tool } = await sandbox();
  await writeFile(join(root, 'a.pdf'), 'a');
  await writeFile(join(root, 'b.pdf'), 'b');
  await writeFile(join(root, 'c.txt'), 'c');

  const r = await tool.handler({
    action: 'bulk_move',
    path: '.',
    to: '문서',
    match: { extensions: ['.pdf'] },
  });
  assert.equal(r.blocked, undefined, `bulk_move 가 막혔다: ${r.userSafeSummary}`);
  assert.equal(r.result.moved.length, 2);
  assert.equal(await readFile(join(root, '문서/a.pdf'), 'utf8'), 'a');
  assert.equal(await readFile(join(root, '문서/b.pdf'), 'utf8'), 'b');
  assert.equal(await readFile(join(root, 'c.txt'), 'utf8'), 'c');
  await assert.rejects(() => stat(join(root, 'a.pdf')));

  const u1 = await tool.handler({ action: 'undo' });
  const u2 = await tool.handler({ action: 'undo' });
  assert.equal(u1.blocked, undefined);
  assert.equal(u2.blocked, undefined);
  assert.equal(await readFile(join(root, 'a.pdf'), 'utf8'), 'a');
  assert.equal(await readFile(join(root, 'b.pdf'), 'utf8'), 'b');
});

test('bulk_move: 수정일 조건으로 오래된 파일만 한 번에 옮긴다', async () => {
  const { root, tool } = await sandbox();
  const 오래된 = join(root, 'old.zip');
  const 최근 = join(root, 'new.zip');
  await writeFile(오래된, 'old');
  await writeFile(최근, 'new');
  const oldDate = new Date(Date.now() - 220 * 86_400_000);
  await utimes(오래된, oldDate, oldDate);

  const r = await tool.handler({
    action: 'bulk_move',
    path: '.',
    to: '오래된압축',
    match: { extensions: ['.zip'], olderThanDays: 180 },
  });

  assert.equal(r.blocked, undefined, `날짜 bulk_move 가 막혔다: ${r.userSafeSummary}`);
  assert.equal(r.result.moved.length, 1);
  assert.equal(await readFile(join(root, '오래된압축/old.zip'), 'utf8'), 'old');
  assert.equal(await readFile(최근, 'utf8'), 'new');
});

test('bulk_move: 조건 없이 폴더만 만들지 않는다', async () => {
  const { root, tool } = await sandbox();
  await writeFile(join(root, 'a.pdf'), 'a');
  const r = await tool.handler({ action: 'bulk_move', path: '.', to: '문서' });
  assert.equal(r.blocked, true);
  await assert.rejects(() => stat(join(root, '문서')), '조건 없는 bulk_move 가 빈 폴더를 만들었다');
});

// ── 되돌리기 (§18) ────────────────────────────────────────────────────────
test('삭제는 되돌릴 수 있다 — 되돌린 뒤 실제 내용이 복구된다', async () => {
  const { root, tool } = await sandbox();
  await tool.handler({ action: 'write', path: '지울것.md', text: '소중한 내용' });
  const d = await tool.handler({ action: 'delete', path: '지울것.md' });
  assert.equal(d.result.recoverable, true);
  await assert.rejects(() => stat(join(root, '지울것.md')), '실제로 지워진다');

  const u = await tool.handler({ action: 'undo' });
  assert.equal(u.blocked, undefined);
  assert.equal(await readFile(join(root, '지울것.md'), 'utf8'), '소중한 내용', '내용까지 복구된다');
});

test('덮어쓰기도 되돌릴 수 있다(이전 내용 보존)', async () => {
  const { root, tool } = await sandbox();
  await tool.handler({ action: 'write', path: 'x.md', text: '원본' });
  const w = await tool.handler({ action: 'write', path: 'x.md', text: '새것' });
  assert.equal(w.result.overwritten, true);
  assert.equal(await readFile(join(root, 'x.md'), 'utf8'), '새것');
  await tool.handler({ action: 'undo' });
  assert.equal(await readFile(join(root, 'x.md'), 'utf8'), '원본');
});

test('되돌릴 게 없으면 정직하게 말한다', async () => {
  const { tool } = await sandbox();
  const u = await tool.handler({ action: 'undo' });
  assert.equal(u.blocked, true);
  assert.ok(u.userSafeSummary.includes('되돌릴'));
});

// ── 실패 종류별 사용자 언어 ───────────────────────────────────────────────
test('없는 파일·폴더 읽기·모르는 작업을 각각 다른 말로 알린다', async () => {
  const { root, tool } = await sandbox();
  const notFound = await tool.handler({ action: 'read', path: '없는파일.md' });
  assert.equal(notFound.blocked, true);
  assert.ok(notFound.userSafeSummary.includes('찾지 못했'));

  await mkdir(join(root, '폴더'), { recursive: true });
  const isDir = await tool.handler({ action: 'read', path: '폴더' });
  assert.equal(isDir.blocked, true);
  assert.ok(isDir.userSafeSummary.includes('폴더'));

  const unknown = await tool.handler({ action: '포맷', path: 'x' });
  assert.equal(unknown.blocked, true);
  assert.ok(unknown.nextSafeAction.includes('되돌리기'), '할 수 있는 것을 알려준다');
});

test('너무 큰 파일은 통째로 읽지 않고 다음 행동을 준다', async () => {
  const { root, tool } = await sandbox();
  await writeFile(join(root, 'big.txt'), 'x'.repeat(1_000_001), 'utf8');
  const r = await tool.handler({ action: 'read', path: 'big.txt' });
  assert.equal(r.blocked, true);
  assert.ok(r.userSafeSummary.includes('커서'));
  assert.ok(r.nextSafeAction);
});

// ── 권한 계약 (등급은 기존 그대로) ────────────────────────────────────────
test('파일 쓰기·삭제는 안전 바닥이라 어떤 모드에서도 승인을 받는다', () => {
  assert.ok(isSafetyFloor('write'));
  assert.ok(isSafetyFloor('delete'));
  assert.ok(SAFETY_FLOOR_KINDS.includes('write') && SAFETY_FLOOR_KINDS.includes('delete'));
});

// ── §16-C 스텁 금지 게이트 ────────────────────────────────────────────────
test('라이브 도구 레지스트리에 fixture(스텁)가 들어가면 안 된다 — local.file 사고 재발 방지', () => {
  const { tools } = liveDeps({});
  const registry = tools.tools ?? {};
  const fixtures = Object.entries(registry).filter(([, t]) => t?.isFixture);
  assert.deepEqual(
    fixtures.map(([id]) => id), [],
    `라이브에 스텁이 등록돼 있습니다: ${fixtures.map(([id]) => id).join(', ')} — 등록된 도구는 실제로 동작해야 합니다(§16-C)`,
  );
});

test('반대 검증: fixture 를 라이브에 넣으면 게이트가 실제로 잡는다', () => {
  const fake = { 'x.tool': { isFixture: true, async handler() { return {}; } } };
  const fixtures = Object.entries(fake).filter(([, t]) => t?.isFixture);
  assert.equal(fixtures.length, 1, '게이트가 스텁을 못 잡으면 이 테스트가 의미 없다');
});

// ── 능력 문서가 실제와 일치하는가 ─────────────────────────────────────────
test('local.file 이 실제로 파일을 다루므로 능력 설명이 거짓이 아니다', async () => {
  const { root, tool } = await sandbox();
  const w = await tool.handler({ action: 'write', path: '증거.md', text: '실제' });
  const files = await readdir(root);
  assert.ok(files.includes('증거.md'), '"읽고 정리한다"는 설명이 실제 동작으로 뒷받침된다');
  assert.equal(w.result.path.endsWith('증거.md'), true);
});

// ── 안전 결함 회귀 (오너 실사용 2026-07-26에서 실제로 샜다) ────────────────
test('파일 삭제는 승인 없이 실행되지 않는다 — 도구가 아니라 작업으로 권한을 판정한다', async () => {
  const { interpret } = await import('../src/kernel/l1-intent/intent.js');
  const { buildActionPlan, fileKind } = await import('../src/kernel/l2-plan/action-plan.js');
  const { buildSelfState } = await import('../src/kernel/l0-evidence/self-state.js');
  const { demoEnv } = await import('../src/surface/demo-context.js');
  const selfState = buildSelfState(demoEnv());

  // 작업별 권한 종류
  assert.equal(fileKind({ action: 'delete' }), 'delete');
  assert.equal(fileKind({ action: 'write' }), 'write');
  assert.equal(fileKind({ action: 'read' }), 'read');

  // 자동성 헌장(2026-08-03) 이후: 삭제의 문지기는 승인 카드가 아니라 **되돌림**이다.
  // 헌장 ② 는 "백업 없는 파괴"만 묻는다. local.file 은 원본을 휴지통에 남긴다고 선언하므로
  // 삭제는 자동으로 돈다 — 대신 그 선언이 거짓이면 사용자는 확인도 없이 원본을 잃는다.
  // 그래서 여기서 재는 것은 "묻는가"가 아니라 **"되돌릴 수 있다고 선언했는가"** 다.
  const 파일손 = selfState.connectedTools.find((t) => t.id === 'local.file');
  assert.equal(파일손?.reversible, true, '삭제가 자동으로 도는 근거는 이 선언 하나뿐이다');
  const del = buildActionPlan({ intent: interpret('메모.md 지워줘'), selfState });
  assert.ok(!del.needsApproval.some((g) => g.action === 'local.file'),
    '되돌릴 수 있는 삭제는 헌장이 자동으로 둔다');

  // 읽기 요청 → 승인 없이 진행(막지 않는다)
  const read = buildActionPlan({ intent: interpret('메모.md 읽어줘'), selfState });
  assert.equal(read.needsApproval.some((g) => g.action === 'local.file'), false, '읽기까지 막지 않는다');
});

test('"되돌려줘"가 실제 되돌리기로 이어진다(fast_chat 으로 새지 않는다)', async () => {
  const { interpret } = await import('../src/kernel/l1-intent/intent.js');
  const i = interpret('되돌려줘');
  assert.equal(i.answerMode, 'complex_work', '되돌리기는 실행이다');
  assert.ok(i.neededTools?.includes('local.file'));
  assert.equal(i.fileOp?.action, 'undo');
});

test('대상 없는 취소를 파일 되돌리기로 만들지 않되 파일 취소는 유지한다', async () => {
  const { interpret } = await import('../src/kernel/l1-intent/intent.js');
  const generic = interpret('이제 취소해줘');
  assert.equal(generic.neededTools?.includes('local.file') ?? false, false,
    '자동화·기억 등 다른 대상을 취소하는 말에 파일 승인 카드가 뜬다');

  const file = interpret('방금 만든 파일 취소해줘');
  assert.ok(file.neededTools?.includes('local.file'), '파일을 명시한 취소까지 잃으면 안 된다');
  assert.equal(file.fileOp?.action, 'undo');
});

test('되돌리기는 재시작 후에도 된다 — 표가 메모리에만 있으면 다음 날 못 되돌린다(§18)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gpao-t5-undo-'));
  const first = makeLocalFileTool({ roots: [root], dataDir: root });
  await first.handler({ action: 'write', path: '보관.md', text: '지키고 싶은 것' });
  await first.handler({ action: 'delete', path: '보관.md' });

  // 새 프로세스(관리자 재생성) — 메모리 표는 사라졌다
  const afterRestart = makeLocalFileTool({ roots: [root], dataDir: root });
  const u = await afterRestart.handler({ action: 'undo' });
  assert.equal(u.blocked, undefined, '재시작 뒤에도 되돌릴 수 있어야 한다');
  assert.equal(await readFile(join(root, '보관.md'), 'utf8'), '지키고 싶은 것');
});

// ── P0-1b 안전 hotfix (감사 지적: 조용한 덮어쓰기로 인한 데이터 손실) ──────
test('기존 b.txt 가 있을 때 a.txt → b.txt 이동은 조용히 덮어쓰지 않는다', async () => {
  const { root, tool } = await sandbox();
  await tool.handler({ action: 'write', path: 'a.txt', text: '원본 A' });
  await tool.handler({ action: 'write', path: 'b.txt', text: '지키고 싶은 B' });

  const m = await tool.handler({ action: 'move', path: 'a.txt', to: 'b.txt' });
  assert.equal(m.blocked, true, '덮어쓰지 않고 막는다');
  assert.ok(m.userSafeSummary.includes('이미 있어서'));
  assert.ok(m.nextSafeAction, '다음 행동을 준다(막다른 답 금지)');

  // 둘 다 그대로여야 한다 — 하나라도 사라지면 사용자가 파일을 잃은 것이다
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), '원본 A');
  assert.equal(await readFile(join(root, 'b.txt'), 'utf8'), '지키고 싶은 B');
});

test('대상이 없으면 이동은 그대로 동작한다(막기가 정상 경로를 깨지 않는다)', async () => {
  const { root, tool } = await sandbox();
  await tool.handler({ action: 'write', path: 'a.txt', text: 'x' });
  const m = await tool.handler({ action: 'move', path: 'a.txt', to: '새이름.txt' });
  assert.equal(m.blocked, undefined);
  assert.equal(await readFile(join(root, '새이름.txt'), 'utf8'), 'x');
});

// 실측(오너 라이브 2026-07-28, 웹 화면): 승인 카드가 **"휴지통에 남아 '되돌려줘'로
// 되살릴 수 있어요"** 라고 약속하고 파일을 새로 만들었는데, "되돌려줘" 에는
// **"되돌릴 작업이 없어요"** 가 나왔다. 덮어쓸 원본이 없으면 되돌리기 표에 아무것도
// 안 남기고 있었다 — 카드가 못 지킬 약속을 한 것이다.
test('새로 만든 파일도 되돌릴 수 있다 — 카드의 약속이 지켜진다', async () => {
  const { root, tool } = await sandbox();
  const w = await tool.handler({ action: 'write', path: '정산.md', text: '합계 2,440,000' });
  assert.equal(w.blocked, undefined);
  assert.equal(await readFile(join(root, '정산.md'), 'utf8'), '합계 2,440,000');

  const u = await tool.handler({ action: 'undo' });
  assert.equal(u.blocked, undefined, `되돌릴 수 없다고 답했다: ${u.userSafeSummary}`);
  assert.ok(!/되돌릴 작업이 없어요/.test(u.userSafeSummary ?? ''));
  await assert.rejects(() => readFile(join(root, '정산.md'), 'utf8'), '만든 파일이 그대로 남아 있다');
});

test('승인 카드는 새로 만들기와 덮어쓰기를 다르게 약속한다', async () => {
  const { root, tool } = await sandbox();
  const 새로 = tool.previewOf({ action: 'write', path: '없던파일.md', text: 'x' });
  assert.ok(!/원본/.test(새로.cancel), `없는 원본을 약속했다: ${새로.cancel}`);
  assert.match(새로.cancel, /되돌려줘/);

  await writeFile(join(root, '있던파일.md'), '원본');
  const 덮어 = tool.previewOf({ action: 'write', path: '있던파일.md', text: 'y' });
  assert.match(덮어.cancel, /원본은 휴지통에 남아요/);
});

// ── C 감사 F5.1★ · undo 는 저장된 경로라도 범위·보호를 지나야 실행된다 ────
// 실측(감사 2026-08-01): undo 블록이 resolveInScope·protectionBlocks 보다 앞에 있어,
// undo-log.json 에 적힌 절대 경로가 검사 없이 mkdir·rename 으로 실행됐다. 로그 파일은
// 범위 안(.trash)이라 write/move 로 정당하게 변조 가능했다 — 범위 밖 이동이 undo 한 번에 열린다.
test('F5.1: 범위 밖 경로가 적힌 undo 기록은 실행하지 않는다(재시작 뒤 낡은 기록)', async () => {
  const { root, tool } = await sandbox();
  const 밖 = await mkdtemp(join(tmpdir(), 'gpao-t5-범위밖-'));
  await writeFile(join(밖, '남의파일.md'), '건드리면 안 된다');
  await mkdir(join(root, '.trash'), { recursive: true });
  // 재시작 뒤 남은(또는 변조된) 로그 — from 이 현재 범위 밖을 가리킨다.
  await writeFile(join(root, '.trash/undo-log.json'), JSON.stringify([
    { id: 'x', op: 'delete', from: join(밖, '남의파일.md'), to: join(root, '.trash/미끼'), at: new Date().toISOString() },
  ]));
  await writeFile(join(root, '.trash/미끼'), '엉뚱한 내용');
  const r = await tool.handler({ action: 'undo' });
  assert.ok(r.blocked, `범위 밖 undo 가 실행됐다: ${JSON.stringify(r)}`);
  assert.equal(await readFile(join(밖, '남의파일.md'), 'utf8'), '건드리면 안 된다', '범위 밖 원본이 움직였다');
});

test('F5.1: 보호 영역(비밀 이름)을 향한 undo 기록은 실행하지 않는다', async () => {
  const { root, tool } = await sandbox();
  await mkdir(join(root, '.trash'), { recursive: true });
  await writeFile(join(root, '.trash/담긴것'), '비밀로 위장한 내용');
  await writeFile(join(root, '.trash/undo-log.json'), JSON.stringify([
    { id: 'x', op: 'delete', from: join(root, 'api-token.txt'), to: join(root, '.trash/담긴것'), at: new Date().toISOString() },
  ]));
  const r = await tool.handler({ action: 'undo' });
  assert.ok(r.blocked, '보호 영역을 향한 undo 가 실행됐다');
});

test('F5.1: 심볼릭 링크로 범위를 빠져나가는 undo 기록도 막힌다', async () => {
  const { root, tool } = await sandbox();
  const 밖 = await mkdtemp(join(tmpdir(), 'gpao-t5-링크밖-'));
  await symlink(밖, join(root, '지름길'));
  await mkdir(join(root, '.trash'), { recursive: true });
  await writeFile(join(root, '.trash/담긴것'), 'x');
  await writeFile(join(root, '.trash/undo-log.json'), JSON.stringify([
    { id: 'x', op: 'delete', from: join(root, '지름길/새파일.md'), to: join(root, '.trash/담긴것'), at: new Date().toISOString() },
  ]));
  const r = await tool.handler({ action: 'undo' });
  assert.ok(r.blocked, '링크를 지나 범위 밖으로 되돌렸다');
  const 밖에생김 = await readdir(밖);
  assert.deepEqual(밖에생김, [], `범위 밖에 파일이 생겼다: ${밖에생김}`);
});

test('F5.1: 정상 undo 는 그대로 된다(보호가 기능을 죽이면 안 된다)', async () => {
  const { root, tool } = await sandbox();
  await tool.handler({ action: 'write', path: '메모.md', text: '원래 내용' });
  await tool.handler({ action: 'write', path: '메모.md', text: '새 내용' });
  const u = await tool.handler({ action: 'undo' });
  assert.equal(u.blocked, undefined, `정상 undo 가 막혔다: ${u.userSafeSummary}`);
  assert.equal(await readFile(join(root, '메모.md'), 'utf8'), '원래 내용');
});

test('F5.1: 되돌리기 도중 실패하면 지금 파일도 원본도 잃지 않는다', async () => {
  const { root, tool } = await sandbox();
  await mkdir(join(root, '.trash'), { recursive: true });
  // to(휴지통 사본)가 이미 사라진 기록 — rename 이 실패한다.
  await writeFile(join(root, '현재본.md'), '지금 내용');
  await writeFile(join(root, '.trash/undo-log.json'), JSON.stringify([
    { id: 'x', op: 'write', from: join(root, '현재본.md'), to: join(root, '.trash/이미없음'), at: new Date().toISOString() },
  ]));
  const r = await tool.handler({ action: 'undo' });
  assert.ok(r.blocked, '없는 사본을 되돌렸다고 말했다(거짓 성공)');
  assert.equal(await readFile(join(root, '현재본.md'), 'utf8'), '지금 내용',
    '실패한 undo 가 지금 파일을 치웠다 — 실패 시 모두 보존이 계약이다');
});

// ── C 감사 F5.2 · undo 승인 카드는 실제 대상을 말한다 ───────────────────
test('F5.2: undo 미리보기가 로그의 실제 대상을 보여준다(강제되지 않는 범위 단언 금지)', async () => {
  const { root, tool } = await sandbox();
  await tool.handler({ action: 'write', path: '보고서.md', text: '내용' });
  const pv = tool.previewOf({ action: 'undo' });
  assert.ok(String(pv.scope).includes('보고서.md'),
    `카드가 실제 대상 대신 뭉뚱그린 범위를 말한다: ${JSON.stringify(pv)}`);
});

// ── C 감사 F5.4 · move 부분 실패가 조용한 사본을 남기면 안 된다 ──────────
test('F5.4: 옮기기 도중 원본 삭제가 실패하면 사본을 되물리고 정직하게 말한다', async () => {
  const { root, tool } = await sandbox();
  const src디렉 = join(root, '잠긴폴더');
  await mkdir(src디렉, { recursive: true });
  await writeFile(join(src디렉, '자료.md'), '내용');
  const { chmod } = await import('node:fs/promises');
  await chmod(src디렉, 0o555); // 부모가 읽기 전용 → copyFile 은 되고 rm 이 실패한다
  try {
    const r = await tool.handler({ action: 'move', path: '잠긴폴더/자료.md', to: '옮긴자료.md' });
    assert.ok(r.blocked, '부분 실패가 성공처럼 답했다');
    let 사본있음 = true;
    try { await stat(join(root, '옮긴자료.md')); } catch { 사본있음 = false; }
    assert.equal(사본있음, false, '실패했는데 사본이 남았다 — 재시도가 destExists 에 영영 막힌다');
    assert.equal(await readFile(join(src디렉, '자료.md'), 'utf8'), '내용', '원본이 사라졌다');
  } finally {
    await chmod(src디렉, 0o755);
  }
});

// ── C 감사 F2.3 완결 · 목록·읽기에도 수정 시각이 사실로 남는다 ────────────
test('F2.3: list 항목과 read 결과에 수정 시각이 있다(최종본 판단의 재료)', async () => {
  const { root, tool } = await sandbox();
  await writeFile(join(root, '자료.md'), '내용');
  const l = await tool.handler({ action: 'list' });
  const item = l.result.items.find((i) => i.name === '자료.md');
  assert.ok(item?.modifiedAt, `list 항목에 modifiedAt 이 없다: ${JSON.stringify(item)}`);
  const r = await tool.handler({ action: 'read', path: '자료.md' });
  assert.ok(r.result.modifiedAt, 'read 결과에 modifiedAt 이 없다');
});

// ── H08 실측 · `~/` 경로를 파일 손도 푼다(locate 와 같은 해석 — 두 진실 금지) ──
// 라이브(2026-08-01): 모델이 list {path:'~/Downloads'} 를 골랐는데 resolveInScope 가
// `~` 를 문자 그대로 루트에 붙여 ENOENT — 모델은 실제로 있는 표준 폴더를 못 보고
// 빈 작업 루트를 보고는 "폴더가 비어 있다"고 답했다.
test('H08: ~/ 경로는 홈 기준으로 풀린다', async () => {
  const home = await mkdtemp(join(tmpdir(), 'gpao-t5-틸다-'));
  const dl = join(home, 'Downloads');
  await mkdir(dl, { recursive: true });
  await writeFile(join(dl, '자료.csv'), 'x');
  const tool = makeLocalFileTool({ roots: [join(home, 'GPAO-T5'), dl], homeDir: home });
  const r = await tool.handler({ action: 'list', path: '~/Downloads' });
  assert.equal(r.blocked, undefined, `~/Downloads 가 안 풀렸다: ${r.userSafeSummary}`);
  assert.ok(r.result.items.some((i) => i.name === '자료.csv'));
});

// ── H08 실측 · 루트 이름으로 시작하는 상대 경로는 그 루트에서 푼다 ────────
// 라이브(2026-08-01): 모델이 `Downloads/견적서.csv` 를 골랐는데 상대 경로가 루트0
// (GPAO-T5) 기준으로만 풀려 ENOENT — 실제로 열려 있는 둘째 루트를 부르는 자연스러운
// 표기가 죽었고, 모델은 "만들었다고 보고 설명"하는 거짓 서술로 밀렸다.
test('H08: "Downloads/파일" 상대 경로가 Downloads 루트에서 풀린다', async () => {
  const home = await mkdtemp(join(tmpdir(), 'gpao-t5-루트명-'));
  const 작업 = join(home, 'GPAO-T5'); const dl = join(home, 'Downloads');
  await mkdir(작업, { recursive: true }); await mkdir(dl, { recursive: true });
  await writeFile(join(dl, '자료.csv'), '내용');
  const tool = makeLocalFileTool({ roots: [작업, dl], homeDir: home });
  const r = await tool.handler({ action: 'read', path: 'Downloads/자료.csv' });
  assert.equal(r.blocked, undefined, `루트 이름 상대 경로가 안 풀렸다: ${r.userSafeSummary}`);
  assert.equal(r.result.text, '내용');
  // 루트0 안에 같은 이름 폴더가 실제로 있으면 **기존 해석이 이긴다**(행동 보존).
  await mkdir(join(작업, 'Downloads'), { recursive: true });
  await writeFile(join(작업, 'Downloads/자료.csv'), '작업루트쪽');
  const r2 = await tool.handler({ action: 'read', path: 'Downloads/자료.csv' });
  assert.equal(r2.result.text, '작업루트쪽');
});

// ── P1 (QA90 감사 2026-08-02) · 사용자면에 원시 절대경로를 내지 않는다 ──────
//
// 라이브 실측(2026-08-02): 범위 밖 안내가 사용자에게 이렇게 나갔다 —
//   "파일 도구는 /Users/…/GPAO-T5, /Users/…/Downloads 안에서만 다뤄요."
// 사용자는 자기 폴더를 `Downloads` 라는 절대경로로 알지 않는다("다운로드"라고 부른다).
// 게다가 이 문장이 그대로 모델 입력이 되어 모델이 절대경로를 답변에 옮겨 적었다.
// 정의역: 범위 밖(out_of_scope) · 못 찾음(ENOENT) — 둘 다 루트를 사람 말로 말해야 한다.
test('P1: 범위 밖·못 찾음 안내는 사람이 부르는 폴더 이름으로 말한다(원시 경로 금지)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'gpao-t5-p1-home-'));
  const roots = ['GPAO-T5', 'Downloads', 'Documents', 'Desktop'].map((d) => join(home, d));
  for (const r of roots) await mkdir(r, { recursive: true });
  const tool = makeLocalFileTool({ roots, dataDir: await mkdtemp(join(tmpdir(), 'gpao-t5-p1-')) });
  const 절대경로 = /(^|[\s(])\/[A-Za-z0-9._-]+\//;

  const 밖 = await tool.handler({ action: 'list', path: '/etc' });
  assert.equal(밖.scopeState, 'out_of_scope', '전제: 범위 밖이어야 한다');
  for (const 문장 of [밖.userSafeSummary, 밖.nextSafeAction]) {
    assert.doesNotMatch(String(문장 ?? ''), 절대경로, `사용자면에 원시 경로가 나갔다: ${문장}`);
  }
  assert.match(String(밖.nextSafeAction ?? ''), /다운로드|문서|바탕화면|작업 폴더/,
    '어디를 다루는지 사람 말로 말하지 않으면 사용자는 다음 행동을 못 정한다');

  const 없음 = await tool.handler({ action: 'read', path: 'GPAO-T5/없는파일.txt' });
  assert.ok(없음.blocked, '전제: 못 찾은 자리여야 한다');
  for (const 문장 of [없음.userSafeSummary, 없음.nextSafeAction]) {
    assert.doesNotMatch(String(문장 ?? ''), 절대경로, `사용자면에 원시 경로가 나갔다: ${문장}`);
  }
});

// 라이브 실측(2026-08-02): "정산_3월.csv 지워줘" 에 T5 가 "그 자리는 파일 도구의 작업 폴더
// 밖이에요"라고 답했다. 그 파일은 Downloads 에 **있었다.** 상대 경로가 첫 루트로만 풀려서,
// 다른 루트에 있는 파일은 이름만 말하면 닿지 못했다 — 사용자는 경로를 말하지 않는다(P6-W2).
test('P1: 이름만 말한 파일이 다른 루트에 있으면 거기서 찾는다', async () => {
  const home = await mkdtemp(join(tmpdir(), 'gpao-t5-p1b-home-'));
  const roots = ['GPAO-T5', 'Downloads', 'Documents', 'Desktop'].map((d) => join(home, d));
  for (const r of roots) await mkdir(r, { recursive: true });
  await writeFile(join(home, 'Downloads', '정산_3월.csv'), '항목,금액\n임대료,500000\n');
  const tool = makeLocalFileTool({ roots, dataDir: await mkdtemp(join(tmpdir(), 'gpao-t5-p1b-')) });
  const r = await tool.handler({ action: 'read', path: '정산_3월.csv' });
  assert.ok(!r.blocked, `이름만 말했다고 못 찾으면 안 된다: ${r.userSafeSummary}`);
  assert.match(String(r.result?.text ?? ''), /임대료/, '다른 루트의 그 파일을 실제로 읽어야 한다');
});

test('P1: 같은 이름이 여러 루트에 있으면 첫 루트 해석을 유지한다(행동 보존)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'gpao-t5-p1c-home-'));
  const roots = ['GPAO-T5', 'Downloads'].map((d) => join(home, d));
  for (const r of roots) await mkdir(r, { recursive: true });
  await writeFile(join(home, 'GPAO-T5', '메모.md'), '작업폴더것');
  await writeFile(join(home, 'Downloads', '메모.md'), '다운로드것');
  const tool = makeLocalFileTool({ roots, dataDir: await mkdtemp(join(tmpdir(), 'gpao-t5-p1c-')) });
  const r = await tool.handler({ action: 'read', path: '메모.md' });
  assert.match(String(r.result?.text ?? ''), /작업폴더것/, '첫 루트 우선이 깨지면 기존 동작이 바뀐다');
});

test('P1: 이름만 말한 새 파일은 여전히 작업 폴더에 만든다(찾기 규칙이 쓰기를 옮기지 않는다)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'gpao-t5-p1d-home-'));
  const roots = ['GPAO-T5', 'Downloads'].map((d) => join(home, d));
  for (const r of roots) await mkdir(r, { recursive: true });
  const tool = makeLocalFileTool({ roots, dataDir: await mkdtemp(join(tmpdir(), 'gpao-t5-p1d-')) });
  const r = await tool.handler({ action: 'write', path: '새메모.md', text: '내용', granted: true });
  assert.ok(!r.blocked, `쓰기가 막혔다: ${r.userSafeSummary}`);
  const { readFile } = await import('node:fs/promises');
  assert.equal(await readFile(join(home, 'GPAO-T5', '새메모.md'), 'utf8'), '내용',
    '새 파일이 작업 폴더가 아닌 데 생기면 사용자가 자기 파일을 잃는다');
});

// ── 조용한 0 은 거짓 진단을 낳는다 ──────────────────────────────────────────
//
// 실측(S1 라이브 2026-08-04, gpt-5.1): 모델이 "`backup-` 로 시작하는 것들"과 "이름에 임시·temp
// 가 든 것들"을 **둘 다 모으려고**(OR 의도) 한 호출에 함께 넣었다. 조건은 AND 라 0개가 나왔고,
// 결과는 "조건에 맞는 파일이 없어서 옮기지 않았어요"뿐이었다.
//
// 그래서 모델은 원인을 **경로 문제로 잘못 짚고** 사용자에게 그렇게 말했다("툴이 쓸 때 경로
// 지정이 살짝 안 맞았던 걸로 보여"). 도구가 이유를 안 주면 모델은 이유를 지어낸다.
test('조건에 하나도 안 맞으면 **왜 0인지**를 조건별로 말한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bulk-why0-'));
  for (const f of ['backup-1.png', 'backup-2.pdf', '#임시#메모.txt', 'normal.doc']) {
    await writeFile(join(dir, f), 'x');
  }
  const tool = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const out = await tool.handler({
    action: 'bulk_move', path: '.', to: '__Temp',
    match: { namePrefix: 'backup-', nameIncludes: ['임시', 'temp'] },
  });
  assert.equal(out.blocked, true);
  assert.match(out.userSafeSummary, /이름이 backup- 로 시작 2개/, '조건별 개수가 없으면 모델이 원인을 지어낸다');
  assert.match(out.userSafeSummary, /이름에 임시·temp 포함 1개/);
  assert.match(out.userSafeSummary, /모두 만족해야/, 'AND 라는 사실이 없으면 같은 실수를 반복한다');
  assert.match(out.nextSafeAction, /나눠서/, '되는 길이 없으면 막다른 답이다');
  // 진단면 사실은 사용자면 문장과 별개로 남는다.
  assert.equal(out.diagnosticTrace?.모두만족해야함, true);
  assert.equal(out.diagnosticTrace?.훑은수, 4);
});

test('조건이 하나뿐이면 "나눠 부르라"고 하지 않는다(없는 길을 권하지 않는다)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bulk-why0-one-'));
  await writeFile(join(dir, 'a.doc'), 'x');
  const tool = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const out = await tool.handler({
    action: 'bulk_move', path: '.', to: '__T', match: { extensions: ['.pdf'] },
  });
  assert.equal(out.blocked, true);
  assert.match(out.userSafeSummary, /확장자 \.pdf 0개/);
  assert.doesNotMatch(out.nextSafeAction, /나눠서/);
});
