import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const evidence = JSON.parse(readFileSync(new URL('../evidence/nx2-wc0-web-collector-baseline-2026-09-01.json', import.meta.url), 'utf8'));

test('WC-0은 정확한 사용자 결과와 비경제적·미소유 네트워크 실행을 분리한다', () => {
  assert.equal(evidence.status, 'WC0_COMPLETE_WC1_OPEN');
  assert.equal(evidence.actualConsoleBaseline.rows, 60);
  assert.equal(evidence.actualConsoleBaseline.missingCells, 0);
  assert.equal(evidence.actualConsoleBaseline.duplicateRecords, 0);
  assert.equal(evidence.actualConsoleBaseline.duplicateNetworkCollection, true);
  assert.equal(evidence.actualConsoleBaseline.unownedNetworkReceipt, true);
  assert.equal(evidence.firstFailure.family, 'collection_execution_ownership');
});

test('upstream crawler는 검증 원리만 흡수하고 별도 Browser·설치 플랫폼은 제품에 넣지 않는다', () => {
  assert.equal(evidence.upstreamCandidate.commit, 'c64cfbf98c3d72054e2960affd663726f4e9d7f6');
  assert.equal(evidence.upstreamCandidate.license, 'MIT');
  assert.equal(evidence.upstreamCandidate.productImport, 0);
  assert.ok(evidence.upstreamCandidate.notAdopted.includes('separate Chromium Playwright Scrapling Patchright and agent-browser runtime'));
  assert.ok(evidence.nextCandidate.forbidden.includes('second Browser reality'));
  assert.equal(evidence.platform.windowsPhysical, 'DEFERRED_BY_OWNER');
  assert.equal(evidence.productSourceChanges, 0);
});
