import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('인간 자격 콘솔은 실제 T5 모델 연결을 복사하지 않고 외부 제품 상태를 격리한다', async () => {
  const source = await readFile(new URL('../scripts/launch-terminal-core-human-console.mjs', import.meta.url), 'utf8');
  assert.match(source, /--human-controlled/u);
  assert.match(source, /makeConsoleModelAccess\(\{ connectionFile, stateDir, secretStore \}\)/u);
  assert.match(source, /migrateStoredModelCredentials\(\{ file: connectionFile, secretStore \}\)/u);
  assert.match(source, /makeStoredModelCredentialCatalog[\s\S]*\.select\(\)/u);
  assert.match(source, /credentialReady: Boolean\(selectedCredential\.kind\)/u);
  assert.doesNotMatch(source, /copyFile|runAgent\(|\/turn['"`]/u);
  assert.match(source, /new MessengerCredentialStore\(join\(stateDir/u);
  assert.match(source, /learningReviewMode: 'off'/u);
  assert.equal(source.includes('workspaceConnectionServices:'), false);
  assert.match(source, /if \(!initialModel\.connected\) throw/u);
});
