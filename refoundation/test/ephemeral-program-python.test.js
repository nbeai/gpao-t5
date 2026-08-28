import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { admitExecProgramContract } from '../src/exec-program-contract.js';
import { executePythonProgramQualification, observePythonInterpreter } from '../src/ephemeral-program-python.js';
import { ManagedProcessRegistry } from '../src/managed-process.js';
import { makeRecordReference } from '../src/record-reference.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const sourceBytes = Buffer.from('name,amount\nA,10\nB,20\n');

function reference() {
  return makeRecordReference({ sourceKind: 'local_file', sourceStore: 'fixture', sourceId: 'source.csv',
    sourceRevision: 1, sha256: hash(sourceBytes), occurredAt: null,
    recordedAt: '2026-08-29T00:00:00.000Z', scope: {
      sessionId: 'session', workId: 'work', subjectKeys: [], channel: null,
    }, trust: 'runtime_observed', sensitivity: 'personal', coverage: 'full', availability: 'available' });
}

function contract(source) {
  return admitExecProgramContract({ workId: 'work', revision: 1, temporary: true,
    sourceLanguage: 'python', source, interpreter: '/usr/bin/python3',
    inputs: [{ relativePath: 'inputs/source.csv', recordRef: reference() }],
    outputs: [{ relativePath: 'outputs/result.csv', kind: 'text/csv', category: 'publishable' }],
    requirements: { filesystem: true, network: false, childProcess: false, packages: false } });
}

function reader(bytes = sourceBytes) {
  return { async reopen() { return { state: 'reopened', source: Buffer.from(bytes),
    accounting: { digestMatched: hash(bytes) === hash(sourceBytes) } }; } };
}

async function room() {
  return mkdtemp(join(tmpdir(), 't5-python-capsule-'));
}

test('same-language Python은 frozen input을 scratch에서 처리하고 source 번역·user target write 없이 끝난다', async () => {
  const root = await room();
  try {
    const interpreter = await observePythonInterpreter({ path: '/usr/bin/python3' });
    const source = [
      'import csv', 'from pathlib import Path',
      "rows = list(csv.DictReader(Path('inputs/source.csv').open()))",
      "Path('outputs').mkdir()",
      "with Path('outputs/result.csv').open('w', newline='') as stream:",
      "    writer = csv.writer(stream); writer.writerow(['total']); writer.writerow([sum(int(row['amount']) for row in rows)])",
    ].join('\n');
    const result = await executePythonProgramQualification({ contract: contract(source), interpreter,
      sourceReader: reader(), processRegistry: new ManagedProcessRegistry({ platform: 'darwin' }),
      scratchRoot: join(root, 'scratch'), protectedReadRoots: [join(root, 'protected')] });
    assert.equal(result.receipt.state, 'actual_output_unverified');
    assert.equal(result.receipt.translated, false);
    assert.equal(result.receipt.userTargetWrites, 0);
    assert.equal(result.receipt.networkDenied, true);
    assert.equal(result.receipt.processForkDenied, true);
    assert.equal(result.execution.contract.source, source);
    assert.match(result.execution.outputs[0].bytes.toString('utf8'), /30/u);
    assert.deepEqual(await readdir(join(root, 'scratch')), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const [name, source] of [
  ['child fork', "import os\nos.fork()\n"],
  ['network', "import _socket\ns=_socket.socket(); s.connect(('127.0.0.1', 9))\n"],
]) {
  test(`Python ${name} effect는 output publication 전에 물리 경계에서 닫힌다`, async () => {
    const root = await room();
    try {
      const interpreter = await observePythonInterpreter({ path: '/usr/bin/python3' });
      const result = await executePythonProgramQualification({ contract: contract(source), interpreter,
        sourceReader: reader(), processRegistry: new ManagedProcessRegistry({ platform: 'darwin' }),
        scratchRoot: join(root, 'scratch') });
      assert.equal(result.execution, null);
      assert.equal(result.receipt.state, 'actual_failed_no_effect');
      assert.equal(result.receipt.boundaryDenied, true);
      assert.equal(result.receipt.userTargetWrites, 0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test('Python은 bound scratch 밖 source를 읽을 수 없다', async () => {
  const root = await room(); const protectedFile = join(root, 'protected', 'secret.txt');
  try {
    await mkdir(join(root, 'protected')); await writeFile(protectedFile, 'secret');
    const interpreter = await observePythonInterpreter({ path: '/usr/bin/python3' });
    const source = `from pathlib import Path\nPath(${JSON.stringify(protectedFile)}).read_text()\n`;
    const result = await executePythonProgramQualification({ contract: contract(source), interpreter,
      sourceReader: reader(), processRegistry: new ManagedProcessRegistry({ platform: 'darwin' }),
      scratchRoot: join(root, 'scratch'), protectedReadRoots: [join(root, 'protected')] });
    assert.equal(result.execution, null);
    assert.equal(result.receipt.boundaryDenied, true);
    assert.equal(await readFile(protectedFile, 'utf8'), 'secret');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Python은 scratch 밖 target을 쓸 수 없고 user target은 생기지 않는다', async () => {
  const root = await room(); const outsideTarget = join(root, 'outside.txt');
  try {
    const interpreter = await observePythonInterpreter({ path: '/usr/bin/python3' });
    const source = `from pathlib import Path\nPath(${JSON.stringify(outsideTarget)}).write_text('bad')\n`;
    const result = await executePythonProgramQualification({ contract: contract(source), interpreter,
      sourceReader: reader(), processRegistry: new ManagedProcessRegistry({ platform: 'darwin' }),
      scratchRoot: join(root, 'scratch') });
    assert.equal(result.execution, null);
    assert.equal(result.receipt.boundaryDenied, true);
    assert.equal(result.receipt.userTargetWrites, 0);
    await assert.rejects(() => readFile(outsideTarget), /ENOENT/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Python의 undeclared scratch output과 staged input 변경은 publishable 결과가 아니다', async () => {
  const root = await room();
  try {
    const interpreter = await observePythonInterpreter({ path: '/usr/bin/python3' });
    const unexpected = await executePythonProgramQualification({ contract: contract([
      'from pathlib import Path', "Path('outputs').mkdir()", "Path('outputs/result.csv').write_text('ok')",
      "Path('debug.log').write_text('diagnostic')",
    ].join('\n')), interpreter, sourceReader: reader(),
    processRegistry: new ManagedProcessRegistry({ platform: 'darwin' }), scratchRoot: join(root, 'scratch-a') });
    assert.equal(unexpected.execution, null);
    assert.equal(unexpected.receipt.reason, 'unexpected_scratch_output');
    const changedInput = await executePythonProgramQualification({ contract: contract([
      'from pathlib import Path', "Path('inputs/source.csv').write_text('changed')",
      "Path('outputs').mkdir()", "Path('outputs/result.csv').write_text('ok')",
    ].join('\n')), interpreter, sourceReader: reader(),
    processRegistry: new ManagedProcessRegistry({ platform: 'darwin' }), scratchRoot: join(root, 'scratch-b') });
    assert.equal(changedInput.execution, null);
    assert.equal(changedInput.receipt.reason, 'staged_input_changed_after_execution');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('다른 platform은 macOS 물리 자격으로 꾸미지 않는다', async () => {
  const interpreter = await observePythonInterpreter({ path: '/usr/bin/python3' });
  await assert.rejects(() => executePythonProgramQualification({ contract: contract('print(1)'), interpreter,
    sourceReader: reader(), processRegistry: new ManagedProcessRegistry({ platform: 'darwin' }),
    scratchRoot: '/tmp/t5-never-created', platform: 'win32' }), /physical macOS/u);
});
