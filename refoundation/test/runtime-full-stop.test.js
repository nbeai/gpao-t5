import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';

test('전체 종료는 명시 확인 뒤 한 번만 Runtime drain을 요청하고 UI 닫기와 분리된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-runtime-full-stop-')); const workspace = join(room, 'workspace');
  await mkdir(workspace);
  let stopRequests = 0;
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace,
    workAdmissionMode: 'action-v1',
    requestRuntimeStop: async (reason) => { assert.equal(reason, 'user_full_stop'); stopRequests += 1; },
    modelFactory: () => ({ async respond() { return { text: 'unused', toolCalls: [] }; } }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const missing = await fetch(`${base}/runtime/stop`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(missing.status, 400); assert.equal(stopRequests, 0);
    const accepted = await fetch(`${base}/runtime/stop`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
    assert.equal(accepted.status, 202); assert.equal((await accepted.json()).stopping, true);
    await new Promise((resolve) => setTimeout(resolve, 10)); assert.equal(stopRequests, 1);
  } finally { await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});

test('전체 종료 drain은 실행 중 Work를 기존 interrupted-resumable 원장으로 정산한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-runtime-drain-work-')); const workspace = join(room, 'workspace');
  await mkdir(workspace);
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace,
    workAdmissionMode: 'action-v1',
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ respond({ signal }) { return new Promise((resolve, reject) => {
      const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    }); } }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const turn = fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '오래 걸리는 작업' }) });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const current = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
      if (current.activity?.status === 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    server.beginRuntimeDrain();
    assert.deepEqual(await server.drainActiveWork(), { requested: 1, settled: 1, failed: 0 });
    await turn;
    const state = await server.workStore.read(); const cancellation = state.cancellations.at(-1);
    assert.equal(cancellation.disposition, 'interrupted_resumable');
    assert.equal(cancellation.state, 'terminal'); assert.equal(cancellation.claimReleased, true);
    assert.equal(state.works.find((work) => work.workId === cancellation.workId).status, 'active');
    const rejected = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '새 작업' }) });
    assert.equal(rejected.status, 503);
  } finally { await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});

test('제품 전체 종료는 기존 Work 취소 정산과 owner release를 재사용하고 화면에 범위를 설명한다', async () => {
  const [entry, server, ui, launcher] = await Promise.all([
    readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/console-server.js', import.meta.url), 'utf8'),
    readFile(new URL('../ui/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/macos-launcher.m', import.meta.url), 'utf8'),
  ]);
  assert.match(server, /workCancellation\.admit[\s\S]*interrupted_resumable/u);
  assert.match(entry, /server\.beginRuntimeDrain\(\)[\s\S]*server\.drainActiveWork\(\)[\s\S]*runtimeOwnership\.release/u);
  assert.match(ui, /T5 완전히 끄기/u); assert.match(ui, /자동화와 메신저도 멈춰요/u);
  assert.doesNotMatch(launcher, /applicationWillTerminate[\s\S]*terminate/u);
});
