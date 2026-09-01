import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('macOS Audio Reality helper는 AVFoundation·AudioToolbox의 read-only facts만 반환한다', async () => {
  const [source, build, start] = await Promise.all([
    readFile(new URL('../native/macos-audio-reality.swift', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/build-macos-installer.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(source, /import AVFoundation/u); assert.match(source, /import AudioToolbox/u);
  assert.match(source, /AVURLAssetPreferPreciseDurationAndTimingKey/u);
  assert.match(source, /kAudioFilePropertyFileFormat/u);
  assert.match(source, /t5\.audio-reality\.v1/u);
  assert.doesNotMatch(source, /URLSession|Network|transcript|Whisper|write\(to:/u);
  assert.match(build, /buildAudioRealityHelper/u); assert.match(build, /t5-macos-audio-reality/u);
  assert.match(build, /arm64-apple-macos13\.0/u); assert.match(build, /x86_64-apple-macos13\.0/u);
  assert.match(start, /T5_AUDIO_REALITY_HELPER/u); assert.match(start, /makeAudioRealityProbe/u);
});
