import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/macos-search-dock-repair-2026-08-28.json', import.meta.url,
), 'utf8'));

test('macOS 설치 경험 수리는 일반 파일 검색과 앱 데이터 접근을 분리한다', () => {
  assert.equal(evidence.status, 'SOURCE_REPAIRED_INSTALLER_REQUALIFICATION_REQUIRED');
  assert.equal(evidence.repairs.defaultWholeHomeRootRemoved, true);
  assert.equal(evidence.repairs.customTopLevelUserFoldersPreserved, true);
  assert.match(evidence.repairs.ordinaryFileSearchRoots[0], /excluding Library/u);
  assert.equal(evidence.repairs.protectedLibraryPackages.includes('.photoslibrary'), true);
});

test('Dock 상주·재열기·종료와 background identity를 서로 다른 사실로 보존한다', () => {
  assert.equal(evidence.repairs.regularAppRemainsInDock, true);
  assert.equal(evidence.repairs.dockReopenUsesExistingConsole, true);
  assert.equal(evidence.repairs.explicitAppQuitStopsLocalRuntime, true);
  assert.equal(evidence.repairs.backgroundModeDockVisible, false);
  assert.match(evidence.repairs.backgroundEntryExecutable, /^GPAO-T5/u);
  assert.ok(evidence.notClaimed.some((item) => item.includes('physical Dock persistence')));
});
