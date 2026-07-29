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

test('legacy adapter: 기존 memory.json 무변경 읽기 + M4 로 과장되지 않음 + 검증 통과', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg2a-'));
  const memPath = join(dir, 'memory.json');
  const 원본 = JSON.stringify({ candidates: [], promoted: [{ id: 'p1', statement: '보고서는 목록으로', kind: 'preference', userConfirmed: true }], observed: [], closed: {} });
  await writeFile(memPath, 원본, 'utf8');
  const memory = JSON.parse(await readFile(memPath, 'utf8'));
  const cells = importLegacyMemory(memory);
  assert.equal(cells.length, 1);
  // 사용자 승인은 성숙도가 아니다 — replay 전이므로 M1 후보로만 들어온다(M4 과장 금지).
  assert.equal(cells[0].state, 'M1_candidate');
  assert.ok(!['M3_limited', 'M4_stable', 'M5_compressed'].includes(cells[0].state));
  assert.deepEqual(cells[0].authority.allowedInfluence, ['none']);
  assert.deepEqual(cells[0].trace.observationRefs, ['memory:promoted:p1']);
  assert.equal(validateTCell(cells[0]).ok, true, 'legacy 세포가 계약 검증을 못 지난다');
  // 읽기 전용: 원본 바이트 그대로.
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
