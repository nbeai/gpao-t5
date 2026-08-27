import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { LocalRuntimeOwnership } from '../src/durable-process-ownership.js';
import { MessengerPollingOwnership } from '../src/messenger-gateway.js';

test('Local Runtime owner는 process 두 개가 같은 canonical state를 열어도 하나만 선다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-runtime-owner-')); const live = new Set([101]);
  const first = new LocalRuntimeOwnership(room, { pid: 101, tokenFactory: () => '11111111-1111-4111-8111-111111111111',
    isProcessAlive: (pid) => live.has(pid) });
  const second = new LocalRuntimeOwnership(room, { pid: 202, tokenFactory: () => '22222222-2222-4222-8222-222222222222',
    isProcessAlive: (pid) => live.has(pid) });
  try {
    const a = await first.acquire(); assert.equal(a.claimed, true);
    assert.deepEqual(await second.acquire(), { claimed: false, reason: 'runtime_owner_active',
      owner: { pid: 101, acquiredAt: a.claim.acquiredAt } });
    live.delete(101); live.add(202);
    const b = await second.acquire(); assert.equal(b.claimed, true);
    await assert.rejects(first.assert(a.claim), { code: 'runtime_ownership_lost' });
    assert.equal(await second.release(b.claim), true);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('Runtime owner marker는 제품 상태를 복제하지 않고 PID·token fence만 0600에 둔다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-runtime-owner-shape-'));
  const owner = new LocalRuntimeOwnership(room, { pid: 303,
    tokenFactory: () => '33333333-3333-4333-8333-333333333333', isProcessAlive: () => true });
  try {
    const claim = await owner.acquire(); const stored = JSON.parse(await readFile(
      join(room, 'local-runtime.owner', 'owner.json'), 'utf8'));
    assert.deepEqual(Object.keys(stored).toSorted(), ['acquiredAt', 'ownerToken', 'pid', 'resource', 'version']);
    assert.doesNotMatch(JSON.stringify(stored), /Work|Automation|Conversation|Memory|Telegram|content/u);
    assert.equal(await owner.release(claim.claim), true);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('공통 owner 원리는 기존 Telegram provider marker를 바꾸지 않아 update 중 live owner를 보존한다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 't5-owner-compat-'));
  try {
    const owner = new MessengerPollingOwnership(directory, {
      pid: 4101,
      tokenFactory: () => 'old-owner-token',
      isProcessAlive: (pid) => pid === 4101,
    });
    const acquired = await owner.acquire('telegram');
    assert.equal(acquired.claimed, true);
    assert.deepEqual(Object.keys(acquired.claim).sort(), [
      'acquiredAt', 'ownerToken', 'pid', 'provider', 'version',
    ]);

    const contender = new MessengerPollingOwnership(directory, {
      pid: 4102,
      tokenFactory: () => 'new-owner-token',
      isProcessAlive: (pid) => pid === 4101,
    });
    const blocked = await contender.acquire('telegram');
    assert.equal(blocked.claimed, false);
    assert.equal(blocked.reason, 'polling_owner_active');
    assert.equal(blocked.owner.pid, 4101);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('제품 entry는 비공개 runtime owner token만 Automation owner에 결속하고 공개 instance와 분리한다', async () => {
  const entry = await readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8');
  const server = await readFile(new URL('../src/console-server.js', import.meta.url), 'utf8');
  assert.match(entry, /runtimeOwnership\.acquire/u);
  assert.match(entry, /runtimeOwnerToken: runtimeLease\.claim\.ownerToken/u);
  assert.doesNotMatch(entry, /runtimeInstanceId: runtimeLease\.claim\.ownerToken/u);
  assert.match(entry, /runtimeOwnership\.release\(runtimeLease\.claim\)/u);
  assert.match(server, /makeLocalAutomationOwner\(\{ runtimeId: runtimeOwnerToken \}\)/u);
});
