// TG-2 반대시험(명세 §16 TG-2): 기존 파일 무변경 · legacy M4 과장 금지 · rollback trace 보존.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TCellRegistry, importLegacyMemory } from '../src/surface/tcell-store.js';
import { validateTCell } from '../src/kernel/l5-growth/tcell-core.js';

const 온전한세포 = (id) => ({
  id, schemaVersion: 1, state: 'M1_candidate',
  principle: { statement: '짧게 요점만', type: 'communication', hypothesisConfidence: 0.2 },
  center: { point: '', axis: '', horizontalSignals: [] },
  anchor: { workspace: null, project: null, surface: null, subject: null, createdAt: 0, lastObservedAt: 0 },
  boundary: { validWhen: ['보고'], invalidWhen: ['긴급 설명 요청'], needsReviewWhen: [], mustNotOverride: ['현재 요청'] },
  geometry: { radius: 'turn', depth: 0, sphereStability: 0 },
  authority: { allowedInfluence: ['none'], requiresUserConfirmation: true, mustNotOverrideCurrentRequest: true, prohibitedActionKinds: [] },
  trace: { observationRefs: ['obs-1'], rawSourceRefs: [], derivedFrom: [], corrections: [] },
  replay: { status: 'untested', caseRefs: [], lastRunAt: null },
  effect: { eligibleCount: 0, successCount: 0, failureCount: 0, userCorrectionCount: 0, wilsonLowerBound: 0, sameFailureRecurrenceCount: 0, authorityViolationCount: 0 },
  growth: { mutationRefs: [], rollbackAvailable: true, previousVersionId: null, lastAuditAt: null },
});

test('legacy adapter(이관표): 선호는 변환 금지 · 운영 원리만 M2_replayed · 원 위치 보존 · 원본 무변경', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg2a-'));
  const memPath = join(dir, 'memory.json');
  const 원본 = JSON.stringify({ candidates: [], promoted: [
    { id: 'p1', statement: '보고서는 목록으로', kind: 'preference', userConfirmed: true },
    { id: 'p2', statement: '배포 전에 게이트를 돌린다', kind: 'operating_principle', userConfirmed: true },
  ], observed: [], closed: {} });
  await writeFile(memPath, 원본, 'utf8');
  const cells = importLegacyMemory(JSON.parse(await readFile(memPath, 'utf8')));
  assert.equal(cells.length, 1, '일반 선호가 T-cell 로 변환됐다');
  assert.equal(cells[0].id, 'legacy-mem-p2');
  assert.equal(cells[0].state, 'M2_replayed', '검토된 운영 원리가 M2 가 아니다');
  assert.ok(!['M3_limited', 'M4_stable', 'M5_compressed'].includes(cells[0].state));
  assert.deepEqual(cells[0].authority.allowedInfluence, ['none']);
  assert.ok(cells[0].trace.rawSourceRefs[0].includes('memory.json'), '원 저장 위치가 trace 에 없다');
  assert.equal(validateTCell(cells[0]).ok, true, `검증 실패: ${JSON.stringify(validateTCell(cells[0]).errors)}`);
  assert.equal(await readFile(memPath, 'utf8'), 원본, '기존 파일이 변경됐다');
});

test('registry: 검증 실패는 quarantined 로 저장(영향 0) · 미래 필드 보존 · 0600', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg2b-'));
  const reg = new TCellRegistry(dir);
  await reg.save({ cells: [], 미래필드: '보존해야 함' });
  const 불량 = { ...온전한세포('bad'), trace: { observationRefs: [], corrections: [] } };
  const v = await reg.upsert(불량);
  assert.equal(v.ok, false);
  const a = await reg.load();
  assert.equal(a.cells[0].state, 'quarantined');
  assert.deepEqual(a.cells[0].authority.allowedInfluence, ['none']);
  assert.equal(a.미래필드, '보존해야 함', '미래 필드가 사라졌다');
  const { stat } = await import('node:fs/promises');
  assert.equal(((await stat(join(dir, 'growth', 'tcells.json'))).mode & 0o777), 0o600);
});

test('rollback 은 상태 전이일 뿐 — trace·이력을 삭제하지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg2c-'));
  const reg = new TCellRegistry(dir);
  await reg.upsert(온전한세포('c1'));
  const r = await reg.rollback('c1');
  assert.equal(r.ok, true);
  const a = await reg.load();
  const cell = a.cells.find((c) => c.id === 'c1');
  assert.equal(cell.state, 'rolled_back');
  assert.deepEqual(cell.trace.observationRefs, ['obs-1'], 'rollback 이 trace 를 지웠다');
  assert.deepEqual(cell.authority.allowedInfluence, ['none']);
  assert.equal((await reg.rollback('ghost')).ok, false);
  assert.equal(a.cells.length, 1, 'rollback 이 항목을 삭제했다');
});

// ── TG-2 독립 감사 반영 반대시험 ──
test('손상 저장소는 빈 상태로 위장·덮어쓰지 않는다 — 격리 보존 후 새로 시작', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg2d-'));
  const reg = new TCellRegistry(dir);
  const { mkdir: mkd } = await import('node:fs/promises');
  await mkd(join(dir, 'growth'), { recursive: true });
  await writeFile(join(dir, 'growth', 'tcells.json'), '{손상된 JSON', 'utf8');
  const r = await reg.load();
  assert.equal(r.corrupted, true, '손상이 빈 저장소로 위장됐다');
  await reg.upsert(온전한세포('c1'));
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(join(dir, 'growth'));
  assert.ok(files.some((f) => f.includes('corrupt')), '손상 바이트가 보존되지 않았다');
  assert.equal((await reg.load()).cells.length, 1);
});

test('동시 저장 20건이 전부 남는다(직렬화) · 읽기는 불량 세포를 격리 투영한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg2e-'));
  const reg = new TCellRegistry(dir);
  await Promise.all(Array.from({ length: 20 }, (_, i) => reg.upsert(온전한세포(`c${i}`))));
  const a = await reg.load();
  assert.equal(a.cells.length, 20, `동시 저장에서 ${a.cells.length}건만 남았다`);
  // 저장소에 불량 세포를 직접 심으면 읽기가 격리 투영한다.
  const rawPath = join(dir, 'growth', 'tcells.json');
  const stored = JSON.parse(await readFile(rawPath, 'utf8'));
  stored.cells.push({ id: 'bad', state: 'M4_stable', authority: { allowedInfluence: ['answer_anchor'] } });
  await writeFile(rawPath, JSON.stringify(stored), 'utf8');
  const b = await reg.load();
  const bad = b.cells.find((c) => c.id === 'bad');
  assert.equal(bad.state, 'quarantined', '불량 세포가 정상으로 읽혔다');
  assert.deepEqual(bad.authority.allowedInfluence, ['none']);
});

test('갱신은 기존 항목의 미래 필드를 보존하고, rollback 은 실제 이전 버전을 남긴다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg2f-'));
  const reg = new TCellRegistry(dir);
  await reg.upsert({ ...온전한세포('c1'), 미래확장: '지켜야 함' });
  await reg.upsert(온전한세포('c1')); // 미래확장 없는 갱신
  let a = await reg.load();
  assert.equal(a.cells[0].미래확장, '지켜야 함', '갱신이 미래 필드를 지웠다');
  const r = await reg.rollback('c1');
  assert.equal(r.ok, true);
  a = await reg.load();
  const cell = a.cells.find((c) => c.id === 'c1');
  assert.notEqual(cell.growth.previousVersionId, 'c1', 'previousVersionId 가 자기 자신이다');
  const snap = (cell.versions ?? []).find((v) => v.id === cell.growth.previousVersionId);
  assert.ok(snap, '실제 이전 버전 스냅샷이 없다');
  assert.notEqual(snap.state, 'rolled_back', '스냅샷이 이전 상태를 증명하지 못한다');
  assert.deepEqual(cell.trace.observationRefs, ['obs-1']);
});

test('감사 P2: 문법만 맞고 구조가 깨진 저장소도 격리 경계다(빈 상태 위장 금지)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg2g-'));
  const reg = new TCellRegistry(dir);
  const { mkdir: mkd, readdir } = await import('node:fs/promises');
  await mkd(join(dir, 'growth'), { recursive: true });
  for (const 손상 of ['{"cells":"not-an-array"}', '[1,2,3]', '"문자열"', '{"cells":null}']) {
    await writeFile(join(dir, 'growth', 'tcells.json'), 손상, 'utf8');
    const r = await reg.load();
    assert.equal(r.corrupted, true, `구조 손상이 빈 저장소로 읽혔다: ${손상}`);
    assert.deepEqual(r.cells, []);
  }
  // 쓰기 경로도 덮어쓰지 않고 격리 보존한다.
  await reg.upsert(온전한세포('c1'));
  assert.ok((await readdir(join(dir, 'growth'))).some((f) => f.includes('corrupt')), '구조 손상 바이트가 보존되지 않았다');
  assert.equal((await reg.load()).cells.length, 1);
});

test('감사 추가: 읽기 실패는 파일 없음이 아니다 — 변경 중단, 기존 저장소 보존', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg2h-'));
  const reg = new TCellRegistry(dir);
  await reg.upsert(온전한세포('keep-me'));
  const { chmod } = await import('node:fs/promises');
  const f = join(dir, 'growth', 'tcells.json');
  await chmod(f, 0o000); // 읽을 수 없게
  try {
    await assert.rejects(() => reg.upsert(온전한세포('new')), /읽지 못해/, '읽기 실패인데 변경이 진행됐다');
  } finally { await chmod(f, 0o600); }
  const a = await reg.load();
  assert.deepEqual(a.cells.map((c) => c.id), ['keep-me'], '읽기 실패가 기존 저장소를 덮어썼다');
});
