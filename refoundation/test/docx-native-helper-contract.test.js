import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../native/docx-page-renderer.swift', import.meta.url), 'utf8');
const build = await readFile(new URL('../scripts/build-macos-installer.mjs', import.meta.url), 'utf8');

test('native DOCX helper는 visible window·network·JavaScript 없이 local page만 snapshot한다', () => {
  assert.match(source, /setActivationPolicy\(\.prohibited\)/u);
  assert.match(source, /allowsContentJavaScript = false/u);
  assert.match(source, /websiteDataStore = \.nonPersistent\(\)/u);
  assert.match(source, /url\.isFileURL/u);
  assert.match(source, /takeSnapshot/u);
  assert.match(source, /evaluateJavaScript\(domObservationScript\)/u);
  assert.match(source, /overflowElementCount/u);
  assert.match(source, /contrastFailureCount/u);
  assert.doesNotMatch(source, /NSWindow\s*\(/u);
});

test('native helper OCR은 expected marker를 입력받지 않고 bounded text만 일회 출력한다', () => {
  assert.match(source, /CommandLine\.arguments\.count == 3/u);
  assert.match(source, /maximumOCRCharacters = 8_192/u);
  assert.match(source, /VNRecognizeTextRequest/u);
  assert.doesNotMatch(source, /expectedMarker|glyphMarker/u);
});

test('같은 local native helper의 image OCR은 한국어·영어와 bounded 좌표 receipt만 낸다', () => {
  assert.match(source, /--ocr-image/u); assert.match(source, /t5\.local-image-ocr\.v1/u);
  assert.match(source, /recognitionLanguages = \["ko-KR", "en-US"\]/u);
  assert.match(source, /let limit = 200/u); assert.match(source, /candidate\.confidence/u);
  assert.match(source, /observation\.boundingBox/u); assert.match(source, /cgImage\.width <= 12_000/u);
});

test('macOS package build는 arm64·x86_64 helper를 universal runtime binary로 포함한다', () => {
  assert.match(build, /arm64-apple-macos13\.0/u);
  assert.match(build, /x86_64-apple-macos13\.0/u);
  assert.match(build, /run\('lipo'/u);
  assert.match(build, /t5-docx-page-renderer/u);
  assert.match(build, /buildDocxPageRenderer\(work, runtimeBin\)/u);
});
