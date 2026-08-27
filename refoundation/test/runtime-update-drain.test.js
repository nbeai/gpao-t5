import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('macOS update와 uninstall은 강제 kill 대신 기존 Runtime drain 성공 뒤에만 교체한다', async () => {
  const source = await readFile(new URL('../scripts/build-macos-installer.mjs', import.meta.url), 'utf8');
  assert.match(source, /stop-local-runtime\.mjs[\s\S]*--reason product_update[\s\S]*\|\| exit 1/u);
  assert.match(source, /--reason product_update --timeout-ms 8000/u);
  assert.match(source, /--reason product_uninstall[\s\S]*앱을 지우지 않았습니다/u);
  assert.match(source, /elif[\s\S]*pgrep -x[\s\S]*tell application id[\s\S]*pgrep -x[^\n]*&& exit 1/u);
  assert.doesNotMatch(source, /kill -9|SIGKILL/u);
});

test('macOS package script 안의 update stop은 강제 kill 없이 8초보다 짧은 단계 예산을 사용한다', async () => {
  const source = await readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8');
  assert.match(source, /installerBounded[\s\S]*channel: 1_000[\s\S]*work: 2_000[\s\S]*continuity: 500[\s\S]*resources: 1_500[\s\S]*server: 500/u);
  assert.doesNotMatch(source, /installerBounded[\s\S]{0,500}SIGKILL/u);
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

test('Dock의 명시 종료는 서버와 같은 user_full_stop 이유로 Runtime을 정산한다', async () => {
  const [launcher, lifecycle] = await Promise.all([
    readFile(new URL('../scripts/macos-launcher.m', import.meta.url), 'utf8'),
    readFile(new URL('../src/local-runtime-lifecycle.js', import.meta.url), 'utf8'),
  ]);
  assert.match(launcher, /--reason"\s*,\s*@"user_full_stop/u);
  assert.match(lifecycle, /user_full_stop/u);
  assert.doesNotMatch(launcher, /user_quit/u);
});
