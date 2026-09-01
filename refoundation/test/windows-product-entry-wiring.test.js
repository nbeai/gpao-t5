import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('제품 entry는 Windows payload를 한 번 해석해 state secret process CH hands에 명시 주입한다', async () => {
  const source=await readFile(new URL('../scripts/start-console.mjs',import.meta.url),'utf8');
  assert.match(source,/resolveWindowsProductEnvironment\(\{ productRoot: option\('--product-root'\) \}\)/u);
  assert.match(source,/windowsProduct\?\.stateDir/u);assert.match(source,/windowsProduct\?\.connectionFile/u);
  assert.match(source,/directory: windowsProduct\.credentialDirectory, program: windowsProduct\.jobCredentialHost/u);
  assert.match(source,/new ManagedProcessRegistry\(\{ platform: computerEnvironment\.platform,[\s\S]*windowsJobHost: windowsProduct\?\.jobCredentialHost/u);
  assert.match(source,/makeWindowsUSNAdapter/u);assert.match(source,/makeWindowsCoarseAppAdapter/u);
  assert.match(source,/windowsHelper: windowsProduct\?\.folderPickerHelper/u);
  assert.match(source,/makeLocalImageOcr\(\{ platform: 'win32', helper: windowsProduct\?\.imageOcrHelper \}\)/u);
  assert.match(source, /makeAudioRealityProbe/u);
  assert.match(source, /platform: 'win32', helper: windowsProduct\.audioRealityHelper/u);
  assert.match(source, /windowsProduct\?\.whisperHost/u);
  assert.match(source, /makeAuditoryCapabilityService/u);
});

test('Windows secret와 process primitive는 ambient host env를 제품 기본값으로 사용하지 않는다', async () => {
  const [secret,processes]=await Promise.all([
    readFile(new URL('../src/windows-dpapi-secret-store.js',import.meta.url),'utf8'),
    readFile(new URL('../src/managed-process.js',import.meta.url),'utf8'),
  ]);
  assert.doesNotMatch(secret,/process\.env\.T5_WINDOWS_JOB_HOST/u);
  assert.doesNotMatch(processes,/process\.env\.T5_WINDOWS_JOB_HOST/u);
  assert.match(secret,/trusted Windows credential host is unavailable/u);
  assert.match(processes,/T5_WINDOWS_JOB_HOST_REQUIRED/u);
});
