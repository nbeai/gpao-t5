import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeWorkspacePatchTool } from '../src/workspace-patch-tool.js';
import { makeExecTool } from '../src/exec-tool.js';

const call = (overrides = {}) => ({ action: 'preview', planHandle: null, undoHandle: null,
  operations: [], ...overrides });

test('workspace_patch preview→apply는 literal multi-file 결과를 published_verified로 끝낸다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-workspace-patch-'));
  try {
    await writeFile(join(root, 'a.json'), '{"old":true}');
    const tool = makeWorkspacePatchTool({ workspace: root, stateRoot: join(root, '.state') });
    const preview = await tool.execute(call({ operations: [
      { type: 'modify', path: 'a.json', to: null, content: '{"next":true}' },
      { type: 'create', path: 'literal.txt', to: null, content: '$HOME literal' },
    ] }));
    assert.equal(preview.state, 'previewed'); assert.equal(JSON.stringify(preview).includes('$HOME literal'), false);
    const applied = await tool.execute(call({ action: 'apply', planHandle: preview.planHandle }));
    assert.equal(applied.state, 'published_verified'); assert.equal(applied.verifiedTargets, 2);
    assert.equal(await readFile(join(root, 'a.json'), 'utf8'), '{"next":true}');
    assert.equal(await readFile(join(root, 'literal.txt'), 'utf8'), '$HOME literal');
    await assert.rejects(tool.execute(call({ action: 'apply', planHandle: preview.planHandle })), /stale/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('workspace_patch durable undo는 새 tool instance에서 exact rollback하고 handle을 한 번만 쓴다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-workspace-undo-')); const stateRoot = join(root, '.state');
  try {
    const target = join(root, 'a.json'); await writeFile(target, '{"revision":1}');
    const first = makeWorkspacePatchTool({ workspace: root, stateRoot, sessionId: 'session-a' });
    const preview = await first.execute(call({ operations: [
      { type: 'modify', path: 'a.json', to: null, content: '{"revision":2}' },
      { type: 'create', path: 'created.txt', to: null, content: 'created' },
    ] }));
    const applied = await first.execute(call({ action: 'apply', planHandle: preview.planHandle }));
    assert.ok(applied.undoHandle); assert.equal(await readFile(target, 'utf8'), '{"revision":2}');
    const restarted = makeWorkspacePatchTool({ workspace: root, stateRoot, sessionId: 'session-a' });
    assert.equal(await restarted.undoAvailable({ undoHandle: applied.undoHandle }), true);
    const rolled = await restarted.execute(call({ action: 'rollback', undoHandle: applied.undoHandle }));
    assert.equal(rolled.state, 'rolled_back_verified');
    assert.equal(await readFile(target, 'utf8'), '{"revision":1}');
    await assert.rejects(readFile(join(root, 'created.txt')), { code: 'ENOENT' });
    assert.equal(await restarted.undoAvailable({ undoHandle: applied.undoHandle }), false);
    await assert.rejects(restarted.execute(call({ action: 'rollback', undoHandle: applied.undoHandle })), /stale/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('workspace_patch는 아직 없는 bounded 부모를 발행 시 만들고 durable Undo에서 빈 부모까지 제거한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-workspace-new-parent-')); const stateRoot = join(root, '.state');
  try {
    const first = makeWorkspacePatchTool({ workspace: root, stateRoot, sessionId: 'session-a' });
    const preview = await first.execute(call({ operations: [
      { type: 'create', path: 'result/nested/a.txt', to: null, content: 'A' },
      { type: 'create', path: 'result/nested/b.txt', to: null, content: 'B' },
    ] }));
    const applied = await first.execute(call({ action: 'apply', planHandle: preview.planHandle }));
    assert.equal(applied.state, 'published_verified');
    assert.equal(await readFile(join(root, 'result/nested/a.txt'), 'utf8'), 'A');
    const restarted = makeWorkspacePatchTool({ workspace: root, stateRoot, sessionId: 'session-a' });
    const rolled = await restarted.execute(call({ action: 'rollback', undoHandle: applied.undoHandle }));
    assert.equal(rolled.state, 'rolled_back_verified');
    await assert.rejects(lstat(join(root, 'result')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('foreground local_change도 exact declared file이면 기존 F Undo로 다음 tool instance에서 복원된다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-foreground-undo-')); const stateRoot = join(root, '.state');
  try {
    const target = join(root, 'source.js'); const dirty = join(root, 'theme.css');
    await writeFile(target, 'old-source'); await writeFile(dirty, 'user-dirty');
    const patch = makeWorkspacePatchTool({ workspace: root, stateRoot, sessionId: 'session-a' });
    const exec = makeExecTool({ workspace: root, mutationUndoCoordinator: patch });
    const changed = await exec.execute({ command: "printf 'new-source' > source.js", cwd: null,
      effect: { kind: 'local_change', targets: ['source.js'], confirmation: 'not_applicable', rollbackOfToolCallId: null } });
    assert.equal(changed.state, 'completed'); assert.ok(changed.undoHandle);
    assert.equal(await readFile(target, 'utf8'), 'new-source'); assert.equal(await readFile(dirty, 'utf8'), 'user-dirty');
    const restarted = makeWorkspacePatchTool({ workspace: root, stateRoot, sessionId: 'session-a' });
    const rolled = await restarted.execute(call({ action: 'rollback', undoHandle: changed.undoHandle }));
    assert.equal(rolled.state, 'rolled_back_verified'); assert.equal(await readFile(target, 'utf8'), 'old-source');
    assert.equal(await readFile(dirty, 'utf8'), 'user-dirty');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('workspace_patch invalid candidate는 apply 전에 target write 0이다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-workspace-invalid-'));
  try {
    const target = join(root, 'a.json'); await writeFile(target, '{"old":true}');
    const tool = makeWorkspacePatchTool({ workspace: root, stateRoot: join(root, '.state') });
    const preview = await tool.execute(call({ operations: [
      { type: 'modify', path: 'a.json', to: null, content: '{broken' },
    ] }));
    await assert.rejects(tool.execute(call({ action: 'apply', planHandle: preview.planHandle })));
    assert.equal(await readFile(target, 'utf8'), '{"old":true}');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('workspace_patch 동일 transaction은 사업·개발·개인 파일 세 목적에 전용 규칙 없이 성립한다', async () => {
  for (const purpose of ['business', 'development', 'personal']) {
    const root = await mkdtemp(join(tmpdir(), `t5-workspace-${purpose}-`));
    try {
      const existing = join(root, 'current.json'); await writeFile(existing, '{"revision":1}');
      const tool = makeWorkspacePatchTool({ workspace: root, stateRoot: join(root, '.state') });
      const preview = await tool.execute(call({ operations: [
        { type: 'modify', path: 'current.json', to: null, content: `{"purpose":"${purpose}","revision":2}` },
        { type: 'create', path: 'summary.txt', to: null, content: `${purpose}-summary` },
      ] }));
      const applied = await tool.execute(call({ action: 'apply', planHandle: preview.planHandle }));
      assert.equal(applied.state, 'published_verified');
      assert.equal(await readFile(join(root, 'summary.txt'), 'utf8'), `${purpose}-summary`);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
