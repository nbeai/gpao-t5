import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
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
    assert.equal((await stat(join(room, 'objects', saved.handle, 'stdout'))).mode & 0o777, 0o600);
    await assert.rejects(store.read({ handle: saved.handle, sessionId: 'session-b',
      stream: 'stdout', offset: 0, limit: 10 }), /not found/u);
    const restarted = new TerminalOutputStore(room);
    assert.equal((await restarted.read({ handle: saved.handle, sessionId: 'session-a',
      stream: 'stderr', offset: 0, limit: 10 })).text, '경고');
  } finally { await rm(room, { recursive: true, force: true }); }
});
