import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { admitExecProgramContract, selectExecProgramBackend } from '../src/exec-program-contract.js';
import { makeRecordReference } from '../src/record-reference.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const reference = (workId = 'w') => makeRecordReference({
  sourceKind: 'local_file', sourceStore: 'managed', sourceId: 'x', sourceRevision: 1,
  sha256: hash('x'), occurredAt: null, recordedAt: '2026-08-29T00:00:00.000Z',
  scope: { sessionId: 's', workId, subjectKeys: [], channel: null },
  trust: 'user_asserted', sensitivity: 'personal', coverage: 'full', availability: 'available',
});
const base = (override) => ({
  workId: 'w', revision: 1, temporary: true, sourceLanguage: 'python', source: 'print("same source")',
  inputs: [{ relativePath: 'inputs/source.csv', recordRef: reference() }],
  outputs: [{ relativePath: 'outputs/result.csv', kind: 'text/csv', category: 'publishable' }],
  requirements: { filesystem: true, network: false, childProcess: false, packages: false },
  interpreter: '/usr/bin/python3', ...override,
});

test('exec program 계약은 Python source를 바꾸지 않고 same-language Terminal backend를 고른다', () => {
  const contract = admitExecProgramContract(base({}));
  assert.equal(contract.source, 'print("same source")');
  assert.equal(selectExecProgramBackend(contract).backend, 'terminal_same_language');
  assert.equal(selectExecProgramBackend(contract).translated, false);
});

test('filesystem·network·child·package가 모두 필요 없는 JavaScript만 QuickJS 후보가 된다', () => {
  const contract = admitExecProgramContract(base({ sourceLanguage: 'javascript', source: 'input=>input',
    interpreter: null, requirements: { filesystem: false, network: false, childProcess: false, packages: false } }));
  assert.equal(selectExecProgramBackend(contract).backend, 'quickjs');
  assert.equal(selectExecProgramBackend(contract, { quickJsQualified: false }).backend, 'terminal_same_language');
});

test('ordinary exec object·foreign Work·path escape·input/output overlap은 계약으로 승격하지 않는다', () => {
  assert.throws(() => selectExecProgramBackend({ command: 'ls' }), /admitted/u);
  assert.throws(() => admitExecProgramContract(base({ inputs: [{ relativePath: 'inputs/x',
    recordRef: reference('other') }] })), /current Work/u);
  assert.throws(() => admitExecProgramContract(base({ outputs: [{ relativePath: '../x',
    kind: 'text/plain', category: 'publishable' }] })), /escaped/u);
  assert.throws(() => admitExecProgramContract(base({ outputs: [{ relativePath: 'inputs/source.csv',
    kind: 'text/csv', category: 'publishable' }] })), /overlap/u);
  assert.throws(() => admitExecProgramContract(base({ outputs: [{ relativePath: 'program.py',
    kind: 'text/x-python', category: 'publishable' }] })), /overlap/u);
});
