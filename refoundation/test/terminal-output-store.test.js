import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { TerminalOutputStore } from '../src/terminal-output-store.js';

test('TerminalOutputStore는 full streams를 0600 object로 보존하고 exact owner range만 읽는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-terminal-output-'));
  const store = new TerminalOutputStore(room, { makeId: () => '11111111-1111-4111-8111-111111111111' });
  try {
    const saved = await store.save({ sessionId: 'session-a', runId: 'run-a',
      stdout: '앞😀가운데-NEEDLE-뒤', stderr: '경고' });
    assert.equal(saved.streams.stdout.chars, '앞😀가운데-NEEDLE-뒤'.length);
    const read = await store.read({ handle: saved.handle, sessionId: 'session-a',
      stream: 'stdout', offset: 3, limit: 10 });
    assert.equal(read.text, '가운데-NEEDLE'.slice(0, 10));
    assert.equal(saved.schema, 't5.terminal-output.v2');
    assert.equal((await stat(join(room, 'objects', saved.handle,
      saved.streams.stdout.chunks[0].file))).mode & 0o777, 0o600);
    await assert.rejects(store.read({ handle: saved.handle, sessionId: 'session-b',
      stream: 'stdout', offset: 0, limit: 10 }), /not found/u);
    const restarted = new TerminalOutputStore(room);
    assert.equal((await restarted.read({ handle: saved.handle, sessionId: 'session-a',
      stream: 'stderr', offset: 0, limit: 10 })).text, '경고');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('큰 출력은 압축 chunk로 저장하고 Unicode 경계의 요청 구간만 복원한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-terminal-output-chunks-'));
  const store = new TerminalOutputStore(room);
  try {
    const stdout = `${'x'.repeat(63_999)}😀NEEDLE-${'y'.repeat(80_000)}`;
    const saved = await store.save({ sessionId: 'session-a', runId: 'run-a', stdout });
    assert.ok(saved.streams.stdout.chunks.length >= 3);
    assert.ok(saved.streams.stdout.storedBytes < saved.streams.stdout.bytes / 10);
    const offset = 63_995;
    const read = await store.read({
      handle: saved.handle, sessionId: 'session-a', stream: 'stdout', offset, limit: 24,
    });
    assert.equal(read.text, stdout.slice(offset, offset + 24));
    assert.equal(read.totalChars, stdout.length);
    assert.equal((await readdir(join(room, 'objects', saved.handle))).includes('stdout'), false);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('live output interruption은 같은 handle을 읽기 전용 terminal 상태로 exact once 봉인한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-terminal-output-interrupted-'));
  const store = new TerminalOutputStore(room);
  try {
    const live = await store.begin({ sessionId: 'session-a', runId: 'run-a' });
    await store.append({ handle: live.handle, sessionId: 'session-a',
      stream: 'stdout', text: '중단 전 결과😀' });
    const interrupted = await store.interrupt({ handle: live.handle, sessionId: 'session-a' });
    assert.equal(interrupted.state, 'interrupted');
    assert.match(interrupted.streams.stdout.sha256, /^[a-f0-9]{64}$/u);
    const repeated = await store.interrupt({ handle: live.handle, sessionId: 'session-a' });
    assert.equal(repeated.interruptedAt, interrupted.interruptedAt);
    assert.equal((await store.finalize({ handle: live.handle,
      sessionId: 'session-a' })).state, 'interrupted');
    assert.equal((await store.read({ handle: live.handle, sessionId: 'session-a',
      stream: 'stdout', offset: 0, limit: 100 })).text, '중단 전 결과😀');
    await assert.rejects(store.append({ handle: live.handle, sessionId: 'session-a',
      stream: 'stdout', text: '사고 뒤 추가' }), /not found/u);
    await assert.rejects(store.interrupt({ handle: live.handle,
      sessionId: 'session-b' }), /not found/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});
