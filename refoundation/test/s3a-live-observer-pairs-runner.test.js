import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S3-A actual pair는 두 모델×O0/O2 네 요청만 쓰고 body·tool·답 오염을 검사한다', async () => {
  const source = await readFile(new URL('../scripts/run-s3a-live-observer-pairs.mjs', import.meta.url), 'utf8');
  assert.match(source, /gpt-5\.6-terra/u); assert.match(source, /gpt-5\.5/u);
  assert.match(source, /O0_off/u); assert.match(source, /O2_full_shadow/u);
  assert.match(source, /pairedRequestBodyEqual/u); assert.match(source, /pairedToolSurfaceEqual/u);
  assert.match(source, /pairedEffectiveRouteEqual/u); assert.match(source, /settlementProposalVaried/u);
  assert.match(source, /fixedNow/u); assert.match(source, /workspace, fixedNow/u);
  assert.match(source, /observerFieldsInBody/u); assert.match(source, /internalObserverInReply/u);
  assert.match(source, /providerRequests/u); assert.match(source, /externalWrites: 0/u);
});
