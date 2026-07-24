import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../src/surface/session-store.js';

async function tmpStore() {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-sess-'));
  return new SessionStore(dir);
}

test('create → id·기본 제목·빈 transcript', async () => {
  const store = await tmpStore();
  const s = await store.create();
  assert.match(s.id, /^[a-f0-9-]{36}$/);
  assert.equal(s.title, '새 대화');
  assert.deepEqual(s.transcript, []);
  assert.deepEqual(s.ledgerEntries, []);
});

test('save/load 왕복 — 파일 지속성', async () => {
  const store = await tmpStore();
  const s = await store.create();
  s.transcript.push({ role: 'user', text: '안녕' });
  s.ledgerEntries.push({ intended: 'x', userSafeSummary: 'ok', failureState: 'none', lifecycle: 'delivered' });
  await store.save(s);
  const loaded = await store.load(s.id);
  assert.equal(loaded.transcript.length, 1);
  assert.equal(loaded.transcript[0].text, '안녕');
  assert.equal(loaded.ledgerEntries.length, 1);
});

test('list는 최근 수정순, 실제 세션만', async () => {
  const store = await tmpStore();
  const a = await store.create();
  const b = await store.create();
  await new Promise((r) => setTimeout(r, 5)); // save 는 Date.now 를 쓰므로 결정적 간격 확보(기존 flaky 수정)
  await store.save(b); // b 가 더 최근
  const list = await store.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].id, b.id, '최근 수정이 먼저');
  assert.ok(a.id); // a 도 목록에 있음(참조 유지)
});

// 감사 보정: 세션 목록은 UUID 세션 파일만 — memory.json 등 다른 저장물이 섞이지 않는다.
test('list는 UUID 세션 파일만 포함(memory.json 등 제외)', async () => {
  const store = await tmpStore();
  const s = await store.create();
  await writeFile(join(store.dir, 'memory.json'), JSON.stringify({ candidates: [], promoted: [] }), 'utf8');
  await writeFile(join(store.dir, 'notes.json'), '{}', 'utf8');
  const list = await store.list();
  assert.equal(list.length, 1, '세션만');
  assert.equal(list[0].id, s.id);
});

// 보안: 클라이언트가 준 id로 경로 탈출이 되면 안 된다.
test('경로 탈출 id는 거부(load는 null, 파일 접근 안 함)', async () => {
  const store = await tmpStore();
  const bad = await store.load('../../../etc/passwd');
  assert.equal(bad, null, '잘못된 id는 조용히 null');
});

// 격리: 두 세션의 transcript·원장이 서로 새지 않는다(P6 격리의 전초).
test('세션 간 격리 — transcript·원장 비혼입', async () => {
  const store = await tmpStore();
  const a = await store.create(); const b = await store.create();
  a.transcript.push({ role: 'user', text: 'A건' }); await store.save(a);
  b.transcript.push({ role: 'user', text: 'B건' }); await store.save(b);
  const la = await store.load(a.id); const lb = await store.load(b.id);
  assert.equal(la.transcript[0].text, 'A건');
  assert.equal(lb.transcript[0].text, 'B건');
  assert.ok(!la.transcript.some((e) => e.text === 'B건'));
});
