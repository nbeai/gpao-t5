import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidenceUrl = new URL('../evidence/s6-wp0-windows-prephysical-baseline-2026-08-31.json', import.meta.url);

test('WP0 baseline은 source HQ 기준선과 Windows physical 비주장을 함께 고정한다', async () => {
  const evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(evidence.status, 'READ_ONLY_BASELINE_COMPLETE_REPAIR_FAMILIES_OPEN');
  assert.equal(evidence.sourceCommit, '7a47f69afb1480c887d7bf641dad062c584e28f9');
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.physicalWindowsPassClaimed, false);
  assert.equal(evidence.windowsInstallerBuilt, false);
  assert.ok(evidence.featureAdapterMatrix.length >= 20);
  assert.ok(evidence.prePhysicalFindings.length >= 8);
});

test('WP0 baseline은 당시 공개 blocker와 현재 남은 source 경계를 분리한다', async () => {
  const [evidence, entry, terminal, program, ocr, renderer] = await Promise.all([
    readFile(evidenceUrl, 'utf8').then(JSON.parse),
    readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/terminal-platform-adapter.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/console-server.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/local-image-ocr.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/docx-visual-renderer.js', import.meta.url), 'utf8'),
  ]);
  const families = new Set(evidence.prePhysicalFindings.map((item) => item.family));
  for (const family of ['windows_package_version_truth', 'windows_default_file_scope',
    'windows_terminal_confinement', 'windows_g_program_admission', 'windows_ocr',
    'windows_document_render']) assert.ok(families.has(family), family);
  assert.equal(evidence.sourceDigests['refoundation/scripts/build-windows-package.mjs'],
    '64363f6bcdf41cf96df6f484851782ee71fb58fb73ff493b414a0dbd0f5053d6');
  assert.equal(evidence.prePhysicalFindings.find((item) => item.id === 'WP0-F2')?.fact,
    'start-console uses the drive root for non-darwin standard computer roots');
  assert.match(terminal, /platform_passthrough[\s\S]*qualified: false/u);
  assert.match(program, /computer\.platform === 'darwin'[\s\S]*programExecutionAdapter/u);
  assert.match(ocr, /platform !== 'darwin'[\s\S]*local_image_ocr_not_qualified/u);
  assert.match(renderer, /platform !== 'darwin'[\s\S]*docx_all_page_renderer_not_qualified/u);
});

test('WP0 baseline은 과거 runner 성공과 current-head·physical 실행을 합치지 않는다', async () => {
  const evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(evidence.baselineVerification.historicalWindowsRunner.x64CompiledAndExecuted, true);
  assert.equal(evidence.baselineVerification.historicalWindowsRunner.arm64Executed, false);
  assert.equal(evidence.baselineVerification.currentHeadWindowsRunner, false);
  assert.equal(evidence.baselineVerification.physicalWindowsX64, false);
  assert.equal(evidence.baselineVerification.physicalWindowsArm64, false);
  assert.ok(evidence.forbiddenClaims.includes('macOS success copied to Windows'));
});
