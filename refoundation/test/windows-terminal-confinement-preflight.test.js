import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Windows confinement preflight는 현재 passthrough를 PASS로 꾸미지 않고 AppContainer 물리 blocker를 보존한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s6-wp0-windows-terminal-confinement-design-2026-08-31.json', import.meta.url,
  ), 'utf8'));
  const source = await readFile(new URL('../src/terminal-platform-adapter.js', import.meta.url), 'utf8');
  assert.equal(evidence.status, 'DESIGN_BOUNDARY_COMPLETE_PHYSICAL_BLOCKER_RETAINED');
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.currentTruth.qualified, false);
  assert.equal(evidence.currentTruth.declaredTargetPhysicalWriteBlock, false);
  assert.equal(evidence.currentTruth.sandboxFirstClaimed, false);
  assert.equal(evidence.officialCandidates.find((item) => item.name === 'AppContainer')?.status,
    'PRIMARY_CANDIDATE');
  assert.match(source, /platform_passthrough[\s\S]*qualified: false/u);
  assert.ok(evidence.physicalCountertests.includes('network denied'));
  assert.match(evidence.decision, /Do not implement an unverified third confinement mechanism/u);
});
