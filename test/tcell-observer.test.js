// TG-1 관찰층 shadow mode 반대시험(명세 §16 TG-1) — 관찰은 영향이 아니다.
// ① 관찰 실패가 답변을 실패시키지 않음 ② secret 원문 0 ③ 같은 receipt 중복 방지 ④ 영향 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TCellObserver } from '../src/surface/tcell-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const 영수증 = (id, over = {}) => ({ id, action: '폴더 봄', userSafeSummary: '봤어요.', failureState: 'none', ...over });

test('같은 receipt 로 두 번 관찰하지 않고, 실패 영수증은 복구 관찰도 남긴다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg1-'));
  const ob = new TCellObserver(dir);
  await ob.observeTurn({ sessionId: 's1', result: { turnReceipts: [영수증('r1')] }, now: 1 });
  await ob.observeTurn({ sessionId: 's1', result: { turnReceipts: [영수증('r1')] }, now: 2 }); // 중복
  await ob.observeTurn({ sessionId: 's1', result: { turnReceipts: [영수증('r2', { failureState: 'blocked', nextSafeAction: '다른 손으로' })] }, now: 3 });
  const { events, corrupted } = await ob.load();
  assert.equal(corrupted, 0);
  const r1들 = events.filter((e) => e.receiptRefs.includes('r1'));
  assert.equal(r1들.length, 1, `같은 receipt 가 ${r1들.length}번 관찰됐다`);
  assert.ok(events.some((e) => e.type === 'recovery'), '실패 영수증의 복구 관찰이 없다');
  assert.ok(events.every((e) => e.schemaVersion === 1));
});

test('관찰 기록 실패(디스크 불능)가 record 를 던지게 하지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg1-ro-'));
  // growth 자리를 파일로 막는다 — mkdir 이 영영 실패하는 확실한 불능 조건.
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(dir, 'growth'), '자리 차지', 'utf8');
  const ob = new TCellObserver(dir);
  let out;
  await assert.doesNotReject(async () => {
    out = await ob.observeTurn({ sessionId: 's', result: { turnReceipts: [영수증('r9')] }, now: 2 });
  });
  assert.equal(out.recorded, 0, '기록 불능인데 기록했다고 했다');
  assert.ok(ob.lastError, '실패 사실이 남지 않았다');
});

test('서버 관통: 턴이 관찰을 남기되, 관찰자가 죽어 있어도 답변은 성공한다(영향 0)', async () => {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const 읽는손 = {
    async probe(c) { return { command: c, cwd: '/x', changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(a) { return { result: { command: a.command, exitCode: 0, stdout: '', cwd: '/x' }, userSafeSummary: '봤어요.' }; },
  };
  let 첫 = true;
  const 모델 = { async respond(_tc, opts = {}) {
    if (!opts.tools?.length) return '네';
    if (첫) { 첫 = false; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'ls' } }] }; }
    return { text: '봤어요', toolCalls: [] };
  } };
  // ① 정상 관찰자: 답변 + jsonl 기록
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg1-srv-'));
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools({ localTerminal: 읽는손 }), model: 모델 });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const r = await (await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s.id, text: '폴더 봐줘' }) })).json();
    assert.equal(r.kind, 'reply');
    await new Promise((rs) => setTimeout(rs, 150)); // 후처리(비동기) 완료 대기
    const raw = await readFile(join(dir, 'growth', 'observations.jsonl'), 'utf8');
    const events = raw.trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(events.length >= 1, '관찰이 남지 않았다');
    assert.ok(events.every((e) => e.sessionId === s.id));
    // secret 원문 0: 관찰 파일에 명령 원문·비밀 패턴이 없다(요약과 참조만).
    assert.ok(!raw.includes('sk-'), '비밀 모양이 관찰에 남았다');
  } finally { await new Promise((r2) => server.close(r2)); }
  // ② 죽은 관찰자(record 가 던짐): 답변은 그대로 성공
  const dir2 = await mkdtemp(join(tmpdir(), 'gpao-t5-tg1-dead-'));
  let 두번째첫 = true;
  const 모델2 = { async respond(_tc, opts = {}) {
    if (!opts.tools?.length) return '네';
    if (두번째첫) { 두번째첫 = false; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'ls' } }] }; }
    return { text: '봤어요', toolCalls: [] };
  } };
  const 죽은관찰자 = { observeTurn() { throw new Error('observer dead'); } };
  const server2 = makeServer({ store: new SessionStore(dir2), env: demoEnv(), tools: demoTools({ localTerminal: 읽는손 }), model: 모델2, tcellObserver: 죽은관찰자 });
  await new Promise((r) => server2.listen(0, r));
  const base2 = `http://127.0.0.1:${server2.address().port}`;
  try {
    const s2 = await (await fetch(`${base2}/sessions`, { method: 'POST' })).json();
    const r2 = await (await fetch(`${base2}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s2.id, text: '폴더 봐줘' }) })).json();
    assert.equal(r2.kind, 'reply', '관찰자 죽음이 답변을 죽였다');
  } finally { await new Promise((r3) => server2.close(r3)); }
});

test('영향 0: 관찰 파일은 어떤 커널 입력 조립에도 읽히지 않는다(참조 검사)', async () => {
  const kernelFiles = ['turn.js', 'l2-plan/model-control.js', 'l1-intent/context-mesh.js', 'l1-intent/user-model.js'];
  for (const f of kernelFiles) {
    const src = await readFile(join('src/kernel', f), 'utf8').catch(() => '');
    assert.ok(!src.includes('observations.jsonl') && !src.includes('TCellObserver'),
      `커널(${f})이 관찰 저장소를 읽는다 — 관찰은 영향이 아니다`);
  }
});
