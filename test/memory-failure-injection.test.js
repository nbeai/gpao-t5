// P-OP-4 · **기억 이중 기록 경계에 실패를 주입한다** (감사 지정 첫 대상, 2026-07-29).
//
// 상태 저장(memory.json)과 수명주기 원장(memory-ledger.json)은 별도 파일 작업이다.
// 그 틈에서 날 수 있는 것: 반쪽 성공(상태만 저장), 원장 손상, 동시 확인·철회의 경합,
// 재시도의 중복 승격·중복 영수증, 그리고 화면·상태·원장이 서로 다른 결론을 내는 것.
// 계약: **상태가 행동의 진실**이고, 원장 실패는 성공한 행동을 실패로 둔갑시키지 않되
// 조용히 넘기지도 않는다(receiptWritten:false). 손상은 바이트를 잃지 않고 격리한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { MemoryStore, MemoryLedger } from '../src/surface/memory-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const 후보 = (id, statement) => ({ candidateId: id, kind: 'preference', statement, userConfirmed: false, rollbackable: true });

async function boot(opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-fi-'));
  const memoryStore = opts.memoryStore ?? new MemoryStore(dir);
  const memoryLedger = opts.memoryLedger ?? new MemoryLedger(dir);
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools(), memoryStore, memoryLedger });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  return { dir, base, post, server, close: () => new Promise((r) => server.close(r)) };
}

// ── 주입 1: 상태 저장 성공 + 원장 기록 실패 ─────────────────────────────
test('원장이 죽어도 승격은 성공이고, 영수증이 빠진 사실은 응답에 남는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-fi1-'));
  const 죽은원장 = { async append() { throw new Error('disk full'); }, async load() { return { entries: [] }; } };
  const { base, post, close } = await boot({ memoryStore: new MemoryStore(dir), memoryLedger: 죽은원장 });
  try {
    const mem = new MemoryStore(dir);
    await mem.save({ candidates: [후보('c1', '목록으로')], promoted: [], observed: [] });
    const r = await (await post('/memory/confirm', { candidateId: 'c1' })).json();
    assert.equal(r.ok, true, '상태 저장이 성공했는데 행동을 실패로 보고했다');
    assert.equal(r.receiptWritten, false, '영수증이 빠졌는데 응답이 조용하다');
    // 화면(투영)·상태가 같은 결론: 승격 1.
    const um = await (await fetch(`${base}/user-model`)).json();
    assert.equal(um.operatingPreferences.filter((x) => x.admitted).length, 1);
    assert.equal((await mem.load()).promoted.length, 1);
  } finally { await close(); }
});

test('상태 저장이 실패하면 아무 일도 없던 것이다 — 영수증 0 · 재시도로 정확히 1회 승격', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-fi2-'));
  const real = new MemoryStore(dir);
  let 실패남음 = 1;
  const 불안정저장 = {
    dir,
    load: () => real.load(),
    save: (m) => { if (실패남음 > 0) { 실패남음 -= 1; throw new Error('write failed'); } return real.save(m); },
  };
  const { base, post, close } = await boot({ memoryStore: 불안정저장 });
  try {
    await real.save({ candidates: [후보('c1', '목록으로')], promoted: [], observed: [] });
    const r1 = await post('/memory/confirm', { candidateId: 'c1' });
    assert.equal(r1.status, 500, '저장이 실패했는데 성공처럼 응답했다');
    // 상태 불변 · 영수증 0 — 실패한 행동의 흔적이 진실을 앞지르지 않는다.
    assert.equal((await real.load()).promoted.length, 0);
    const l0 = await (await fetch(`${base}/memory/ledger`)).json();
    assert.equal(l0.entries.length, 0, '실패한 행동에 영수증이 남았다');
    // 재시도 → 정확히 1회 승격 + 1건 영수증.
    const r2 = await (await post('/memory/confirm', { candidateId: 'c1' })).json();
    assert.equal(r2.ok, true);
    assert.equal((await real.load()).promoted.length, 1);
    const l1 = await (await fetch(`${base}/memory/ledger`)).json();
    assert.deepEqual(l1.entries.map((e) => e.event), ['confirmed']);
  } finally { await close(); }
});

// ── 주입 2: 원장 손상 ────────────────────────────────────────────────────
test('손상된 원장은 조용히 사라지지 않는다 — 격리 보존 후 새로 시작', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-fi3-'));
  const ledger = new MemoryLedger(dir);
  await writeFile(join(dir, 'memory-ledger.json'), '{"entries":[{"ev', 'utf8'); // 기록 도중 끊긴 반 토막
  // 읽기는 손상 사실을 말한다(빈 원장인 척 금지).
  assert.equal((await ledger.load()).corrupted, true);
  await ledger.append('proposed', 후보('c9', '새 항목'));
  // 손상 바이트는 격리 파일로 보존됐고, 새 원장은 새 항목만 담는다.
  const files = await readdir(dir);
  const 격리 = files.find((f) => f.startsWith('memory-ledger.json.corrupt-'));
  assert.ok(격리, `손상 파일이 보존되지 않았다: ${files}`);
  assert.equal(await readFile(join(dir, 격리), 'utf8'), '{"entries":[{"ev');
  const after = await ledger.load();
  assert.equal(after.corrupted, undefined);
  assert.deepEqual(after.entries.map((e) => e.event), ['proposed']);
});

// ── 주입 3·4: 동시 확인·철회 / 재시도 멱등성 ────────────────────────────
test('같은 후보에 확인이 동시에 두 번 — 승격 1 · 영수증 1', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-fi4-'));
  const { base, post, close } = await boot({ memoryStore: new MemoryStore(dir) });
  try {
    const mem = new MemoryStore(dir);
    await mem.save({ candidates: [후보('c1', '목록으로')], promoted: [], observed: [] });
    const [a, b] = await Promise.all([
      post('/memory/confirm', { candidateId: 'c1' }).then((r) => r.json()),
      post('/memory/confirm', { candidateId: 'c1' }).then((r) => r.json()),
    ]);
    assert.equal(a.ok, true); assert.equal(b.ok, true);
    assert.ok(a.already || b.already, '둘 다 새 승격으로 처리됐다(경합)');
    const after = await mem.load();
    assert.equal(after.promoted.length, 1, `중복 승격: ${after.promoted.length}`);
    const l = await (await fetch(`${base}/memory/ledger`)).json();
    assert.deepEqual(l.entries.map((e) => e.event), ['confirmed'], `중복 영수증: ${JSON.stringify(l.entries)}`);
  } finally { await close(); }
});

test('확인과 철회가 거의 동시에 — 끝 상태와 원장이 하나의 이야기를 한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-fi5-'));
  const { base, post, close } = await boot({ memoryStore: new MemoryStore(dir) });
  try {
    const mem = new MemoryStore(dir);
    await mem.save({ candidates: [후보('c1', '목록으로')], promoted: [], observed: [] });
    const [cf, rb] = await Promise.all([
      post('/memory/confirm', { candidateId: 'c1' }).then((r) => r.json()),
      post('/memory/rollback', { candidateId: 'c1' }).then((r) => r.json()),
    ]);
    assert.equal(cf.ok, true);
    const after = await mem.load();
    const l = await (await fetch(`${base}/memory/ledger`)).json();
    const events = l.entries.map((e) => e.event);
    if (rb.rolledBack) {
      // 철회가 승격 뒤에 섰다면: 남은 승격 0, 원장은 confirmed → rolled_back 순서.
      assert.equal(after.promoted.length, 0);
      assert.deepEqual(events, ['confirmed', 'rolled_back']);
    } else {
      // 철회가 먼저 서서 아직 승격이 없었다면: 정직한 not_found, 승격은 남고 원장은 confirmed 뿐.
      assert.equal(rb.reason, 'not_found');
      assert.equal(after.promoted.length, 1);
      assert.deepEqual(events, ['confirmed']);
    }
    // 어느 갈래든 화면 투영은 상태와 같은 결론.
    const um = await (await fetch(`${base}/user-model`)).json();
    assert.equal(um.operatingPreferences.filter((x) => x.admitted).length, after.promoted.length);
  } finally { await close(); }
});

// ── 감사 보강(2026-07-29): 멱등은 확인만이 아니다 — 거절·철회·후보 제안도 같은 계약 ──

test('거절: 응답 유실 뒤 재시도 → 원장 영수증으로 "이미 끝난 행동"을 안다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-fi6-'));
  const { post, close } = await boot({ memoryStore: new MemoryStore(dir) });
  try {
    const mem = new MemoryStore(dir);
    await mem.save({ candidates: [후보('c1', '지울 것')], promoted: [], observed: [] });
    const r1 = await (await post('/memory/reject', { candidateId: 'c1' })).json();
    assert.equal(r1.rejected, true);
    // 재시도(응답 유실 가정) — not_found 가 아니라 "이미 거절됨".
    const r2 = await (await post('/memory/reject', { candidateId: 'c1' })).json();
    assert.equal(r2.already, true, `재시도가 이미 끝난 행동을 못 알아봤다: ${JSON.stringify(r2)}`);
    assert.equal(r2.rejected, true);
    // 애초에 없던 것과는 구분된다.
    const r3 = await (await post('/memory/reject', { candidateId: '유령' })).json();
    assert.equal(r3.reason, 'not_found');
  } finally { await close(); }
});

test('철회: 응답 유실 뒤 재시도 → "이미 되돌린 행동" · 원장 실패 시 receiptWritten:false', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-fi7-'));
  const real = new MemoryLedger(dir);
  let 원장고장 = false;
  const 불안정원장 = {
    load: () => real.load(),
    append: (ev, en) => { if (원장고장) throw new Error('ledger down'); return real.append(ev, en); },
  };
  const { post, close } = await boot({ memoryStore: new MemoryStore(dir), memoryLedger: 불안정원장 });
  try {
    const mem = new MemoryStore(dir);
    await mem.save({ candidates: [], promoted: [{ ...후보('p1', '반영된 것'), userConfirmed: true, admitted: true }], observed: [] });
    // 원장 실패 갈래 — 행동은 성공, 누락은 정직.
    원장고장 = true;
    const r1 = await (await post('/memory/rollback', { candidateId: 'p1' })).json();
    assert.equal(r1.rolledBack, true);
    assert.equal(r1.receiptWritten, false, '영수증이 빠졌는데 응답이 조용하다');
    assert.equal((await mem.load()).promoted.length, 0);
    // 원장 회복 뒤 다른 항목으로 정상 흐름 + 재시도 멱등(영수증 있는 갈래).
    원장고장 = false;
    await mem.save({ candidates: [], promoted: [{ ...후보('p2', '두번째'), userConfirmed: true, admitted: true }], observed: [] });
    await (await post('/memory/rollback', { candidateId: 'p2' })).json();
    const r2 = await (await post('/memory/rollback', { candidateId: 'p2' })).json();
    assert.equal(r2.already, true, `재시도가 이미 끝난 행동을 못 알아봤다: ${JSON.stringify(r2)}`);
    assert.equal(r2.rolledBack, true);
  } finally { await close(); }
});

test('후보 제안: 원장 실패가 조용히 지나가지 않는다(receiptWritten:false)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-fi8-'));
  const 죽은원장 = { async append() { throw new Error('down'); }, async load() { return { entries: [] }; } };
  const { post, close } = await boot({ memoryStore: new MemoryStore(dir), memoryLedger: 죽은원장 });
  try {
    const r = await (await post('/user-model/preferences', { statement: '표로 주세요' })).json();
    assert.equal(r.preference.status, 'pending_confirm');
    assert.equal(r.receiptWritten, false, `proposed 누락이 조용히 지나갔다: ${JSON.stringify(r)}`);
  } finally { await close(); }
});

// ── 감사 보강: 격리 실패 시 새 기록 중단 · 고유 임시명 동시 쓰기 ─────────
test('손상 격리가 실패하면 새 기록을 쓰지 않는다(보존 계약이 침묵 속에 깨지지 않게)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-fi9-'));
  const sub = join(dir, 'led');
  const { mkdir, chmod } = await import('node:fs/promises');
  await mkdir(sub);
  const ledger = new MemoryLedger(sub);
  await writeFile(join(sub, 'memory-ledger.json'), '{"broken', 'utf8');
  await chmod(sub, 0o500); // 격리(rename)가 실패하는 환경
  try {
    await assert.rejects(() => ledger.append('proposed', 후보('c1', 'x')), '격리 실패인데 기록을 계속했다');
  } finally { await chmod(sub, 0o700); }
  // 손상 바이트는 그대로 남아 있다.
  assert.equal(await readFile(join(sub, 'memory-ledger.json'), 'utf8'), '{"broken');
});

test('두 저장 주체가 동시에 써도 임시 파일이 충돌하지 않는다(고유 임시명)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-fi10-'));
  const a = new MemoryLedger(dir); const b = new MemoryLedger(dir);
  await Promise.all([
    ...Array.from({ length: 5 }, (_, i) => a.append('proposed', 후보(`a${i}`, `a${i}`))),
    ...Array.from({ length: 5 }, (_, i) => b.append('proposed', 후보(`b${i}`, `b${i}`))),
  ]);
  const after = await a.load();
  assert.equal(after.corrupted, undefined, '동시 쓰기가 원장을 손상시켰다');
  assert.ok(after.entries.length >= 1); // 마지막 쓰기가 이긴다 — 손상만 아니면 된다(서버는 직렬화가 막는다)
});

// ── 주입 5: 화면·상태·원장의 일치(원장 실패 갈래 포함)는 위 각 검사에서 함께 확인했다 ──
