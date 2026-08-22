import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuthorityStore, boundaryForEffect, effectDeclarationMismatch } from '../src/effect-authority.js';

test('네 사용자 경계만 멈추고 관측·가역적 로컬 변경은 자동 진행한다', () => {
  assert.equal(boundaryForEffect({ kind: 'observe' }), null);
  assert.equal(boundaryForEffect({ kind: 'local_change', reversible: true }), null);
  assert.equal(boundaryForEffect({ kind: 'destructive', backupAvailable: true }), null);
  assert.equal(boundaryForEffect(
    { kind: 'destructive', backupAvailable: true }, { requiredEffect: 'destructive' },
  ), 'approval');
  assert.equal(boundaryForEffect({ kind: 'destructive', backupAvailable: false }), 'approval');
  assert.equal(boundaryForEffect({ kind: 'external_send', recipientNew: false }), null);
  assert.equal(boundaryForEffect({ kind: 'external_send', recipientNew: true }), 'approval');
  assert.equal(boundaryForEffect({ kind: 'payment' }), 'approval');
  assert.equal(boundaryForEffect({ kind: 'secret_input' }), 'secret_input');
});

test('승인은 정확한 tool call에 결속되어 한 번만 소비되고 재시작 뒤에도 복원된다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-authority-store-'));
  try {
    const store = new AuthorityStore(root);
    const proposal = await store.propose({
      sessionId: 'session-1', toolName: 'exec',
      args: { command: 'rm target.txt', cwd: '/tmp', effect: {
        kind: 'destructive', summary: 'target.txt 삭제', targets: ['/tmp/target.txt'],
        reversible: false, backupAvailable: false, recipientNew: false, approvalToken: null,
      } },
    });
    assert.equal(proposal.status, 'pending');
    assert.equal((await stat(proposal.file)).mode & 0o777, 0o600);
    assert.deepEqual((await store.listActive('session-1')).map((item) => item.pendingId), [proposal.pendingId]);
    await store.approve(proposal.pendingId);

    const reopened = new AuthorityStore(root);
    const mismatched = await reopened.consume(proposal.pendingId, {
      toolName: 'exec', args: { ...proposal.args, command: 'rm other.txt' },
    });
    assert.equal(mismatched.allowed, false);
    assert.equal(mismatched.reason, 'call_mismatch');
    const exact = await reopened.consume(proposal.pendingId, {
      toolName: 'exec', args: proposal.args,
    });
    assert.equal(exact.allowed, true);
    const reused = await reopened.consume(proposal.pendingId, {
      toolName: 'exec', args: proposal.args,
    });
    assert.equal(reused.allowed, false);
    assert.equal(reused.reason, 'already_consumed');
    assert.equal((await reopened.listActive('session-1')).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('거절된 효과는 같은 pending ID로 실행할 수 없다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-authority-reject-'));
  try {
    const store = new AuthorityStore(root);
    const proposal = await store.propose({
      sessionId: 'session-2', toolName: 'exec',
      args: { command: 'pay', cwd: null, effect: {
        kind: 'payment', summary: '결제', targets: ['merchant'], reversible: false,
        backupAvailable: false, recipientNew: true, approvalToken: null,
      } },
    });
    await store.reject(proposal.pendingId);
    const result = await store.consume(proposal.pendingId, { toolName: 'exec', args: proposal.args });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'rejected');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('대화 회복은 승인 전·승인 후 미소비 요청을 모두 철회한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-authority-withdraw-'));
  try {
    const store = new AuthorityStore(root);
    const proposal = (sessionId) => store.propose({
      sessionId, toolName: 'exec', args: { command: 'pay', cwd: null, effect: {
        kind: 'payment', summary: '결제', targets: ['merchant'], reversible: false,
        backupAvailable: false, recipientNew: true, approvalToken: null,
      } },
    });
    const pending = await proposal('session-recovery');
    const approved = await proposal('session-recovery');
    await store.approve(approved.pendingId);
    assert.equal((await store.listActive('session-recovery')).length, 2);
    assert.deepEqual(new Set(await store.withdrawActive('session-recovery')), new Set([
      pending.pendingId, approved.pendingId,
    ]));
    assert.equal((await store.listActive('session-recovery')).length, 0);
    assert.equal((await store.read(pending.pendingId)).status, 'withdrawn');
    assert.equal((await store.read(approved.pendingId)).status, 'withdrawn');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('명백한 파괴·외부 전송을 observe로 낮춰 선언하면 preflight가 거부한다', () => {
  assert.equal(effectDeclarationMismatch("rm -f '/tmp/a'", { kind: 'observe' }), 'destructive_required');
  assert.equal(effectDeclarationMismatch("find /tmp/x -type f -delete", { kind: 'local_change' }), 'destructive_required');
  assert.equal(effectDeclarationMismatch("curl -X POST --data hi https://example.com", { kind: 'observe' }), 'external_send_required');
  assert.equal(effectDeclarationMismatch("printf hi > /tmp/a", { kind: 'local_change' }), null);
});
