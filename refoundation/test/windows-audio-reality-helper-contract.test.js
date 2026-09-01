import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Windows Audio Reality helper는 Media Foundation의 read-only stream facts만 반환한다', async () => {
  const [source, build, environment] = await Promise.all([
    readFile(new URL('../native/windows/t5-windows-audio-reality.cpp', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/build-windows-package.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/windows-product-environment.js', import.meta.url), 'utf8'),
  ]);
  assert.match(source, /MFCreateSourceReaderFromURL/u);
  assert.match(source, /MF_PD_DURATION/u); assert.match(source, /GetNativeMediaType/u);
  assert.match(source, /MF_MT_AUDIO_SAMPLES_PER_SECOND/u);
  assert.match(source, /MF_SOURCE_READER_ENABLE_AUDIO_PROCESSING/u);
  assert.match(source, /MFAudioFormat_PCM/u); assert.match(source, /ReadSample/u);
  assert.match(source, /t5\.audio-decode\.v1/u);
  assert.match(source, /t5\.audio-reality\.v1/u);
  assert.doesNotMatch(source, /WinHttp|URLDownload|transcript|Whisper/u);
  assert.match(build, /t5-windows-audio-reality\.cpp/u);
  assert.match(build, /mfplat\.lib.*mfreadwrite\.lib.*mfuuid\.lib/u);
  assert.match(environment, /audio_reality_helper/u);
});
