import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('CH2 macOS actual은 ABBA 네 표본에서 app/AFK coarse truth와 Context0만 측정한다',async()=>{
  const source=await readFile(new URL('../scripts/run-ch2-macos-coarse-app-qualification.mjs',import.meta.url),'utf8');
  assert.match(source,/\['off','on','on','off'\]/u);assert.match(source,/makeMacOSCoarseAppAdapter/u);
  assert.match(source,/semanticDigestAgreement/u);assert.match(source,/forbiddenStored/u);assert.match(source,/modelContextBytes:0/u);
  assert.doesNotMatch(source,/makeConsoleServer|modelFactory/u);
});
