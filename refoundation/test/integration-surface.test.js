import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rootPackage = new URL('../../package.json', import.meta.url);
const runnerFile = new URL('../scripts/run-product-integrations.mjs', import.meta.url);

test('일상 제품 통합 회귀는 가시 Browser 라이브 검사를 열지 않는다', async () => {
  const metadata = JSON.parse(await readFile(rootPackage, 'utf8'));
  const runner = await readFile(runnerFile, 'utf8');
  assert.equal(metadata.scripts['refoundation:integration'], 'node refoundation/scripts/run-product-integrations.mjs');
  assert.match(runner, /visibleBrowserTests = new Set\(\['persistent-browser-live\.integration\.js'\]\)/u);
});

test('퇴출된 Browser 구현의 가시 검사는 명시적인 별도 명령으로 보존한다', async () => {
  const metadata = JSON.parse(await readFile(rootPackage, 'utf8'));
  assert.equal(
    metadata.scripts['refoundation:integration:browser-live'],
    'node --test --test-concurrency=1 refoundation/test/persistent-browser-live.integration.js',
  );
});
