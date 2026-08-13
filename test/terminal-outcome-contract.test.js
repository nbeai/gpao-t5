// 터미널 목적 라이브 원본(2026-08-13): 자식 프로세스가 결과를 돌려준 것과
// 그 명령이 성공한 것을 같은 사실로 읽으면 exit 1/127도 원장 성공이 된다.
// stdout/stderr/exit/cwd/command/effect는 실패를 설명하고 다음 손을 고를 현실이므로
// 실패 영수증에서도 보존한다. 앱·명령 이름이 아니라 공통 exit 계약을 잰다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { blockedWriteTarget, executionBlock, runCommand } from '../src/runtime/terminal-run.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';

const selfState = {
  connectedTools: [{ id: 'local.terminal', executable: true }],
};

async function 영수증(exitCode, { stdout = '', stderr = '' } = {}) {
  const command = 'generic-command --flag';
  const cwd = '/tmp/terminal-outcome-contract';
  const tool = makeLocalTerminalTool({
    cwd,
    run: async () => ({
      command,
      cwd,
      mode: 'probe',
      processState: 'delivered',
      exitCode,
      durationMs: 7,
      stdout,
      stderr,
    }),
  });
  return new ToolRunner({ 'local.terminal': tool }).run(
    'local.terminal', { command }, selfState,
  );
}

for (const [exitCode, stderr] of [[1, 'generic failure'], [127, 'command not found']]) {
  test(`exit ${exitCode}: 프로세스 전달과 명령 실패를 갈라 실패 영수증에 실행 사실을 보존한다`, async () => {
    const rec = await 영수증(exitCode, { stdout: 'partial output', stderr });

    assert.equal(rec.failureState, 'failed');
    assert.equal(rec.lifecycle, 'delivered', '프로세스 결과 전달까지 명령 실패로 지우면 안 된다');
    assert.deepEqual(rec.result?.effect, {
      process: 'delivered',
      commandExit: 'failure',
    });
    assert.equal(rec.result?.exitCode, exitCode);
    assert.equal(rec.result?.stdout, 'partial output');
    assert.equal(rec.result?.stderr, stderr);
    assert.equal(rec.result?.command, 'generic-command --flag');
    assert.equal(rec.result?.cwd, '/tmp/terminal-outcome-contract');
    assert.match(JSON.stringify(rec.diagnosticTrace), /partial output/,
      '모델 입력용 실패 원문에서 stdout이 사라졌다');
    assert.match(JSON.stringify(rec.diagnosticTrace), new RegExp(String(exitCode)),
      '모델 입력용 실패 원문에서 exit가 사라졌다');

    const tc = buildTaskContext({
      intent: interpret('명령 결과를 보고 다른 방법으로 이어가줘'),
      selfState: buildSelfState({
        model: { id: 'test-model' },
        connections: [{ id: 'local.terminal', connected: true, executable: true }],
      }),
      receipts: [rec],
    });
    const modelInput = JSON.stringify(buildModelMessages(tc));
    assert.match(modelInput, /partial output/, 'stdout이 실제 모델 입력까지 닿지 않았다');
    assert.match(modelInput, new RegExp(String(exitCode)), 'exit가 실제 모델 입력까지 닿지 않았다');
    assert.match(modelInput, /commandExit/, 'effect가 실제 모델 입력까지 닿지 않았다');
  });
}

test('pipefail 실행기는 파이프 앞 자식의 실패를 최상위 exit로 보존한다', async () => {
  const r = await runCommand('t5-definitely-missing-command | cat', { mode: 'raw' });
  assert.notEqual(r.exitCode, 0);
  assert.match(r.stderr, /command not found/);
});

test('stderr 문구만으로 명령 실패를 꾸며내지 않는다', async () => {
  const rec = await 영수증(0, { stderr: 'awk: non-terminated string이라는 사용자 데이터\n' });
  assert.equal(rec.failureState, 'none');
  assert.equal(rec.result?.effect?.commandExit, 'success');
});

test('뒤 echo가 exit 0으로 가려도 셸이 남긴 실제 리다이렉션 거부와 대상은 보존한다', () => {
  const cwd = '/private/tmp/t5-masked-write';
  const command = `cd ${cwd} && printf x > report.tsv; echo "EXIT:$?"`;
  const probe = { command, cwd: '/private/tmp', exitCode: 0, stdout: 'EXIT:1\n',
    stderr: 'zsh:1: operation not permitted: report.tsv\n' };
  assert.deepEqual(executionBlock(probe), {
    kind: 'sandbox', why: 'write',
    userWhy: '파일을 바꾸는 일이라 확인만 받으면 바로 실행해요 — 미리 시험해 봤고 아직 아무것도 안 바뀌었어요',
  });
  assert.equal(blockedWriteTarget(probe, { cwd: '/private/tmp' }), `${cwd}/report.tsv`);
});

test('문법 오류와 permission 토막이 함께 있어도 고쳐지지 않을 승인으로 보내지 않는다', () => {
  const block = executionBlock({ command: 'node -e "broken"', exitCode: 1, stdout: '',
    stderr: 'zsh:1: permission denied: /usr/local/bin\nSyntaxError: Unexpected token\n' });
  assert.equal(block?.kind, 'code');
  assert.equal(block?.why, 'failed');
});

test('exit 0 읽기 probe는 성공으로 유지하되 실행 효과의 두 층을 사실대로 남긴다', async () => {
  const rec = await 영수증(0, { stdout: 'observed\n' });
  assert.equal(rec.failureState, 'none');
  assert.equal(rec.lifecycle, 'delivered');
  assert.deepEqual(rec.result?.effect, {
    process: 'delivered',
    commandExit: 'success',
  });
  assert.equal(rec.result?.applied, false, '읽기 probe를 컴퓨터 변경으로 승격했다');
});

test('리다이렉션 대상을 뒤 명령의 파일 인자 때문에 실행파일로 오분류하지 않는다', () => {
  const command = 'make-report > report.tmp && rm report.tmp';
  const block = executionBlock({
    command,
    exitCode: 1,
    stdout: '',
    stderr: 'zsh:1: operation not permitted: report.tmp',
  });
  assert.equal(block?.kind, 'sandbox');
  assert.equal(block?.why, 'write');
});

test('맨 앞 cd 뒤 상대 쓰기 대상은 실제 셸 작업 폴더에서 푼다', () => {
  const target = blockedWriteTarget({
    command: "cd '/tmp/work/s3' && find . -type f > inventory.tsv",
    cwd: '/', exitCode: 1, stdout: '',
    stderr: 'zsh:1: operation not permitted: inventory.tsv',
  }, { cwd: '/' });
  assert.equal(target, '/tmp/work/s3/inventory.tsv');
});

test('변수로 정한 cd는 추측하지 않고 원래 cwd에 남긴다', () => {
  const target = blockedWriteTarget({
    command: 'cd "$TARGET" && echo x > result.tsv',
    cwd: '/safe/base', exitCode: 1, stdout: '',
    stderr: 'zsh:1: operation not permitted: result.tsv',
  }, { cwd: '/safe/base' });
  assert.equal(target, '/safe/base/result.tsv');
});

test('Node 표준 오류의 path 콜론 표기도 실제 쓰기 대상으로 읽는다', () => {
  const target = blockedWriteTarget({
    command: "node -e 'writeFileSync(\"/tmp/work/report.tsv\", \"x\")'",
    cwd: '/tmp/work', exitCode: 1, stdout: '',
    stderr: "Error: EPERM: operation not permitted, open '/tmp/work/report.tsv'\n  path: '/tmp/work/report.tsv'\n",
  }, { cwd: '/tmp/work' });
  assert.equal(target, '/tmp/work/report.tsv');
});

test('env·command 앞말 뒤의 실제 실행파일 판별은 유지한다', () => {
  for (const command of ['env missing-tool --flag', 'command missing-tool --flag']) {
    const block = executionBlock({
      command,
      exitCode: 1,
      stdout: '',
      stderr: 'zsh:1: operation not permitted: missing-tool',
    });
    assert.equal(block?.kind, 'env');
    assert.equal(block?.why, 'not_executable');
  }
});
