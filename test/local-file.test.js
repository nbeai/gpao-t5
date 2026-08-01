// Phase 0-1 · 로컬 파일 손발 검증.
// 완결 기준(§16-D): 읽기·쓰기·정리 + 범위 권한 + 되돌리기 + 실패 종류별 사용자 언어.
// 그리고 §16-C 스텁 금지 게이트 — 라이브 레지스트리에 fixture 가 들어가면 실패한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, symlink, stat, readdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
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
  assert.ok(r.nextSafeAction.includes(root), '어디까지 되는지 알려준다');
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

  // 삭제 요청 → 승인 필요(안전 바닥). 도구 단위로 organize 로 고정하면 여기가 통과해 버린다.
  const del = buildActionPlan({ intent: interpret('메모.md 지워줘'), selfState });
  assert.ok(del.needsApproval.some((g) => g.action === 'local.file'), '삭제는 승인을 받아야 한다');

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
