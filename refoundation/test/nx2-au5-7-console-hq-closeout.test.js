import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const evidence = JSON.parse(readFileSync(new URL('../evidence/nx2-au5-7-console-hq-2026-09-01.json', import.meta.url), 'utf8'));

test('NX2-4 Auditory closeout은 세 실제 목적·Stop·교정·성능을 macOS 제품 범위에서 닫는다', () => {
  assert.equal(evidence.status, 'NX2_4_AUDITORY_COMPLETE_MACOS_WINDOWS_PHYSICAL_DEFERRED_NOT_WAIVED');
  assert.equal(evidence.actualConsole.quickAudio.modelPollingCalls, 0);
  assert.equal(evidence.actualConsole.quickAudio.duplicateCompletion, 0);
  assert.equal(evidence.actualConsole.longMeeting.decisionOwnerDeadlineResult, true);
  assert.equal(evidence.actualConsole.videoSubtitle.sourceUnchanged, true);
  assert.equal(evidence.actualConsole.localFile.terminalFallbackCalls, 0);
  assert.equal(evidence.actualConsole.correction.sameArtifactFamily, true);
  assert.equal(evidence.actualConsole.stop.lateArtifactCount, 0);
  assert.equal(evidence.actualConsole.stop.orphanProcessCount, 0);
  assert.equal(evidence.verification.failed, 0);
});

test('Auditory closeout은 고유명사·Telegram·Windows의 미실행을 성공으로 꾸미지 않는다', () => {
  assert.equal(evidence.accuracyBoundary.perfectWordAccuracyClaimed, false);
  assert.equal(evidence.channels.telegramExternalAccountActual, false);
  assert.equal(evidence.platform.windowsPhysical, 'NOT_RUN');
  assert.equal(evidence.platform.windowsState, 'DEFERRED_NOT_WAIVED');
  assert.ok(evidence.nonClaims.length >= 4);
});
