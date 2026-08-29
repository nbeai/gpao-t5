import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { explainShellCommand } from '../src/command-explainer.js';
import { ManagedProcessRegistry } from '../src/managed-process.js';
import { makeSnapshotProgramAdapter } from '../src/snapshot-program-adapter.js';
import { makeWorkspacePatchTool } from '../src/workspace-patch-tool.js';

const SESSION = '11111111-1111-4111-8111-111111111111';
const WORK = '22222222-2222-4222-8222-222222222222';
const command = (source) => `python3 - <<'PY'\n${source}\nPY`;

async function room() {
  const root = await mkdtemp(join(tmpdir(), 't5-snapshot-adapter-'));
  const workspace = join(root, 'workspace'); const state = join(root, 'state');
  await mkdir(workspace); const workspacePatchTool = makeWorkspacePatchTool({ workspace,
    stateRoot: join(state, 'authoring'), sessionId: SESSION });
  const options = { workspace, snapshotRoot: join(state, 'snapshots'),
    scratchRoot: join(state, 'scratch'), sessionId: SESSION, workId: WORK, revision: 1,
    processRegistry: new ManagedProcessRegistry({ platform: 'darwin' }), workspacePatchTool,
    executionPath: '/usr/bin:/bin', protectedReadRoots: [workspace] };
  return { root, workspace, state, workspacePatchTool, options };
}

async function execute(app, source, targets, overrides = {}) {
  const adapter = makeSnapshotProgramAdapter({ ...app.options, ...overrides });
  const shell = command(source);
  return { adapter, outcome: await adapter.execute({ args: { effect: { kind: 'local_change', targets } },
    commandExplanation: await explainShellCommand(shell), cwd: app.workspace }) };
}

test('사업·개발·개인 파일 세 목적은 same Python exact 1회→host observer→F→Undo→cleanup으로 닫힌다', async () => {
  const cases = [
    { name: 'business', inputs: [['입력/a.csv', 'name,amount\nA,10\n'], ['입력/b.csv', 'name,amount\nB,20\n']],
      outputs: ['결과/합계.csv', '결과/행수.csv'], source: [
        'import csv', 'from pathlib import Path', 'rows=[]',
        "for p in sorted(Path('입력').glob('*.csv')): rows += list(csv.DictReader(p.open()))",
        "Path('결과/합계.csv').write_text('total\\n'+str(sum(int(r['amount']) for r in rows))+'\\n')",
        "Path('결과/행수.csv').write_text('rows\\n'+str(len(rows))+'\\n')",
      ].join('\n'), oracle: async (workspace) => {
        assert.match(await readFile(join(workspace, '결과/합계.csv'), 'utf8'), /30/u);
        assert.match(await readFile(join(workspace, '결과/행수.csv'), 'utf8'), /2/u); } },
    { name: 'development', inputs: [['project/input.json', '{"failures":["A","B"]}']],
      outputs: ['project/report.json'], source: [
        'import json, sys', 'from pathlib import Path',
        "data=json.loads(Path('project/input.json').read_text())",
        "Path('project/report.json').write_text(json.dumps({'count':len(data['failures']),'argv0':sys.argv[0]}))",
      ].join('\n'), oracle: async (workspace) => assert.deepEqual(
        JSON.parse(await readFile(join(workspace, 'project/report.json'), 'utf8')), { count: 2, argv0: '-' }) },
    { name: 'personal', inputs: [['자료/메모.txt', '사과\n바나나\n사과\n']], outputs: ['정리/요약.txt'],
      source: [ 'from pathlib import Path', "items=Path('자료/메모.txt').read_text().splitlines()",
        "Path('정리/요약.txt').write_text('\\n'.join(sorted(set(items)))+'\\n')" ].join('\n'),
      oracle: async (workspace) => assert.equal(await readFile(join(workspace, '정리/요약.txt'), 'utf8'), '바나나\n사과\n') },
  ];
  for (const scenario of cases) {
    const app = await room();
    try {
      for (const [path, content] of scenario.inputs) { await mkdir(join(app.workspace, path, '..'), { recursive: true });
        await writeFile(join(app.workspace, path), content); }
      for (const path of scenario.outputs) await mkdir(join(app.workspace, path, '..'), { recursive: true });
      const before = await Promise.all(scenario.inputs.map(([path]) => readFile(join(app.workspace, path))));
      const { outcome } = await execute(app, scenario.source, scenario.outputs);
      assert.equal(outcome.handled, true, scenario.name);
      assert.equal(outcome.result.state, 'published_verified_cleaned', scenario.name);
      assert.equal(outcome.result.actualExecutions, 1); assert.equal(outcome.result.translated, false);
      assert.deepEqual(outcome.result.sourceUniverse, { coverage: 'complete', immutableGeneration: true,
        filesAndDigestsVerified: true, fileCount: scenario.inputs.length,
        manifestSha256: outcome.result.sourceUniverse.manifestSha256 });
      assert.equal(outcome.result.actualReadSet.state, 'unknown');
      assert.equal(outcome.result.outputCoverage.independentlyVerified, true);
      await scenario.oracle(app.workspace);
      for (const [index, [path]] of scenario.inputs.entries()) {
        assert.deepEqual(await readFile(join(app.workspace, path)), before[index]);
      }
      assert.deepEqual(await readdir(app.options.snapshotRoot), []);
      const undone = await app.workspacePatchTool.execute({ action: 'rollback',
        planHandle: null, undoHandle: outcome.result.publication.undoHandle, operations: [] });
      assert.equal(undone.state, 'rolled_back_verified');
      for (const path of scenario.outputs) await assert.rejects(() => readFile(join(app.workspace, path)), /ENOENT/u);
    } finally { await rm(app.root, { recursive: true, force: true }); }
  }
});

test('guest exit 0은 missing·unexpected·invalid output을 성공으로 만들지 않는다', async () => {
  for (const [name, source, reason] of [
    ['missing', 'pass', 'declared_output_missing_or_unsafe'],
    ['unexpected', "from pathlib import Path\nPath('결과/out.csv').write_text('x\\n1\\n')\nPath('debug.log').write_text('x')", 'unexpected_scratch_output'],
    ['invalid', "from pathlib import Path\nPath('결과/out.csv').write_text('a,b\\n\"broken')", 'invalid_csv'],
  ]) {
    const app = await room();
    try { await mkdir(join(app.workspace, '결과')); await writeFile(join(app.workspace, 'input.txt'), 'input');
      const { outcome } = await execute(app, source, ['결과/out.csv']);
      assert.equal(outcome.result.state, 'protected_program_failed', name);
      assert.equal(outcome.result.reason, reason, name); assert.equal(outcome.result.fallbackToExec, false);
      await assert.rejects(() => readFile(join(app.workspace, '결과/out.csv')), /ENOENT/u);
    } finally { await rm(app.root, { recursive: true, force: true }); }
  }
  const app = await room();
  try { await mkdir(join(app.workspace, '결과')); await writeFile(join(app.workspace, 'input.txt'), 'input');
    const { outcome } = await execute(app,
      "from pathlib import Path\nPath('결과/out.csv').write_text('x\\n1\\n')",
      ['결과/out.csv', '결과/out.csv']);
    assert.equal(outcome.result.reason, 'declared_output_duplicated');
    assert.equal(outcome.result.fallbackToExec, false);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('source universe 밖 read·write, network, child process는 publication 전에 닫힌다', async () => {
  const app = await room(); const outside = join(app.root, 'outside.txt'); await writeFile(outside, 'secret');
  try { await mkdir(join(app.workspace, '결과')); await writeFile(join(app.workspace, 'input.txt'), 'input');
    const attempts = [
      `from pathlib import Path\nPath(${JSON.stringify(outside)}).read_text()`,
      `from pathlib import Path\nPath(${JSON.stringify(outside)}).write_text('bad')`,
      "import _socket\ns=_socket.socket();s.connect(('127.0.0.1',9))",
      'import os\nos.fork()',
    ];
    for (const source of attempts) {
      const { outcome } = await execute(app, source, ['결과/out.txt']);
      assert.equal(outcome.result.state, 'protected_program_failed');
      assert.equal(outcome.result.fallbackToExec, false);
    }
    assert.equal(await readFile(outside, 'utf8'), 'secret');
    await assert.rejects(() => readFile(join(app.workspace, '결과/out.txt')), /ENOENT/u);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('publication 성공 뒤 cleanup 실패는 재발행하지 않고 cleanup unknown으로 분리한다', async () => {
  const app = await room(); await mkdir(join(app.workspace, '결과')); await writeFile(join(app.workspace, 'input.txt'), 'input'); let removals = 0;
  try {
    const removeSnapshot = async () => { removals += 1; return { state: 'snapshot_cleanup_unknown', removed: false }; };
    const { outcome } = await execute(app,
      "from pathlib import Path\nPath('결과/out.txt').write_text('ok')", ['결과/out.txt'], { removeSnapshot });
    assert.equal(outcome.result.state, 'published_verified_cleanup_unknown');
    assert.equal(outcome.result.publication.state, 'published_verified'); assert.equal(removals, 1);
    assert.equal(await readFile(join(app.workspace, '결과/out.txt'), 'utf8'), 'ok');
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('settlement 뒤 crash는 successor가 snapshot cleanup만 하고 Python·F transaction을 반복하지 않는다', async () => {
  const app = await room(); await mkdir(join(app.workspace, '결과')); await writeFile(join(app.workspace, 'input.txt'), 'input'); let executions = 0;
  try {
    const crash = Object.assign(new Error('simulated crash'), { simulateCrash: true });
    const baseExecute = app.options.processRegistry;
    const first = makeSnapshotProgramAdapter({ ...app.options,
      executePython: async (input) => { executions += 1;
        const { executePythonProgramQualification } = await import('../src/ephemeral-program-python.js');
        return executePythonProgramQualification(input); },
      onPublicationSettled: async () => { throw crash; } });
    const shell = command("from pathlib import Path\nPath('결과/out.txt').write_text('ok')");
    const explanation = await explainShellCommand(shell);
    await assert.rejects(() => first.execute({ args: { effect: { kind: 'local_change', targets: ['결과/out.txt'] } },
      commandExplanation: explanation, cwd: app.workspace }), /simulated crash/u);
    assert.equal(executions, 1); assert.equal(await readFile(join(app.workspace, '결과/out.txt'), 'utf8'), 'ok');
    const successor = makeSnapshotProgramAdapter({ ...app.options, processRegistry: baseExecute });
    const recovered = await successor.recovery;
    assert.ok(recovered.removed >= 1); assert.equal(executions, 1);
    assert.deepEqual(await readdir(app.options.snapshotRoot), []);
  } finally { await rm(app.root, { recursive: true, force: true }); }
});

test('일반 exec·일반 heredoc·다른 cwd는 snapshot backend에 들어가지 않는다', async () => {
  const app = await room();
  try {
    const adapter = makeSnapshotProgramAdapter(app.options);
    for (const [source, cwd] of [
      ['printf ok', app.workspace], ["cat <<'EOF'\nhello\nEOF", app.workspace],
      [command("print('x')"), app.root],
    ]) {
      assert.equal(await adapter.execute({ args: { effect: { kind: 'local_change', targets: ['x.txt'] } },
        commandExplanation: await explainShellCommand(source), cwd }), null);
    }
  } finally { await rm(app.root, { recursive: true, force: true }); }
});
