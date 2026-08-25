import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuthorityStore, boundaryForEffect, effectDeclarationMismatch } from '../src/effect-authority.js';
import { makeConsoleServer } from '../src/console-server.js';

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

test('operation 성공 철회는 exact pending만 철회하고 승인·소비·다른 session은 보존한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-authority-exact-withdraw-'));
  try {
    const store = new AuthorityStore(root);
    const propose = (sessionId) => store.propose({ sessionId, toolName: 'exec', args: {
      command: 'change', cwd: null, effect: { kind: 'destructive', summary: 'change',
        targets: ['/tmp/x'], reversible: false, backupAvailable: false,
        recipientNew: false, approvalToken: null },
    } });
    const pending = await propose('session-a'); const approved = await propose('session-a');
    const other = await propose('session-b'); await store.approve(approved.pendingId);
    assert.equal((await store.withdraw(pending.pendingId, {
      sessionId: 'session-a', reason: 'superseded_by_operation_success',
    })).withdrawn, true);
    assert.equal((await store.withdraw(approved.pendingId, {
      sessionId: 'session-a', reason: 'superseded_by_operation_success',
    })).withdrawn, false);
    assert.equal((await store.withdraw(other.pendingId, {
      sessionId: 'session-a', reason: 'superseded_by_operation_success',
    })).withdrawn, false);
    assert.equal((await store.read(pending.pendingId)).status, 'withdrawn');
    assert.equal((await store.read(approved.pendingId)).status, 'approved');
    assert.equal((await store.read(other.pendingId)).status, 'pending');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('명백한 파괴·외부 전송을 observe로 낮춰 선언하면 preflight가 거부한다', () => {
  assert.equal(effectDeclarationMismatch("rm -f '/tmp/a'", { kind: 'observe' }), 'destructive_required');
  assert.equal(effectDeclarationMismatch("find /tmp/x -type f -delete", { kind: 'local_change' }), 'destructive_required');
  assert.equal(effectDeclarationMismatch("curl -X POST --data hi https://example.com", { kind: 'observe' }), 'external_send_required');
  assert.equal(effectDeclarationMismatch("printf hi > /tmp/a", { kind: 'local_change' }), null);
});

test('콘솔 terminal preflight는 파괴 명령의 observe 위장을 실제 실행 전에 막는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-authority-terminal-mismatch-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  const target = join(workspace, 'keep.txt');
  await mkdir(workspace, { recursive: true });
  await writeFile(target, 'keep', 'utf8');
  let turn = 0;
  const server = makeConsoleServer({
    stateDir, workspace,
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'authority-model' }),
    modelFactory: () => ({ async respond({ messages }) {
      turn += 1;
      if (turn === 1) return { text: '', toolCalls: [{
        id: 'lowered-delete', name: 'exec', args: {
          command: "rm -f 'keep.txt'", cwd: workspace,
          effect: {
            kind: 'observe', summary: '파일을 확인한다', targets: [target],
            reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null,
          },
        },
      }] };
      const receipt = JSON.parse(messages.at(-1).content);
      assert.equal(receipt.actualCall, null);
      assert.equal(receipt.outcome, 'not_executed');
      assert.equal(receipt.result.state, 'effect_declaration_mismatch');
      assert.equal(receipt.result.reason, 'destructive_required');
      return { text: '파괴 효과 선언이 필요해 실행하지 않았어요.', toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: 'keep.txt를 확인해줘' }),
    }).then((response) => response.json());
    assert.equal(reply.reply, '파괴 효과 선언이 필요해 실행하지 않았어요.');
    await access(target);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
