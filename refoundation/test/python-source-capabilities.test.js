import assert from 'node:assert/strict';
import test from 'node:test';

import { observePythonInterpreter } from '../src/ephemeral-program-python.js';
import { observePythonSourceCapabilities } from '../src/python-source-capabilities.js';

test('Python source capability observation은 프로그램을 실행하지 않고 child·network 요구를 분리한다', async () => {
  const interpreter = await observePythonInterpreter({ path: '/usr/bin/python3' });
  assert.deepEqual(observePythonSourceCapabilities({ interpreter,
    source: "from pathlib import Path\nPath('result.txt').write_text('ok')" }), {
    state: 'observed', childProcessRequired: false, networkRequired: false,
  });
  assert.deepEqual(observePythonSourceCapabilities({ interpreter,
    source: "import subprocess\nsubprocess.run(['tool'], check=True)" }), {
    state: 'observed', childProcessRequired: true, networkRequired: false,
  });
  assert.deepEqual(observePythonSourceCapabilities({ interpreter,
    source: 'import urllib.request\nurllib.request.urlopen(\"https://example.com\")' }), {
    state: 'observed', childProcessRequired: false, networkRequired: true,
  });
});
