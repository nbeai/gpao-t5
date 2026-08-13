import { test } from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdtemp, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { sandboxProfile } from '../src/runtime/sandbox.js';

const 계약답 = (tc) => tc?.workContractAssessment
  ? { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] }
  : null;

async function 제품경로({ target, command, stderr, apply, seed, grantedExitCode = 0 }) {
  const root = await mkdtemp(join(tmpdir(), 'terminal-write-effect-product-'));
  const work = join(root, 'work');
  const state = join(root, 'state');
  await mkdir(work, { recursive: true });
  const actualTarget = target(work);
  if (seed !== undefined) await writeFile(actualTarget, seed, 'utf8');
  let grantedRuns = 0;
  const localTerminal = makeLocalTerminalTool({
    cwd: work,
    dataDir: state,
    sandboxAvailable: () => true,
    run: async (_command, opts = {}) => {
      if (opts.mode !== 'granted') return {
        command, cwd: work, mode: 'probe', processState: 'delivered', exitCode: 1,
        stdout: '', stderr: stderr(actualTarget), durationMs: 1,
      };
      grantedRuns += 1;
      await apply(opts.writeTarget ?? actualTarget);
      return {
        command, cwd: work, mode: 'granted', processState: 'delivered', exitCode: grantedExitCode,
        stdout: 'done\n', stderr: grantedExitCode === 0 ? '' : 'failed after write\n', durationMs: 1,
      };
    },
  });
  const localFile = makeLocalFileTool({ roots: [work], home: work, dataDir: state });
  let issued = false;
  const model = { async respond(tc, opts = {}) {
    const contract = 계약답(tc);
    if (contract) return contract;
    if (tc?.currentActionAssessment) return { text: '', toolCalls: [{
      name: 'work.current_actions', args: {
        unclear: false, requestedIndexes: tc.currentActionAssessment.candidates.map((c) => c.index),
      },
    }] };
    if (opts.tools?.length && !issued) {
      issued = true;
      return { text: '', toolCalls: [{ name: 'local.terminal', args: { command, cwd: work } }] };
    }
    return '결과를 확인했어요.';
  } };
  const ctx = { env: demoEnv(), tools: demoTools({ localFile, localTerminal }), model };
  const result = await runTurn({ text: '작업 폴더 안에 결과물을 만들고 확인해' }, ctx);
  return { root, work, state, actualTarget, localFile, localTerminal, grantedRuns, result, ctx };
}

const terminalReceiptOf = (result) => {
  const exchange = result.turnExchange?.find((r) => r.tool === 'local.terminal');
  return exchange?.data ? { result: JSON.parse(exchange.data), args: exchange.args } : undefined;
};

test('가역 실행 profile은 증명된 대상 하나만 열고 다른 쓰기·외부 효과는 계속 닫는다', () => {
  const profile = sandboxProfile('reversible', { writeTarget: '/tmp/work/report.tsv', scratch: '/tmp/scratch' });
  assert.match(profile, /deny file-write\*/);
  assert.match(profile, /allow file-write\* \(literal "\/tmp\/work\/report\.tsv"\)/);
  assert.match(profile, /deny network\*/);
  assert.match(profile, /deny signal/);
  assert.match(profile, /deny appleevent-send/);
});

test('제품 경로: 없던 로컬 산출물 생성은 probe 대상·사전 상태·undo가 서면 승인 0으로 실행된다', async () => {
  const command = "awk '{print $1}' input.log > report.tsv";
  const stage = await 제품경로({
    target: (work) => join(work, 'report.tsv'),
    command,
    stderr: () => 'zsh:1: operation not permitted: report.tsv\n',
    apply: (target) => writeFile(target, 'E42\t3\n', 'utf8'),
  });

  assert.notEqual(stage.result.kind, 'approval', '새 산출물 생성이 정적 terminal descriptor 때문에 카드로 갔다');
  assert.equal(stage.grantedRuns, 1, '가역 생성이 자동 실행되지 않았다');
  assert.equal(await readFile(stage.actualTarget, 'utf8'), 'E42\t3\n');
  const terminalReceipt = terminalReceiptOf(stage.result);
  assert.deepEqual(terminalReceipt?.result?.writeEffect?.target?.path, stage.actualTarget);
  assert.equal(terminalReceipt?.result?.writeEffect?.operation, 'create');
  assert.equal(terminalReceipt?.result?.writeEffect?.reversible, true);

  const undone = await stage.localFile.handler({ action: 'undo' });
  assert.equal(undone.result?.undone, 'create', '터미널 생성이 공통 undo 원장에 안 묶였다');
  await assert.rejects(readFile(stage.actualTarget, 'utf8'), /ENOENT/);
});

test('라이브 모양: Python heredoc의 일반 write-open도 진단 대상과 합치면 새 산출물로 실행된다', async () => {
  const command = "python3 - << 'PY'\nout_path = 'report.tsv'\nwith open(out_path, 'w', newline='') as f:\n    f.write('ok\\n')\nPY";
  const stage = await 제품경로({
    target: (work) => join(work, 'report.tsv'), command,
    stderr: () => "Traceback (most recent call last):\nPermissionError: [Errno 1] Operation not permitted: 'report.tsv'\n",
    apply: (target) => writeFile(target, 'ok\n', 'utf8'),
  });
  assert.notEqual(stage.result.kind, 'approval');
  assert.equal(stage.grantedRuns, 1);
  assert.equal(await readFile(stage.actualTarget, 'utf8'), 'ok\n');
});

test('제품 경로: 하위 input cwd에서 형제 output에 만드는 결과도 work 안이면 승인 0이다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-sibling-output-'));
  const work = join(root, 'work');
  const input = join(work, 'job', 'input');
  const output = join(work, 'job', 'output');
  const state = join(root, 'state');
  await mkdir(input, { recursive: true });
  await mkdir(output, { recursive: true });
  const target = join(output, 'result.tsv');
  const command = "printf 'ok\\n' > ../output/result.tsv";
  let grantedRuns = 0;
  const tool = makeLocalTerminalTool({
    cwd: input, workspaceRoot: work, dataDir: state, sandboxAvailable: () => true,
    run: async (_command, opts = {}) => {
      if (opts.mode !== 'granted') return { command, cwd: input, mode: 'probe',
        processState: 'delivered', exitCode: 1, stdout: '',
        stderr: 'zsh:1: operation not permitted: ../output/result.tsv\n', durationMs: 1 };
      grantedRuns += 1;
      await writeFile(opts.writeTarget ?? target, 'ok\n', 'utf8');
      return { command, cwd: input, mode: 'granted', processState: 'delivered', exitCode: 0,
        stdout: '', stderr: '', durationMs: 1 };
    },
  });
  const probed = await tool.probe(command, { cwd: input });
  assert.equal(probed.writeEffect?.reversible, true);
  assert.equal(probed.writeEffect?.target?.path, target);
  const executed = await tool.handler({ command, cwd: input, changes: true, granted: true,
    probeResult: probed.probe, writeEffect: probed.writeEffect });
  assert.equal(executed.blocked, undefined);
  assert.equal(grantedRuns, 1);
  assert.equal(await readFile(target, 'utf8'), 'ok\n');
});

test('가역 실행 명령이 실패하면 만든 파일을 회수하고 성공 효과로 기록하지 않는다', async () => {
  const stage = await 제품경로({
    target: (work) => join(work, 'partial.tsv'), command: "printf x > partial.tsv",
    stderr: () => 'zsh:1: operation not permitted: partial.tsv\n',
    apply: (target) => writeFile(target, 'partial\n', 'utf8'), grantedExitCode: 1,
  });
  assert.equal(stage.grantedRuns, 1);
  await assert.rejects(readFile(stage.actualTarget, 'utf8'), /ENOENT/);
  assert.match(stage.result.ledger.unconfirmed.join('\n'), /이전 상태로 되돌렸어요/);
});

test('제품 경로: 기존 로컬 파일의 단일 overwrite는 preimage를 보존하고 승인 0·undo·검증까지 간다', async () => {
  const command = "printf 'after\\n' > report.tsv";
  let beforePath;
  const root = await mkdtemp(join(tmpdir(), 'terminal-write-effect-before-'));
  // 제품경로가 만드는 독립 work를 써야 하므로 apply 전에 fixture를 심는 hook 대신 command probe
  // 직전의 target을 잡아 첫 granted 실행에서만 쓰는 대역을 아래 별도 무대로 구성한다.
  const work = join(root, 'work'); const state = join(root, 'state');
  await mkdir(work, { recursive: true });
  beforePath = join(work, 'report.tsv');
  await writeFile(beforePath, 'before\n', 'utf8');
  let grantedRuns = 0;
  const localTerminal = makeLocalTerminalTool({
    cwd: work, dataDir: state, sandboxAvailable: () => true,
    run: async (_command, opts = {}) => {
      if (opts.mode !== 'granted') return {
        command, cwd: work, mode: 'probe', processState: 'delivered', exitCode: 1,
        stdout: '', stderr: 'zsh:1: operation not permitted: report.tsv\n', durationMs: 1,
      };
      grantedRuns += 1;
      await writeFile(opts.writeTarget ?? beforePath, 'after\n', 'utf8');
      return { command, cwd: work, mode: 'granted', processState: 'delivered', exitCode: 0,
        stdout: '', stderr: '', durationMs: 1 };
    },
  });
  const localFile = makeLocalFileTool({ roots: [work], home: work, dataDir: state });
  let issued = false;
  const model = { async respond(tc, opts = {}) {
    const contract = 계약답(tc); if (contract) return contract;
    if (opts.tools?.length && !issued) {
      issued = true;
      return { text: '', toolCalls: [{ name: 'local.terminal', args: { command, cwd: work } }] };
    }
    return '바꾼 뒤 다시 확인했어요.';
  } };
  const ctx = { env: demoEnv(), tools: demoTools({ localFile, localTerminal }), model };
  const result = await runTurn({ text: '작업 폴더의 report.tsv를 새 결과로 갱신해' }, ctx);

  assert.notEqual(result.kind, 'approval', 'preimage를 보존할 수 있는 overwrite가 카드로 갔다');
  assert.equal(grantedRuns, 1);
  assert.equal(await readFile(beforePath, 'utf8'), 'after\n');
  const terminalReceipt = terminalReceiptOf(result);
  assert.equal(terminalReceipt?.result?.writeEffect?.operation, 'overwrite');
  assert.equal(terminalReceipt?.result?.writeEffect?.verified, true);
  assert.equal(terminalReceipt?.result?.writeEffect?.reversible, true);

  const undone = await localFile.handler({ action: 'undo' });
  assert.equal(undone.result?.undone, 'write');
  assert.equal(await readFile(beforePath, 'utf8'), 'before\n');
});

test('작업공간 밖 파일의 hardlink는 가역 overwrite로 자동 실행하지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-hardlink-boundary-'));
  const work = join(root, 'work'); const state = join(root, 'state');
  await mkdir(work, { recursive: true });
  const outside = join(root, 'outside-secret.txt');
  const target = join(work, 'report.tsv');
  await writeFile(outside, 'SECRET\n', 'utf8');
  await link(outside, target);
  const command = "printf 'CHANGED\\n' > report.tsv";
  let grantedRuns = 0;
  const tool = makeLocalTerminalTool({ cwd: work, workspaceRoot: work, dataDir: state,
    sandboxAvailable: () => true, run: async (_command, opts = {}) => {
      if (opts.mode === 'granted') { grantedRuns += 1; await writeFile(target, 'CHANGED\n', 'utf8'); }
      return { command, cwd: work, mode: opts.mode ?? 'probe', processState: 'delivered',
        exitCode: opts.mode === 'granted' ? 0 : 1, stdout: '',
        stderr: opts.mode === 'granted' ? '' : 'zsh:1: operation not permitted: report.tsv\n', durationMs: 1 };
    } });
  const probed = await tool.probe(command, { cwd: work });
  assert.equal(probed.writeEffect?.reversible, false);
  assert.equal(probed.writeEffect?.identitySafe, false);
  const approved = await tool.handler({ command, cwd: work, granted: true,
    probeResult: probed.probe, writeEffect: probed.writeEffect });
  assert.equal(approved.blocked, true);
  assert.equal(grantedRuns, 0);
  assert.equal(await readFile(outside, 'utf8'), 'SECRET\n');
});

test('작업공간 안 부모 symlink가 밖을 가리키면 새 파일 자동 쓰기를 열지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-parent-symlink-boundary-'));
  const work = join(root, 'work'); const outside = join(root, 'outside'); const state = join(root, 'state');
  await mkdir(work, { recursive: true }); await mkdir(outside, { recursive: true });
  await symlink(outside, join(work, 'linked'));
  const command = "printf 'x\\n' > linked/report.tsv";
  let grantedRuns = 0;
  const tool = makeLocalTerminalTool({ cwd: work, workspaceRoot: work, dataDir: state,
    sandboxAvailable: () => true, run: async (_command, opts = {}) => {
      if (opts.mode === 'granted') { grantedRuns += 1; await writeFile(join(outside, 'report.tsv'), 'x\n'); }
      return { command, cwd: work, mode: opts.mode ?? 'probe', processState: 'delivered',
        exitCode: opts.mode === 'granted' ? 0 : 1, stdout: '',
        stderr: opts.mode === 'granted' ? '' : 'zsh:1: operation not permitted: linked/report.tsv\n', durationMs: 1 };
    } });
  const probed = await tool.probe(command, { cwd: work });
  assert.equal(probed.writeEffect?.reversible, false);
  assert.equal(probed.writeEffect?.identitySafe, false);
  const approved = await tool.handler({ command, cwd: work, granted: true,
    probeResult: probed.probe, writeEffect: probed.writeEffect });
  assert.equal(approved.blocked, true);
  assert.equal(grantedRuns, 0);
  await assert.rejects(readFile(join(outside, 'report.tsv'), 'utf8'), /ENOENT/);
});

test('probe 뒤 부모가 바깥 symlink로 바뀌어도 격리 산출물을 밖에 적용하지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-parent-swap-boundary-'));
  const work = join(root, 'work'); const safe = join(work, 'safe');
  const parked = join(work, 'safe-parked'); const outside = join(root, 'outside');
  const state = join(root, 'state');
  await mkdir(safe, { recursive: true }); await mkdir(outside, { recursive: true });
  const command = "printf 'x\\n' > safe/report.tsv";
  const tool = makeLocalTerminalTool({ cwd: work, workspaceRoot: work, dataDir: state,
    sandboxAvailable: () => true, run: async (_command, opts = {}) => {
      if (opts.mode !== 'granted') return { command, cwd: work, mode: 'probe',
        processState: 'delivered', exitCode: 1, stdout: '',
        stderr: 'zsh:1: operation not permitted: safe/report.tsv\n', durationMs: 1 };
      // prepareWrite가 실제 부모를 봉인한 직후, 다른 프로세스가 사용자가 본 경로를 바꾼 상황.
      await rename(safe, parked);
      await symlink(outside, safe);
      await writeFile(opts.writeTarget, 'x\n', 'utf8');
      return { command, cwd: work, mode: 'granted', processState: 'delivered', exitCode: 0,
        stdout: '', stderr: '', durationMs: 1 };
    } });
  const probed = await tool.probe(command, { cwd: work });
  assert.equal(probed.writeEffect?.reversible, true);
  const executed = await tool.handler({ command, cwd: work, granted: true,
    probeResult: probed.probe, writeEffect: probed.writeEffect });
  assert.equal(executed.failed, true);
  assert.equal(executed.result?.writeEffect?.verified, false);
  await assert.rejects(readFile(join(outside, 'report.tsv'), 'utf8'), /ENOENT/);
  await assert.rejects(readFile(join(parked, 'report.tsv'), 'utf8'), /ENOENT/);
});

for (const blocked of [
  {
    name: '기존 파일 삭제는 대상이 보여도 자동으로 열리지 않는다',
    command: 'rm victim.txt',
    target: (work) => join(work, 'victim.txt'),
    stderr: () => 'rm: victim.txt: Operation not permitted\n',
    seed: 'keep\n',
  },
  {
    name: '작업 폴더 밖 시스템 변경은 자동으로 열리지 않는다',
    command: "printf x > /etc/t5-test.conf",
    target: () => '/etc/t5-test.conf',
    stderr: () => 'zsh:1: operation not permitted: /etc/t5-test.conf\n',
  },
]) test(`제품 경로 음성: ${blocked.name}`, async () => {
  const stage = await 제품경로({
    ...blocked,
    apply: async () => { throw new Error('승인 전에 실행되면 안 됨'); },
  });
  assert.equal(stage.result.kind, 'approval');
  assert.equal(stage.grantedRuns, 0);
});
