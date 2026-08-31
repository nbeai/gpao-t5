import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = async (name) => JSON.parse(await readFile(new URL(`../evidence/${name}`, import.meta.url), 'utf8'));

test('Windows G design은 confinement 없이 product admission을 열지 않는다', async () => {
  const value = await evidence('s6-wp0-windows-g-program-design-2026-08-31.json');
  const source = await readFile(new URL('../src/console-server.js', import.meta.url), 'utf8');
  assert.equal(value.status, 'DEPENDENCIES_MAPPED_PRODUCT_ADMISSION_CLOSED');
  assert.equal(value.productChanges, 0);
  assert.match(source, /computer\.platform === 'darwin'[\s\S]*programExecutionAdapter/u);
  assert.match(value.decision, /Keep G unavailable on Windows/u);
});

test('Windows document render design은 common Preview와 native all-page gap을 합치지 않는다', async () => {
  const value = await evidence('s6-wp0-windows-document-render-design-2026-08-31.json');
  assert.equal(value.currentTruth.docxTextAndTables, 'COMMON_CORE_COMPLETE');
  assert.equal(value.currentTruth.consoleDocumentPreview, 'COMMON_CORE_COMPLETE');
  assert.equal(value.currentTruth.docxAllPagePixelQualification, 'MACOS_ONLY');
  assert.equal(value.currentTruth.windowsNativeRenderer, 'NOT_IMPLEMENTED');
  assert.equal(value.candidates.find((item) => item.name === 'Microsoft Word COM')?.state,
    'POSITIVE_CONTROL_ONLY');
});

test('POSIX audit은 repaired와 runner physical blocker를 분리하고 연구 기능을 열지 않는다', async () => {
  const value = await evidence('s6-wp0-posix-assumption-audit-2026-08-31.json');
  assert.equal(value.status, 'COMPLETE_FINDINGS_ROUTED');
  assert.ok(value.classifications.shared_core_defects_repaired.length >= 6);
  assert.ok(value.classifications.runner_required.length >= 4);
  assert.ok(value.classifications.physical_required.includes('AppContainer confinement'));
  assert.ok(value.notOpened.includes('Computer Use'));
  assert.ok(value.notOpened.includes('Method Runtime'));
});
