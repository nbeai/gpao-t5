import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('CH 제품 종단 콘솔은 격리 root와 실제 native adapter만 주입하고 model purpose를 대신하지 않는다', async () => {
  const source = await readFile(new URL('../scripts/start-s3ch-product-qualification-console.mjs', import.meta.url), 'utf8');
  assert.match(source, /T5_CH_QUALIFICATION_FILE_ROOT/u);
  assert.match(source, /makeMacOSFSEventsAdapter/u);
  assert.match(source, /makeMacOSCoarseAppAdapter/u);
  assert.match(source, /fileActivityRootSelector: async \(\) => selectedRoot/u);
  assert.match(source, /qualification only/u);
  assert.doesNotMatch(source, /homedir|model-connection|secretStore/u);
});
