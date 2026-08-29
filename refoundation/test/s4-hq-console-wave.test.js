import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-HQ Console wave는 A~J와 실제 UI·성능·외부 effect oracle을 실행 전에 고정한다', async () => {
  const value = JSON.parse(await readFile(new URL('../fixtures/s4-hq-console-wave.json', import.meta.url), 'utf8'));
  assert.deepEqual(value.scenarios.map((item) => item.id), [
    'A-direct', 'B-file-discovery', 'C-office-output', 'D-program', 'E-new-project',
    'F-existing-project', 'G-long-correction-UX', 'I-capability-boundary', 'J-channel-positive',
  ]);
  assert.equal(value.surface.entry, 'actual product Console UI');
  assert.equal(value.surface.runnerTurnSubstitutionForbidden, true);
  assert.equal(value.modelPolicy.qualificationDefault, 'gpt-5.5');
  assert.equal(value.modelPolicy.terraFailureIsFourthBlocker, false);
  assert.equal(value.globalOracle.actualExternalWrite, 0);
  assert.equal(value.globalOracle.windows, 'DEFERRED_NOT_WAIVED');
});

test('S4-HQ Console launcher는 computer 파일 관측도 격리 root 밖으로 보내지 않는다', async () => {
  const source = await readFile(new URL('../scripts/launch-s4-hq-console.mjs', import.meta.url), 'utf8');
  assert.match(source, /const root = await realpath\(resolve\(option\('--root'\)/u);
  assert.match(source, /computerFileRoots:\s*\[workspace, home\]/u);
  assert.match(source, /restrictFileRealityToComputerRoots:\s*true/u);
});
