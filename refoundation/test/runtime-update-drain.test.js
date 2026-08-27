import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('macOS update와 uninstall은 강제 kill 대신 기존 Runtime drain 성공 뒤에만 교체한다', async () => {
  const source = await readFile(new URL('../scripts/build-macos-installer.mjs', import.meta.url), 'utf8');
  assert.match(source, /stop-local-runtime\.mjs[\s\S]*--reason product_update[\s\S]*\|\| exit 1/u);
  assert.match(source, /--reason product_uninstall[\s\S]*앱을 지우지 않았습니다/u);
  assert.match(source, /elif[\s\S]*pgrep -x[\s\S]*tell application id[\s\S]*pgrep -x[^\n]*&& exit 1/u);
  assert.doesNotMatch(source, /kill -9|SIGKILL/u);
});

test('Windows update와 uninstall도 drain 실패 시 교체를 닫고 successor를 연다', async () => {
  const source = await readFile(new URL('../scripts/windows-package-contract.mjs', import.meta.url), 'utf8');
  assert.match(source, /--reason product_update[\s\S]*LASTEXITCODE[\s\S]*could not be drained/u);
  assert.match(source, /Start-Process -FilePath/u);
  assert.match(source, /--reason product_uninstall/u);
  assert.doesNotMatch(source, /Stop-Process -Force/u);
});

test('공통 stop helper는 health 소실만으로 완료하지 않고 exact port fact 해제까지 기다린다', async () => {
  const source = await readFile(new URL('../src/local-runtime-lifecycle.js', import.meta.url), 'utf8');
  assert.match(source, /await lstat\(portFile\)[\s\S]*ENOENT[\s\S]*stopped: true/u);
  assert.match(source, /T5_RUNTIME_STOP_TIMEOUT/u);
});
