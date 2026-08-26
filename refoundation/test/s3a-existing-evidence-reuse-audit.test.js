import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const evidenceRoot = new URL('refoundation/evidence/', root);
const auditPath = new URL('s3-a-existing-evidence-reuse-audit-2026-08-26.json', evidenceRoot);
const load = async () => JSON.parse(await readFile(auditPath, 'utf8'));

test('S3-A 기존 증거 감사는 열 coverage를 빠뜨리지 않고 새 전체 재실행을 만들지 않는다', async () => {
  const audit = await load();
  assert.equal(audit.coverage.length, 10);
  assert.equal(new Set(audit.coverage.map((item) => item.id)).size, 10);
  assert.equal(audit.summary.coverageWithExistingEvidence, 10);
  assert.equal(audit.summary.coverageRequiringImmediateFullRerun, 0);
  assert.equal(audit.summary.fixedNewRunCount, null);
  assert.equal(audit.method.fullFactorial, false);
});

test('S3-A 재사용 감사는 aggregate evidence를 phase truth로 승격하지 않는다', async () => {
  const audit = await load();
  assert.equal(audit.summary.coverageWithPhaseCompleteCurrentEvidence, 0);
  assert.ok(audit.phaseReuseConclusion.directlyReusable.includes('purpose outcome'));
  for (const phase of [
    'state read/replay', 'context compilation', 'provider queue/network',
    'model generation', 'surface publication', 'background causal interference',
  ]) assert.ok(audit.phaseReuseConclusion.notDirectlyReusable.includes(phase));
  assert.match(audit.phaseReuseConclusion.reason, /Residual subtraction is forbidden/u);
});

test('S3-A 감사가 인용한 기존 evidence digest는 현재 파일과 일치한다', async () => {
  const audit = await load();
  for (const [name, expected] of Object.entries(audit.sourceDigests)) {
    const actual = createHash('sha256').update(await readFile(new URL(name, evidenceRoot))).digest('hex');
    assert.equal(actual, expected, name);
  }
  assert.deepEqual(audit.minimalNewMeasurementOrder.map((item) => item.journey), [
    'S1', 'S6', 'S7', 'S2', 'S4', 'S5', 'S3',
  ]);
});
