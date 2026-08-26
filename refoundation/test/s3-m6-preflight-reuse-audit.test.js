import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/s3-m6-preflight-reuse-audit-2026-08-27.json', import.meta.url,
), 'utf8'));

test('M6 preflight는 기존 Learning 증거를 재사용·부분·누락으로 나누고 Gate를 열지 않는다', () => {
  assert.equal(evidence.status, 'PREPARED_GATE_CLOSED');
  assert.equal(evidence.m6GateOpened, false);
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.focusedVerification.passed, 28);
  assert.ok(evidence.reusableEvidence.some((item) => item.requirement === 'independent field Work'));
  assert.ok(evidence.partialEvidence.some((item) => item.requirement === 'background foreground noninterference'));
  assert.ok(evidence.missingEvidence.some((item) => item.requirement === 'Reflection shadow contract'));
});

test('M6 preflight는 external managed Skill을 내부 Principle/Skill로 승격하지 않는다', () => {
  assert.equal(evidence.incompatibleExistingTarget.state, 'must_not_promote_as_m6');
  assert.match(evidence.incompatibleExistingTarget.currentBehavior, /managed SKILL\.md/u);
  assert.match(evidence.incompatibleExistingTarget.m6Requirement, /S3-CA/u);
  assert.equal(evidence.backgroundPerformanceRequirement.currentlySatisfied, false);
  assert.ok(evidence.notClaimed.includes('S3-M6 Gate opened'));
});

test('M6 preflight source digest는 exact blocked head와 일치한다', async () => {
  assert.equal(evidence.sourceCommit, '2fe6f2fe898d02d3f910c000811c1b7042713f1d');
  for (const [path, expected] of Object.entries(evidence.sourceDigests)) {
    const bytes = await readFile(new URL(`../../${path}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, path);
  }
});
