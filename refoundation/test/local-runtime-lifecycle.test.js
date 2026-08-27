import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ensureLocalRuntime, observeLocalRuntime } from '../src/local-runtime-lifecycle.js';

const healthy = async () => ({ ok: true, async json() {
  return { ok: true, product: 'gpao-t5-refoundation' };
} });

test('건강한 기존 Runtime이 있으면 UI attach는 새 Runtime을 시작하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-runtime-attach-')); const portFile = join(room, 'port.json');
  try {
    await writeFile(portFile, JSON.stringify({ port: 43123, pid: 101 }), { mode: 0o600 });
    let starts = 0;
    const result = await ensureLocalRuntime({ portFile, fetcher: healthy,
      startRuntime: async () => { starts += 1; } });
    assert.equal(result.state, 'healthy'); assert.equal(result.started, false); assert.equal(starts, 0);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('Runtime이 없으면 한 번만 시작 요청하고 실제 health 뒤 UI attach를 연다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-runtime-start-')); const portFile = join(room, 'port.json');
  try {
    let starts = 0;
    const result = await ensureLocalRuntime({ portFile, fetcher: healthy, timeoutMs: 500, pollMs: 1,
      startRuntime: async () => {
        starts += 1; await writeFile(portFile, JSON.stringify({ port: 43124, pid: 202 }), { mode: 0o600 });
        return { requested: true };
      } });
    assert.equal(result.state, 'healthy'); assert.equal(result.started, true); assert.equal(starts, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('port 사실이 깨졌거나 다른 health면 살아 있다고 꾸미지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-runtime-fact-')); const portFile = join(room, 'port.json');
  try {
    await writeFile(portFile, JSON.stringify({ port: 43125, pid: 303 }), { mode: 0o600 });
    const result = await observeLocalRuntime({ portFile, fetcher: async () => ({ ok: true,
      async json() { return { ok: true, product: 'other-product' }; } }) });
    assert.deepEqual(result, { state: 'unavailable', reason: 'health_identity_mismatch' });
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('공통 lifecycle은 OS 서비스 이름이나 신호를 제품 의미로 사용하지 않는다', async () => {
  const source = await readFile(new URL('../src/local-runtime-lifecycle.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /darwin|win32|launchd|Task Scheduler|SIGTERM|SIGKILL|NSApplication|CreateProcess/iu);
});
