import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('macOS helper는 FSEvents file events만 JSON metadata로 내고 파일 내용을 읽지 않는다', async () => {
  const source = await readFile(new URL('../native/macos-file-activity.c', import.meta.url), 'utf8');
  assert.match(source, /FSEventStreamCreate/u);assert.match(source,/kFSEventStreamCreateFlagFileEvents/u);
  assert.match(source,/st_dev/u);assert.match(source,/st_ino/u);
  assert.doesNotMatch(source,/fopen|fread|read\(|SHA|content|excerpt|xattr/u);
});

test('macOS와 Windows adapter는 같은 ledger를 쓰되 현재 OS 밖 native PASS를 만들지 않는다', async () => {
  const source = await readFile(new URL('../src/file-activity-platform-adapters.js', import.meta.url), 'utf8');
  assert.match(source,/process\.platform !== platform/u);assert.match(source,/macos_fsevents/u);
  assert.match(source,/windows_usn/u);assert.match(source,/rescan_required/u);
  assert.match(source,/const exit = new Promise[\s\S]*once\('close'/u);
  assert.match(source,/const code=await exit/u);
  assert.match(source,/pending\.length>=128/u);assert.match(source,/setTimeout[\s\S]*100/u);
  assert.doesNotMatch(source,/WSL|linux/u);
});
