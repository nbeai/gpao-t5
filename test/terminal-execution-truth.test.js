// P0 원장 진실 — 명령이 돌았는지(ran)와 이 컴퓨터의 사용자 상태가 바뀌었는지(localChanged)를 가른다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { sandboxAvailable } from '../src/runtime/sandbox.js';
import { receipt } from '../src/kernel/l0-evidence/tool-receipt.js';
import { 확인된사실 } from '../src/kernel/l0-evidence/ledger.js';
import { compactResult } from '../src/kernel/l1-intent/task-context.js';

test('성공한 probe는 실제로 돌았고, 로컬 사용자 상태는 바꾸지 않았다', async () => {
  const tool = makeLocalTerminalTool({
    run: async (command, { mode }) => ({ command, mode, sandboxed: true, exitCode: 0,
      stdout: 'hello-from-t5\nTue Aug 18', stderr: '', durationMs: 4 }),
    sandboxAvailable: () => true,
  });
  const r = await tool.handler({ command: 'echo hello-from-t5 && date' });

  assert.equal(r.result.ran, true, 'stdout을 받았는 명령을 실행 안 함으로 적었다');
  assert.equal(r.result.localChanged, false, '쓰기·시그널을 막은 probe의 로컬 무변경 증명이 없다');
  assert.equal(Object.hasOwn(r.result, 'applied'), false, '새 영수증이 이중 의미 칸 applied를 계속 낸다');
  assert.match(r.userSafeSummary, /실행했어요/);
  assert.doesNotMatch(r.userSafeSummary, /확인만 했어요|실제로는 안 돌았/);

  const wire = compactResult(r.result);
  assert.match(wire, /실제로 돌았다/);
  assert.match(wire, /로컬 사용자 상태 변경은 관측되지 않았다/);
  assert.doesNotMatch(wire, /실제로는 안 돌았다/);
});

test('network-only 실행은 로컬 무변경과 외부 효과를 함께 말한다', async () => {
  const tool = makeLocalTerminalTool({
    run: async (command, { mode, effects }) => ({ command, mode, effects, sandboxed: true,
      exitCode: 0, stdout: 'ok', stderr: '', durationMs: 5 }),
    sandboxAvailable: () => true,
  });
  const r = await tool.handler({
    command: 'opaque-network', granted: true, effects: ['network'],
    probeResult: { command: 'opaque-network', mode: 'probe', sandboxed: true, exitCode: 1,
      stdout: '', stderr: 'operation not permitted' },
  });
  assert.equal(r.result.ran, true);
  assert.equal(r.result.localChanged, false);
  const wire = compactResult(r.result);
  assert.match(wire, /승인되어 열린 효과 범위: network/);
  assert.match(wire, /로컬 사용자 상태 변경은 관측되지 않았다/);
  assert.doesNotMatch(r.userSafeSummary, /네트워크 효과가 수행|밖에서 읽어 온|아무것도 안 바꿔/,
    'POST도 가능한 network 효과를 읽기만 한 것으로 축소했다');
});

test('열린 network 범위를 실제 network 발생으로 승격하지 않는다', async () => {
  const tool = makeLocalTerminalTool({
    run: async (command, { mode, effects }) => ({ command, mode, effects, sandboxed: true,
      exitCode: 0, stdout: 'local-only', stderr: '', durationMs: 2 }),
    sandboxAvailable: () => true,
  });
  const r = await tool.handler({ command: 'printf local-only', granted: true, effects: ['network'] });
  const wire = compactResult(r.result);
  assert.match(wire, /승인되어 열린 효과 범위: network/);
  assert.doesNotMatch(wire, /network.*(수행|발생)|네트워크 효과가 수행/,
    '권한 봉투를 실제 발생 관측으로 승격했다');
  assert.doesNotMatch(r.userSafeSummary, /네트워크 효과가 수행/);
});

async function writeTool(dir) {
  return makeLocalTerminalTool({
    cwd: dir, sandboxAvailable: () => true,
    run: async (command, { mode, effects }) => {
      if (mode !== 'probe' && command === 'create') await writeFile(join(dir, 'new.txt'), 'new');
      if (mode !== 'probe' && command === 'delete') await unlink(join(dir, 'old.txt'));
      if (mode !== 'probe' && command === 'overwrite') await writeFile(join(dir, 'old.txt'), 'after');
      return { command, cwd: dir, mode, effects, exitCode: 0, stdout: '', stderr: '', durationMs: 3 };
    },
  });
}

test('새 파일 생성과 삭제는 로컬 변경이 관측됐다고 적는다', async () => {
  const createDir = await mkdtemp(join(tmpdir(), 't5-ran-create-'));
  const create = await (await writeTool(createDir)).handler({ command: 'create', granted: true, effects: ['write'] });
  assert.equal(create.result.ran, true);
  assert.equal(create.result.localChanged, true, '새 이름을 실제로 보고도 변경 관측을 비웠다');
  assert.equal(existsSync(join(createDir, 'new.txt')), true);

  const deleteDir = await mkdtemp(join(tmpdir(), 't5-ran-delete-'));
  await writeFile(join(deleteDir, 'old.txt'), 'old');
  const deleted = await (await writeTool(deleteDir)).handler({ command: 'delete', granted: true, effects: ['write'] });
  assert.equal(deleted.result.ran, true);
  assert.equal(deleted.result.localChanged, true, '사라진 이름을 보고도 변경 관측을 비웠다');
  assert.equal(existsSync(join(deleteDir, 'old.txt')), false);
});

test('기존 파일 덮어쓰기는 현 관측기가 못 재므로 false가 아니라 미상이다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ran-overwrite-'));
  await writeFile(join(dir, 'old.txt'), 'before');
  const r = await (await writeTool(dir)).handler({ command: 'overwrite', granted: true, effects: ['write'] });
  assert.equal(await readFile(join(dir, 'old.txt'), 'utf8'), 'after', '대조 전제: 실제 덮어쓰기가 돌아야 한다');
  assert.equal(r.result.ran, true);
  assert.equal(r.result.localChanged, undefined, '안 잰 것을 변경 없음으로 적었다');
});

test('확인된 PID 종료는 로컬 변경 관측이다', { skip: !sandboxAvailable() && '샌드박스 없음' }, async () => {
  for (let i = 0; i < 3; i += 1) {
    const child = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
    try {
      const tool = makeLocalTerminalTool();
      const r = await tool.handler({ command: `kill ${child.pid}`, granted: true, effects: ['signal'] });
      assert.equal(r.result.ran, true, `${i + 1}회: signal 실행 사실이 없다`);
      assert.equal(r.result.localChanged, true, `${i + 1}회: 종료 직후 경합을 아직 살아 있음으로 잘못 적었다`);
    } finally { try { process.kill(child.pid, 'SIGKILL'); } catch { /* 이미 종료 */ } }
  }
});

test('PID readback은 kill 피연산자만 보고 다른 구획의 숫자를 대상으로 지어내지 않는다', {
  skip: !sandboxAvailable() && '샌드박스 없음',
}, async () => {
  const child = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
  try {
    const tool = makeLocalTerminalTool();
    const r = await tool.handler({ command: `kill ${child.pid}; echo 999999`, granted: true, effects: ['signal'] });
    assert.deepEqual(r.result.terminated?.map((x) => x.pid), [child.pid],
      'kill 대상이 아닌 숫자까지 종료 확인 원장에 적었다');
    assert.equal(r.result.localChanged, true);
  } finally { try { process.kill(child.pid, 'SIGKILL'); } catch { /* 이미 종료 */ } }
});

test('타임아웃은 실행 사실과 실패를 함께 남기고, 미관측 변경은 비운다', async () => {
  const tool = makeLocalTerminalTool({
    run: async (command, { mode, effects }) => ({ command, mode, effects, exitCode: -1,
      stopped: 'timeout', stdout: 'partial', stderr: '', durationMs: 120000 }),
    sandboxAvailable: () => true,
  });
  const r = await tool.handler({ command: 'long-write', granted: true, effects: ['write'] });
  assert.equal(r.failed, true);
  assert.equal(r.result.ran, true);
  assert.equal(r.result.localChanged, undefined);
});

test('승인 전 sandbox block은 탐침 시도일 뿐 완료 실행으로 승격하지 않는다', async () => {
  const tool = makeLocalTerminalTool({
    run: async (command, { mode }) => ({ command, mode, sandboxed: true, exitCode: 1,
      stdout: '', stderr: 'touch: out.txt: Operation not permitted', durationMs: 2 }),
    sandboxAvailable: () => true,
  });
  const r = await tool.handler({ command: 'touch out.txt' });
  assert.equal(r.blocked, true);
  assert.equal(r.result.probeRan, true);
  assert.equal(r.result.ran, undefined, '막힌 탐침을 완료 실행으로 적었다');
  assert.equal(r.result.localChanged, false);
});

test('L0 원장은 ran을 실행 확인으로 쓰고 localChanged를 변경 주장으로만 둔다', () => {
  const rec = (result) => receipt({
    intended: 'local.terminal', actualCall: { tool: 'local.terminal', args: { command: 'x' } },
    result, userSafeSummary: '실행 관측',
  });
  assert.equal(확인된사실(rec({ ran: true, localChanged: false, exitCode: 0 })), true,
    '변경이 없어도 실행한 관측은 확인된 사실이다');
  assert.equal(확인된사실(rec({ ran: false, localChanged: false, exitCode: 0 })), false,
    '실행하지 않은 것을 확인으로 승격했다');
  assert.equal(확인된사실(rec({ applied: true, exitCode: 0 })), true, '구버전 성공 영수증이 깨졌다');
  assert.equal(확인된사실(rec({ applied: false, exitCode: 0 })), false, '구버전 미실행 영수증이 승격했다');
  assert.equal(확인된사실(rec({ ran: false, applied: true, exitCode: 0 })), false,
    '새 ran 사실을 구버전 applied가 덮었다');
});
