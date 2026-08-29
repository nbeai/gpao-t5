import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ManagedProcessRegistry } from '../src/managed-process.js';
import { makeQuickPreviewTool } from '../src/quick-preview-tool.js';

const effect = { kind: 'external_send', targets: ['https://trycloudflare.com'],
  confirmation: 'known_recipient', rollbackOfToolCallId: null };

test('설치된 Cloudflare Quick Tunnel은 localhost를 검증된 임시 URL로 열고 stop으로 끝난다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-quick-preview-')); const program = join(root, 'cloudflared');
  const registry = new ManagedProcessRegistry({ platform: process.platform, outputLimit: 64_000 });
  try {
    await writeFile(program, '#!/bin/sh\nprintf "https://fixture-green.trycloudflare.com\\n" >&2\nsleep 30\n');
    await chmod(program, 0o700);
    let fetched = null;
    const tool = makeQuickPreviewTool({ program, processRegistry: registry, ownerId: 'session-preview', waitMs: 500,
      authorizeEffect: async () => ({ allowed: true }),
      fetchImpl: async (url) => { fetched = url; return new Response('<h1>preview</h1>', { status: 200 }); } });
    const started = await tool.execute({ action: 'start', localUrl: 'http://127.0.0.1:4183/',
      processId: null, effect });
    assert.equal(started.state, 'preview_ready');
    assert.equal(started.previewUrl, 'https://fixture-green.trycloudflare.com');
    assert.equal(fetched, started.previewUrl); assert.equal(started.providerAccepted, true);
    assert.equal(started.urlReachable, true); assert.equal(started.production, false);
    assert.equal(started.stableUrl, false); assert.equal(started.publicToAnyoneWithUrl, true);
    assert.equal(started.billingObserved, false); assert.deepEqual(started.activatedTools, ['browser']);
    const status = await tool.execute({ action: 'status', localUrl: null,
      processId: started.processId, effect: null });
    assert.equal(status.state, 'preview_ready');
    const stopped = await tool.execute({ action: 'stop', localUrl: null,
      processId: started.processId, effect: null });
    assert.equal(stopped.state, 'preview_stopped'); assert.equal(stopped.terminationConfirmed, true);
  } finally { await registry.stopAll('test_cleanup'); await rm(root, { recursive: true, force: true }); }
});

test('Quick Preview는 외부 주소·비밀 URL·승인 없는 전송을 실행하지 않는다', async () => {
  const registry = new ManagedProcessRegistry({ platform: process.platform });
  const tool = makeQuickPreviewTool({ program: '/fixture/cloudflared', processRegistry: registry,
    ownerId: 'session-preview', authorizeEffect: async () => ({ allowed: false,
      result: { state: 'approval_required', reason: 'new_recipient' } }), fetchImpl: async () => new Response('') });
  await assert.rejects(() => tool.execute({ action: 'start', localUrl: 'https://example.com',
    processId: null, effect }), /localhost/u);
  await assert.rejects(() => tool.execute({ action: 'start', localUrl: 'http://user:secret@127.0.0.1:4183',
    processId: null, effect }), /credentials|localhost/u);
  const blocked = await tool.execute({ action: 'start', localUrl: 'http://127.0.0.1:4183',
    processId: null, effect });
  assert.equal(blocked.state, 'approval_required'); assert.equal(registry.list('session-preview').length, 0);
});
