import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeExecTool } from '../src/exec-tool.js';
import { ManagedMutationObserver } from '../src/managed-mutation-observer.js';

const effect = (target) => ({ kind: 'local_change', targets: [target],
  confirmation: 'not_applicable', rollbackOfToolCallId: null });

test('S4-F baseline: 세 파일 순차 authoring의 마지막 실패는 앞선 두 파일을 자동 복원하지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-f-partial-'));
  try {
    const tool = makeExecTool({ workspace: root, explainCommand: async () => ({ ok: false }),
      mutationObserver: new ManagedMutationObserver(root) });
    const [a, b, c] = ['a.txt', 'b.txt', 'c.txt'].map((name) => join(root, name));
    assert.equal((await tool.execute({ command: `printf A2 > ${JSON.stringify(a)}`,
      cwd: null, effect: effect(a) })).state, 'completed');
    assert.equal((await tool.execute({ command: `printf B2 > ${JSON.stringify(b)}`,
      cwd: null, effect: effect(b) })).state, 'completed');
    assert.equal((await tool.execute({ command: 'exit 9', cwd: null, effect: effect(c) })).state, 'failed');
    assert.equal(await readFile(a, 'utf8'), 'A2'); assert.equal(await readFile(b, 'utf8'), 'B2');
    await assert.rejects(readFile(c, 'utf8'), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('S4-F baseline: read 뒤 바뀐 preimage를 foreground shell write가 stale fence 없이 덮는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-f-stale-')); const target = join(root, 'config.txt');
  try {
    await writeFile(target, 'read-version');
    const originallyRead = await readFile(target, 'utf8'); assert.equal(originallyRead, 'read-version');
    await writeFile(target, 'external-version');
    const tool = makeExecTool({ workspace: root, explainCommand: async () => ({ ok: false }) });
    const result = await tool.execute({ command: `printf model-version > ${JSON.stringify(target)}`,
      cwd: null, effect: effect(target) });
    assert.equal(result.state, 'completed'); assert.equal(await readFile(target, 'utf8'), 'model-version');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('S4-F baseline: shell quoting은 요청한 literal content를 환경 확장으로 바꿀 수 있다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-f-quoting-')); const target = join(root, 'literal.txt');
  try {
    const tool = makeExecTool({ workspace: root, explainCommand: async () => ({ ok: false }) });
    await tool.execute({ command: `printf "$HOME" > ${JSON.stringify(target)}`,
      cwd: null, effect: effect(target) });
    assert.notEqual(await readFile(target, 'utf8'), '$HOME');
  } finally { await rm(root, { recursive: true, force: true }); }
});
