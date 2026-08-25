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
  assert.doesNotMatch(source, /NSWindow\s*\(/u);
});

test('native helper OCR은 expected marker를 입력받지 않고 bounded text만 일회 출력한다', () => {
  assert.match(source, /CommandLine\.arguments\.count == 3/u);
  assert.match(source, /maximumOCRCharacters = 8_192/u);
  assert.match(source, /VNRecognizeTextRequest/u);
  assert.doesNotMatch(source, /expectedMarker|glyphMarker/u);
});

test('macOS package build는 arm64·x86_64 helper를 universal runtime binary로 포함한다', () => {
  assert.match(build, /arm64-apple-macos13\.0/u);
  assert.match(build, /x86_64-apple-macos13\.0/u);
  assert.match(build, /run\('lipo'/u);
  assert.match(build, /t5-docx-page-renderer/u);
  assert.match(build, /buildDocxPageRenderer\(work, runtimeBin\)/u);
});
