import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { makeMacOSSpotlightDriver } from '../src/macos-spotlight-driver.js';

test('Spotlight driver는 named index와 bounded JSON protocol만 helper에 보낸다', async () => {
  const calls = []; const driver = makeMacOSSpotlightDriver({ indexName: 'T5Qualification',
    invoke: async (payload) => { calls.push(payload); return payload.operation === 'available'
      ? { ok: true, available: true } : payload.operation === 'list'
        ? { ok: true, items: [] } : { ok: true }; } });
  assert.equal(await driver.available(), true);
  await driver.index([{ identifier: 't5.memory.one' }], { domain: 't5.life-continuity.memory' });
  await driver.delete(['t5.memory.one'], { domain: 't5.life-continuity.memory' });
  await driver.list({ domain: 't5.life-continuity.memory' });
  assert.deepEqual(calls.map((item) => item.operation), ['available', 'index', 'delete', 'list']);
  assert.ok(calls.every((item) => item.indexName === 'T5Qualification'));
  await assert.rejects(driver.delete(['../../outside'], { domain: 't5.life-continuity.memory' }), /identifier/u);
});

test('native helper는 custom index·exact identifier delete·query readback을 사용한다', async () => {
  const source = await readFile(new URL('../native/macos-memory-spotlight.swift', import.meta.url), 'utf8');
  const build = await readFile(new URL('../scripts/build-macos-installer.mjs', import.meta.url), 'utf8');
  const verify = await readFile(new URL('../scripts/verify-macos-installer.mjs', import.meta.url), 'utf8');
  assert.match(source, /CSSearchableIndex\(name: request\.indexName\)/u);
  assert.match(source, /indexSearchableItems/u);
  assert.match(source, /deleteSearchableItems\(withIdentifiers:/u);
  assert.match(source, /CSSearchQuery\(queryString:/u);
  assert.doesNotMatch(source, /CSSearchableIndex\.default/u);
  assert.match(build, /buildMemorySpotlightHelper\(work, runtimeBin\)/u);
  assert.match(build, /t5-memory-spotlight/u);
  assert.match(verify, /Memory Spotlight helper is not universal/u);
});

test('macOS qualification은 synthetic Spotlight를 정리하고 EventKit 실제 쓰기를 M7과 분리한다', async () => {
  const runner = await readFile(new URL('../scripts/run-s3m5-macos-native-surface-qualification.mjs', import.meta.url), 'utf8');
  assert.match(runner, /userData: false/u);
  assert.match(runner, /driver\.delete\(\[identifier\]/u);
  assert.match(runner, /exactIdentifierAbsent/u);
  assert.match(runner, /EventKit actual write requires the signed installed product/u);
  assert.match(runner, /calendarWrites: 0, reminderWrites: 0/u);
});
