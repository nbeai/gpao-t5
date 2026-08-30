import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/s6-p0-j-pre-ux-audit-2026-08-30.json', import.meta.url,
), 'utf8'));

test('P0~J pre-UX 감사는 한 P1 개선과 남은 물리 경계를 분리한다', () => {
  assert.equal(evidence.status, 'COMPLETE_ONE_P1_REPAIR_REMAINING_BOUNDARIES_PRESERVED');
  assert.equal(evidence.gateAudit.length, 9);
  assert.ok(evidence.fileSearchRepair.candidate.wallMs < evidence.fileSearchRepair.baseline.wallMs);
  assert.equal(evidence.fileSearchRepair.candidate.filenameScope,
    evidence.fileSearchRepair.baseline.filenameScope);
  assert.equal(evidence.fileSearchRepair.candidate.contentScope,
    evidence.fileSearchRepair.baseline.contentScope);
  assert.equal(evidence.fileSearchRepair.runtimeMeaningChanged, false);
  assert.equal(evidence.verification.focusedFileAndReveal.failed, 0);
  assert.ok(evidence.gateAudit.some((item) => item.gate === 'S6-I'
    && item.state === 'PHYSICAL_HUMAN_QUALIFICATION_PENDING'));
});
