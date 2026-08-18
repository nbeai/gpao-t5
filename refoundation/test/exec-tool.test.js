import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeExecTool } from '../src/exec-tool.js';

async function rooms(fn) {
  const root = await mkdtemp(join(tmpdir(), 't5-exec-boundary-'));
  const workspace = join(root, 'workspace');
  const outside = join(root, 'outside');
  await Promise.all([mkdir(workspace), mkdir(outside)]);
  try { return await fn({ root, workspace, outside }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('exec는 부모 프로세스의 자격 환경변수를 셸에 상속하지 않는다', async () => rooms(async ({ workspace }) => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'must-not-reach-shell';
  try {
    const result = await makeExecTool({ workspace }).execute({
      command: 'if [ -z "${OPENAI_API_KEY+x}" ]; then printf clean; else printf leaked; fi',
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'clean');
    assert.doesNotMatch(result.stdout, /must-not-reach-shell/);
  } finally {
    if (previous == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
}));

test('exec는 workspace 안 심볼릭 링크를 통한 cwd 탈출을 거부한다', async () => rooms(async ({ workspace, outside }) => {
  await symlink(outside, join(workspace, 'escape'));
  const tool = makeExecTool({ workspace });
  await assert.rejects(
    () => tool.execute({ command: 'pwd', cwd: 'escape' }),
    /outside the isolated workspace/,
  );
}));

test('exec timeout은 실행 결과에 timeout 사실을 남긴다', async () => rooms(async ({ workspace }) => {
  const result = await makeExecTool({ workspace, timeoutMs: 20 }).execute({ command: 'sleep 1' });
  assert.equal(result.stopped, 'timeout');
  assert.notEqual(result.exitCode, 0);
}));
