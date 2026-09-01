import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Whisper host는 exact upstream archive에서 macOS·Windows package에 static build된다', async () => {
  const [material, mac, windows, start] = await Promise.all([
    readFile(new URL('../config/whisper-helper-material.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../scripts/build-macos-installer.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/build-windows-package.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8'),
  ]);
  assert.equal(material.schema, 't5.whisper-helper-material.v1');
  assert.match(material.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.match(material.sourceArchive.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(material.sourceArchive.bytes, 9136244);
  for (const source of [mac, windows]) {
    assert.match(source, /T5_WHISPER_SOURCE_ARCHIVE/u);
    assert.match(source, /Whisper source archive identity changed/u);
    assert.match(source, /BUILD_SHARED_LIBS=OFF/u);
    assert.match(source, /whisper-cli/u);
  }
  assert.match(mac, /CMAKE_OSX_ARCHITECTURES=arm64;x86_64/u);
  assert.match(windows, /t5-whisper-host\.exe/u);
  assert.match(start, /T5_WHISPER_HOST/u); assert.match(start, /AuditoryModelStore/u);
  assert.match(start, /makeWhisperHostQualifier/u);
});
