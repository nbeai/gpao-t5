import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeWorkspacePatchTool } from '../src/workspace-patch-tool.js';

const call = (overrides = {}) => ({ action: 'preview', planHandle: null, operations: [], ...overrides });

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
