import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const url = new URL('../evidence/s3-terminal-windows-github-qualification-2026-08-26.json', import.meta.url);

test('Windows GitHub 증거는 runtime 성공과 인간·sandbox-first 미실행을 분리한다', async () => {
  const value = JSON.parse(await readFile(url, 'utf8'));
  assert.equal(value.verdict, 'PASS_WITH_OBSERVATION');
  assert.equal(value.github.conclusion, 'success');
  assert.equal(value.nativeHosts.x64CompiledAndExecuted, true);
  assert.equal(value.nativeHosts.arm64CrossCompiled, true);
  assert.equal(value.qualified.grandchildLateEffectAfterCancel, 0);
  assert.equal(value.qualified.taskkillTreeFallback, 0);
  assert.equal(value.qualified.currentUserDpapiRoundTrip, true);
  assert.equal(value.qualified.credentialPlaintextOnDisk, 0);
  assert.ok(value.notClaimed.includes('Windows sandbox-first'));
  assert.ok(value.notClaimed.includes('physical Windows UI human qualification'));
});
