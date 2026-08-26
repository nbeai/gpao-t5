import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Terminal 인간 자격 콘솔은 명시 시작만 허용하고 모델 Turn을 자동 제출하지 않는다', async () => {
  const source = await readFile(new URL('../scripts/launch-terminal-core-human-console.mjs', import.meta.url), 'utf8');
  assert.match(source, /--human-controlled/u);
  assert.doesNotMatch(source, /fetch\([^\n]*\/turn|executeTurn\(|runAgent\(/u);
  assert.match(source, /mkdtemp\(join\(tmpdir\(\), 't5-terminal-core-human-'/u);
  assert.match(source, /makeModelConnectionService/u);
  assert.match(source, /makeTerminalCredentialBroker/u);
  assert.match(source, /TCORE-H01/u);
  assert.match(source, /TCORE-H05 optional/u);
  assert.equal(source.includes('messengerCredentialStore:'), false);
  assert.equal(source.includes('workspaceConnectionServices:'), false);
});
