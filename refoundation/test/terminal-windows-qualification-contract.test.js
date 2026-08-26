import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

test('Windows Terminal Gate는 Linux·WSL 복제 없이 GitHub runner와 격리 VM을 분리한다', async () => {
  const value = JSON.parse(await readFile(new URL(
    'refoundation/config/s3-terminal-windows-qualification.json', root,
  ), 'utf8'));
  assert.deepEqual(value.targetPlatforms, ['darwin', 'win32']);
  assert.deepEqual(value.nonTargetPlatforms, ['linux']);
  assert.equal(value.wsl2.productRuntime, false);
  assert.equal(value.githubWindowsRunner.required.some((item) => /grandchild cancellation/u.test(item)), true);
  assert.equal(value.isolatedWindowsVm.requiredBeforeHumanProductPass.some((item) => /Terra and gpt-5.5/u.test(item)), true);
  assert.equal(value.completion.githubRunnerPass, true);
  assert.equal(value.completion.windowsRuntimeComplete, true);
  assert.equal(value.completion.windowsHumanModelSurfacePass, false);
  assert.equal(value.completion.verdict, 'PASS_WITH_OBSERVATION');
});

test('Windows CI는 MSVC Job host·DPAPI·ConPTY 실제 시험을 모두 실행한다', async () => {
  const workflow = await readFile(new URL('.github/workflows/ci.yml', root), 'utf8');
  assert.match(workflow, /macos-product:[\s\S]*runs-on: macos-15/u);
  assert.match(workflow, /Verify macOS Core[\s\S]*refoundation:doctor[\s\S]*refoundation:boundary/u);
  assert.match(workflow, /--test-concurrency=1 --test-force-exit refoundation\/test\/\*\.test\.js/u);
  assert.match(workflow, /Verify macOS product integrations[\s\S]*refoundation:integration/u);
  assert.match(workflow, /Verify macOS mutation smoke[\s\S]*refoundation:mutation/u);
  assert.doesNotMatch(workflow, /runs-on: ubuntu-/u);
  assert.match(workflow, /windows-terminal:[\s\S]*runs-on: windows-latest/u);
  assert.match(workflow, /cl\.exe \/nologo \/W4 \/WX/u);
  assert.match(workflow, /vcvarsamd64_arm64\.bat/u);
  assert.match(workflow, /windows-dpapi-secret-store\.test\.js/u);
  assert.match(workflow, /terminal-windows\.integration\.js/u);
  assert.match(workflow, /--test-timeout=20000/u);
  assert.match(workflow, /--test-force-exit refoundation\/test\/terminal-windows\.integration\.js/u);
});
