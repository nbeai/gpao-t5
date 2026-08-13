import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';

test('가역 결과를 만들고 스스로 미완료라 밝혔으면 같은 턴에 고친다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-unfinished-output-'));
  const output = join(dir, 'inventory.tsv');
  let first = true;
  let sawRepair = false;
  let repairPrompts = 0;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) {
        return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
      }
      if (tc?.goalNotReached?.산출물미완료) {
        repairPrompts += 1;
        if (repairPrompts === 1) return '이번 턴 실행 몫이 소진돼 아직 못 고쳤습니다.';
        sawRepair = true;
        return { text: '', toolCalls: [{ name: 'local.file', args: {
          action: 'write', path: output, text: 'name\tbytes\na.txt\t17\n',
        } }] };
      }
      if (opts.tools?.length && first) {
        first = false;
        return { text: '', toolCalls: [{ name: 'local.file', args: {
          action: 'write', path: output, text: 'name\tbytes\na.txt\t\n',
        } }] };
      }
      return '파일은 만들었지만 바이트 수는 아직 못 넣었습니다.';
    },
  };

  await runTurn({ text: `${output}에 파일명과 바이트 수를 완성해줘.` }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    model,
  });

  assert.equal(sawRepair, true, '모델이 스스로 미완료라고 밝혔는데 작업 고리가 종료됐다');
  assert.equal(await readFile(output, 'utf8'), 'name\tbytes\na.txt\t17\n');
});

test('빈 파생 결과를 원본 부재로 단정하기 전에 실제 원본을 읽고 같은 턴에 고친다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-empty-derived-output-'));
  const sourceA = join(dir, 'first.log');
  const sourceB = join(dir, 'second.log');
  const output = join(dir, 'summary.tsv');
  await import('node:fs/promises').then(({ writeFile }) => Promise.all([
    writeFile(sourceA, 'ERROR E_ONE\n'),
    writeFile(sourceB, 'ERROR E_TWO\n'),
  ]));
  let phase = 0;
  let sawGroundingNudge = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) {
        return { text: '', toolCalls: [{ name: 'work.deliverable', args: {
          output: 'file', sourcePolicy: 'all_current', verification: 'admin_grounded',
        } }] };
      }
      if (tc?.goalNotReached?.빈산출물근거없음) {
        sawGroundingNudge = true;
        return { text: '', toolCalls: [sourceA, sourceB].map((path) => ({
          name: 'local.file', args: { action: 'read', path },
        })) };
      }
      phase += 1;
      if (phase === 1) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list', path: dir } }] };
      if (phase === 2) return { text: '', toolCalls: [{ name: 'local.file', args: {
        action: 'write', path: output, text: '', source: sourceA,
      } }] };
      if (phase === 3) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: output } }] };
      if (phase === 4) return '결과가 비어 있으므로 원본에는 오류 코드가 없습니다.';
      if (phase === 5) return { text: '', toolCalls: [{ name: 'local.file', args: {
        action: 'write', path: output, text: 'E_ONE\t1\nE_TWO\t1\n', source: sourceA,
      } }] };
      if (phase === 6) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: output } }] };
      return '두 원본을 읽고 결과를 고쳐 다시 확인했습니다.';
    },
  };

  await runTurn({ text: `${dir}의 로그를 분석해 ${output}에 오류 코드별 횟수를 만들어줘.` }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    model,
  });

  assert.equal(sawGroundingNudge, true);
  assert.equal(await readFile(output, 'utf8'), 'E_ONE\t1\nE_TWO\t1\n');
});

test('파생 터미널 쓰기는 원문 내용 관측 뒤에만 실행하고 같은 턴에 이어 간다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-derived-terminal-observation-'));
  const source = join(dir, 'sales.csv'); const output = join(dir, 'summary.tsv');
  await writeFile(source, 'item,amount\nA,12\n', 'utf8');
  const command = "printf 'A\\t12\\n' > summary.tsv";
  let grantedRuns = 0; let phase = 0; let sawObservationRecovery = false;
  const localTerminal = makeLocalTerminalTool({ cwd: dir, workspaceRoot: dir, dataDir: join(dir, '.state'),
    sandboxAvailable: () => true, run: async (_command, opts = {}) => {
      if (opts.mode !== 'granted') return _command === 'ls'
        ? { command: _command, cwd: dir, mode: 'probe', processState: 'delivered', exitCode: 0,
          stdout: 'sales.csv\n', stderr: '', durationMs: 1 }
        : { command: _command, cwd: dir, mode: 'probe', processState: 'delivered', exitCode: 1,
          stdout: '', stderr: 'zsh:1: operation not permitted: summary.tsv\n', durationMs: 1 };
      grantedRuns += 1;
      await writeFile(opts.writeTarget, 'A\t12\n', 'utf8');
      return { command: _command, cwd: dir, mode: 'granted', processState: 'delivered', exitCode: 0,
        stdout: '', stderr: '', durationMs: 1 };
    } });
  const model = { async respond(tc, opts = {}) {
    if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: {
      output: 'file', sourcePolicy: 'all_current', verification: 'admin_grounded',
    } }] };
    const needsMore = tc?.goalNotReached || tc?.unmetDeliverable;
    if (needsMore && phase === 2) {
      sawObservationRecovery = true;
      phase = 3;
      return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: source } }] };
    }
    if (phase === 0) { phase = 1; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'ls', cwd: dir } }] }; }
    if (needsMore && phase === 1) { phase = 2; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command, cwd: dir } }] }; }
    if (needsMore && phase === 3) { phase = 4; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command, cwd: dir } }] }; }
    if (needsMore && phase === 4) { phase = 5; return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: output } }] }; }
    return '원본을 읽고 결과를 만들어 다시 확인했습니다.';
  } };
  await runTurn({ text: `${source}를 집계해 ${output} 결과 파일을 만들어줘.` }, {
    env: demoEnv({ include: ['local.file', 'local.terminal'], hands: ['local.file', 'local.terminal'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: join(dir, '.state') }), localTerminal }),
    model,
  });
  assert.equal(sawObservationRecovery, true, '원문을 읽는 같은 턴 복구로 돌아가지 않았다');
  assert.equal(grantedRuns, 1, '관측 전 쓰기가 실행됐거나 관측 후 쓰기가 실행되지 않았다');
  assert.equal(await readFile(output, 'utf8'), 'A\t12\n');
});

test('다른 폴더의 glob 원본은 그 폴더 신분을 보존해 모두 읽은 뒤 실행한다', async () => {
  const dir = await mkdtemp('/private/tmp/t5-derived-glob-folders-');
  const input = join(dir, 'input'); const outputDir = join(dir, 'output');
  const east = join(input, 'sales-east.csv'); const west = join(input, 'sales-west.csv');
  const output = join(outputDir, 'summary.tsv');
  await mkdir(input); await mkdir(outputDir);
  await writeFile(east, 'item,amount\nA,12\n');
  await writeFile(west, 'item,amount\nA,18\n');
  const command = `printf 'A\\t30\\n' > ${output}`;
  let grantedRuns = 0; let phase = 0;
  const localTerminal = makeLocalTerminalTool({ cwd: dir, workspaceRoot: dir, dataDir: join(dir, '.state'),
    sandboxAvailable: () => true, run: async (_command, opts = {}) => {
      if (opts.mode !== 'granted') return _command === 'ls input'
        ? { command: _command, cwd: dir, mode: 'probe', processState: 'delivered', exitCode: 0,
          stdout: 'sales-east.csv\nsales-west.csv\n', stderr: '', durationMs: 1 }
        : { command: _command, cwd: dir, mode: 'probe', processState: 'delivered', exitCode: 1,
          stdout: '', stderr: `zsh:1: operation not permitted: ${output}\n`, durationMs: 1 };
      grantedRuns += 1;
      await writeFile(opts.writeTarget, 'A\t30\n');
      return { command: _command, cwd: dir, mode: 'granted', processState: 'delivered', exitCode: 0,
        stdout: '', stderr: '', durationMs: 1 };
    } });
  const model = { async respond(tc) {
    if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: {
      output: 'file', sourcePolicy: 'all_current', verification: 'admin_grounded',
    } }] };
    if (phase === 0) { phase = 1; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'ls input', cwd: dir } }] }; }
    if (phase === 1) { phase = 2; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command, cwd: dir } }] }; }
    if ((tc?.goalNotReached?.원본관측필요 || tc?.unmetDeliverable) && phase === 2) {
      phase = 3; return { text: '', toolCalls: [east, west].map((path) => ({ name: 'local.file', args: { action: 'read', path } })) };
    }
    if (phase === 3) { phase = 4; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command, cwd: dir } }] }; }
    if (phase === 4) { phase = 5; return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: output } }] }; }
    return '두 입력을 모두 읽고 집계 결과를 다시 확인했습니다.';
  } };
  await runTurn({ text: 'input/sales-*.csv를 모두 집계해 output/summary.tsv 결과 파일을 만들어줘.' }, {
    env: demoEnv({ include: ['local.file', 'local.terminal'], hands: ['local.file', 'local.terminal'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: join(dir, '.files') }), localTerminal }),
    model,
  });
  assert.equal(grantedRuns, 1, 'glob 디렉터리를 잃어 원본을 읽고도 실행되지 않았다');
  assert.equal(await readFile(output, 'utf8'), 'A\t30\n');
});

test('모델이 쓰기만 반복해도 정확한 원본 read를 실행 줄에 세워 같은 턴에 회복한다', async () => {
  const dir = await mkdtemp('/private/tmp/t5-derived-runtime-grounding-');
  const source = join(dir, 'sales.csv'); const output = join(dir, 'summary.tsv');
  await writeFile(source, 'item,amount\nA,12\n');
  const command = `printf 'A\\t12\\n' > ${output}`;
  let grantedRuns = 0; let phase = 0;
  const localTerminal = makeLocalTerminalTool({ cwd: dir, workspaceRoot: dir, dataDir: join(dir, '.state'),
    sandboxAvailable: () => true, run: async (_command, opts = {}) => {
      if (_command === 'ls') return { command: _command, cwd: dir, mode: opts.mode ?? 'probe',
        processState: 'delivered', exitCode: 0, stdout: 'refunds.csv\n', stderr: '', durationMs: 1 };
      if (opts.mode !== 'granted') return { command: _command, cwd: dir, mode: 'probe',
        processState: 'delivered', exitCode: 1, stdout: '',
        stderr: `zsh:1: operation not permitted: ${output}\n`, durationMs: 1 };
      grantedRuns += 1; await writeFile(opts.writeTarget, 'A\t12\n');
      return { command: _command, cwd: dir, mode: 'granted', processState: 'delivered', exitCode: 0,
        stdout: '', stderr: '', durationMs: 1 };
    } });
  const model = { async respond(tc) {
    if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: {
      output: 'file', sourcePolicy: 'all_current', verification: 'admin_grounded',
    } }] };
    if (phase === 0) { phase = 1; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command, cwd: dir } }] }; }
    if (phase === 1) { phase = 2; return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: output } }] }; }
    return '원본에 근거해 결과를 만들고 다시 확인했습니다.';
  } };
  await runTurn({ text: `${source}를 집계해 ${output} 결과 파일을 만들어줘.` }, {
    env: demoEnv({ include: ['local.file', 'local.terminal'], hands: ['local.file', 'local.terminal'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: join(dir, '.files') }), localTerminal }),
    model,
  });
  assert.equal(grantedRuns, 1, '정확한 원본 read 뒤 원래 쓰기를 자동 재개하지 않았다');
  assert.equal(await readFile(output, 'utf8'), 'A\t12\n');
});

test('재읽은 파생 결과가 원본·요구와 다르면 모델 검증 차례에서 같은 턴에 수리한다', async () => {
  const dir = await mkdtemp('/private/tmp/t5-derived-semantic-repair-');
  const source = join(dir, 'refunds.csv'); const output = join(dir, 'net.tsv');
  await writeFile(source, 'item,amount\nB,4\n');
  const command = `printf 'B\\t4\\nitem\\t0\\n' > ${output}`;
  let grantedRuns = 0; let phase = 0; let sawVerification = false;
  const localTerminal = makeLocalTerminalTool({ cwd: dir, workspaceRoot: dir, dataDir: join(dir, '.state'),
    sandboxAvailable: () => true, run: async (_command, opts = {}) => {
      if (_command === 'ls') return { command: _command, cwd: dir, mode: opts.mode ?? 'probe',
        processState: 'delivered', exitCode: 0, stdout: 'refunds.csv\n', stderr: '', durationMs: 1 };
      if (opts.mode !== 'granted') return { command: _command, cwd: dir, mode: 'probe',
        processState: 'delivered', exitCode: 1, stdout: '',
        stderr: `zsh:1: operation not permitted: ${output}\n`, durationMs: 1 };
      grantedRuns += 1; await writeFile(opts.writeTarget, 'B\t4\nitem\t0\n');
      return { command: _command, cwd: dir, mode: 'granted', processState: 'delivered', exitCode: 0,
        stdout: '', stderr: '', durationMs: 1 };
    } });
  const model = { async respond(tc) {
    if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: {
      output: 'file', sourcePolicy: 'all_current', verification: 'admin_grounded',
    } }] };
    if (phase === 0) { phase = 1; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'ls', cwd: dir } }] }; }
    if (phase === 1) { phase = 2; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command, cwd: dir } }] }; }
    if (tc?.goalNotReached?.산출물대조필요 && phase === 2) {
      sawVerification = true; phase = 3;
      return { text: '', toolCalls: [{ name: 'local.file', args: {
        action: 'write', path: output, text: 'B\t-4\n', source,
      } }] };
    }
    if (phase === 3) { phase = 4; return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: output } }] }; }
    return '환불을 차감하고 불필요한 헤더 행을 제거한 결과를 다시 확인했습니다.';
  } };
  await runTurn({ text: `${source}를 집계해 환불을 차감한 ${output} 결과 파일을 만들어줘.` }, {
    env: demoEnv({ include: ['local.file', 'local.terminal'], hands: ['local.file', 'local.terminal'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: join(dir, '.files') }), localTerminal }),
    model,
  });
  assert.equal(grantedRuns, 1);
  assert.equal(sawVerification, true, '실물 재읽기 뒤 의미 대조 차례가 모델에게 오지 않았다');
  assert.equal(await readFile(output, 'utf8'), 'B\t-4\n');
});
