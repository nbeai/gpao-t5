import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidenceUrl = new URL('../evidence/s6-ng5-dr0-document-reality-baseline-2026-08-31.json', import.meta.url);

test('NG5 DR-0은 현재 문서·source·Artifact 기반의 강점과 mixed packet 비주장을 분리한다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.existingCapabilities.pdfExactPageHandleReopen, true);
  assert.equal(value.existingCapabilities.xlsxSheetRowCellFormulaObservation, true);
  assert.equal(value.existingCapabilities.csvTsvWholeRowReconciliation, true);
  assert.equal(value.currentGaps.mixedPdfXlsxImagePacketThreePurposeActual, false);
  assert.equal(value.currentGaps.commonClaimToSourceProjection, false);
  assert.equal(value.productChanges, 0);
});

test('NG5 DR-0은 최초 원인 가족 전 Method Runtime·새 문서 Store·전문 판정을 열지 않는다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.causeNotYetKnown.length, 6);
  assert.equal(value.firstActualPurposesRequired.length, 3);
  for (const name of ['new document platform', 'DocumentPacket Store',
    'Method Runtime', 'external Document AI']) assert.ok(value.notOpened.includes(name), name);
  assert.match(value.openingRule, /first repeated cause family/u);
});
