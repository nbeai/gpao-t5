import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TurnTiming } from '../src/kernel/l0-evidence/turn-timing.js';
import { TurnTimingStore } from '../src/surface/turn-timing-store.js';

const SESSION = '33333333-3333-4333-8333-333333333333';

function record(n, outcome = 'reply') {
  const id = `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
  let now = 10;
  const timing = new TurnTiming({
    measurementId: id,
    turnRef: { sessionId: SESSION, turnSeq: n },
    surface: 'web',
    clock: () => now,
  });
  now = 12;
  timing.markServer('server_committed');
  return timing.finalize({ outcome, pathClass: 'chat' });
}

async function fixture(opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-timing-'));
  return { dir, store: new TurnTimingStore(dir, opts) };
}

test('엄격한 기록을 원자 저장하고 다시 읽는다', async () => {
  const { store } = await fixture();
  const first = record(1);
  await store.append(first);
  const loaded = await store.load();
  assert.deepEqual(loaded.records, [first]);
});

test('같은 measurementId의 동일 append는 멱등이고 전체 레코드 덮어쓰기는 거부한다', async () => {
  const { store } = await fixture();
  const first = record(1, 'reply');
  const later = { ...first, outcome: 'error' };
  assert.equal((await store.append(first)).inserted, true);
  assert.equal((await store.append(first)).inserted, false, '완전히 같은 기록의 재시도만 멱등');
  await assert.rejects(() => store.append(later), /덮어쓰기|불변/);
  assert.equal((await store.load()).records[0].outcome, 'reply');
});

test('서버 append 뒤 브라우저 3개 사건을 순차 merge하고 각 사건의 두 번째 값은 무시한다', async () => {
  const { store } = await fixture();
  const serverRecord = record(4, 'approval');
  await store.append(serverRecord);

  await store.mergeBrowser(serverRecord.measurementId, {
    event: 'first_feedback_visible', elapsedMs: 2.5, visibilityState: 'visible',
  });
  await store.mergeBrowser(serverRecord.measurementId, {
    event: 'first_grounded_content', elapsedMs: 8, visibilityState: 'visible',
  });
  await store.mergeBrowser(serverRecord.measurementId, {
    event: 'turn_complete', elapsedMs: 13, visibilityState: 'visible',
  });
  const duplicate = await store.mergeBrowser(serverRecord.measurementId, {
    event: 'first_grounded_content', elapsedMs: 9.5, visibilityState: 'hidden',
  });

  assert.equal(duplicate.updated, false, 'browser 사건도 첫 값이 진실이다');
  const merged = (await store.load()).records[0];
  assert.equal(merged.browser.first_feedback_visible, 2.5);
  assert.equal(merged.browser.first_grounded_content, 8);
  assert.equal(merged.browser.turn_complete, 13);
  assert.equal(merged.browser.visibility.first_grounded_content, 'visible');
  assert.equal(merged.outcome, 'approval', '서버가 확정한 outcome은 browser merge가 못 바꾼다');
  assert.equal(merged.pathClass, 'chat', '서버가 확정한 pathClass는 browser merge가 못 바꾼다');
});

test('browser merge는 알려진 사건만 받고 서버 필드·outcome을 섞은 패치를 거부한다', async () => {
  const { store } = await fixture();
  const first = record(5);
  await store.append(first);
  await assert.rejects(() => store.mergeBrowser(first.measurementId, {
    event: 'turn_complete', elapsedMs: 10, visibilityState: 'visible', outcome: 'error',
  }), /허용되지 않은/);
  await assert.rejects(() => store.mergeBrowser('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
    event: 'turn_complete', elapsedMs: 10, visibilityState: 'visible',
  }), /찾지 못/);
});

test('bounded store는 가장 오래된 기록부터 걷는다', async () => {
  const { store } = await fixture({ limit: 2 });
  await store.append(record(1));
  await store.append(record(2));
  await store.append(record(3));
  const loaded = await store.load();
  assert.deepEqual(loaded.records.map((r) => r.turnRef.turnSeq), [2, 3]);
});

test('파싱 손상은 원본 바이트를 격리하고 빈 저장소로 복구한다', async () => {
  const { dir, store } = await fixture({ now: () => 12345 });
  await writeFile(store.file, '{broken-json', 'utf8');
  const loaded = await store.load();
  assert.equal(loaded.corrupted, true);
  assert.deepEqual(loaded.records, []);
  const files = await readdir(dir);
  assert.ok(files.includes('turn-timings.json.corrupt-12345'));
  await store.append(record(1));
  assert.equal((await store.load()).records.length, 1, '격리 뒤 새 기록은 정상 지속한다');
});

test('스키마가 오염된 파일도 손상으로 격리하고 append 입력도 거부한다', async () => {
  const { dir, store } = await fixture({ now: () => 999 });
  await writeFile(store.file, JSON.stringify({ schemaVersion: 1, records: [{ prompt: '비밀' }] }), 'utf8');
  const loaded = await store.load();
  assert.equal(loaded.corrupted, true);
  assert.ok((await readdir(dir)).includes('turn-timings.json.corrupt-999'));

  assert.throws(
    () => store.append({ ...record(2), toolArgs: { path: '/Users/person/secret' } }),
    /허용되지 않은/,
  );
});
