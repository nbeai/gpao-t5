import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('macOS login bootstrap은 UI를 열지 않고 공통 attach helper를 한 번 실행한다', async () => {
  const source = await readFile(new URL('../scripts/build-macos-installer.mjs', import.meta.url), 'utf8');
  assert.match(source, /Library\/LaunchAgents/u); assert.match(source, /RunAtLoad/u);
  assert.match(source, /ensure-local-runtime\.mjs/u); assert.match(source, /ProcessType[\s\S]*Background/u);
  assert.doesNotMatch(source, /KeepAlive/u);
  assert.match(source, /launchctl bootout/u); assert.match(source, /launchctl bootstrap/u);
});

test('Windows login bootstrap도 Startup에서 UI 없이 공통 attach helper를 실행하고 제거 때 정리한다', async () => {
  const source = await readFile(new URL('../scripts/windows-package-contract.mjs', import.meta.url), 'utf8');
  assert.match(source, /Programs\\Startup/u); assert.match(source, /GPAO-T5 Runtime\.lnk/u);
  assert.match(source, /ensure-local-runtime\.mjs/u); assert.match(source, /WindowStyle = 7/u);
  assert.match(source, /Remove-Item[\s\S]*GPAO-T5 Runtime/u);
});

test('Runtime entry는 gap에서 canonical recovery만 다시 열고 stop receipt 뒤 owner를 해제한다', async () => {
  const source = await readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8');
  assert.match(source, /makeRuntimeContinuityMonitor[\s\S]*resumeQueuedWork[\s\S]*recoverAutomationPublications/u);
  assert.match(source, /runtimeContinuity\.stop[\s\S]*runtimeOwnership\.release/u);
  assert.doesNotMatch(await readFile(new URL('../src/runtime-continuity.js', import.meta.url), 'utf8'),
    /darwin|win32|launchctl|Task Scheduler|SIGTERM|SIGKILL/iu);
});
