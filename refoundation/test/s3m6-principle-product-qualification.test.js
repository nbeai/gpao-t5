import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { runPrincipleProductQualification } from '../scripts/run-s3m6-principle-product-qualification.mjs';
import { makePrincipleEvidenceProductAdapter } from '../src/principle-evidence-product-adapter.js';

test('actual retained Reflection과 fixture-bounded deterministic runtime은 field_qualified까지 닫는다', async () => {
  const result = await runPrincipleProductQualification();
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.state, 'field_qualified'); assert.equal(result.replayPairs, 2);
  assert.equal(result.nearMisses, 1); assert.equal(result.counterexamples, 1);
  assert.equal(result.actualReflectionLedger, true); assert.equal(result.retainedReviewReceipt, true);
  assert.equal(result.status, 'FIXTURE_BOUNDARY_PASS_PRODUCT_UNWIRED');
  assert.equal(result.productQualification, false); assert.equal(result.actualWorkRunStores, false);
  assert.equal(result.sourceWindowStableLock, true);
  assert.equal(result.seededOpaqueArmMappings, 2);
  assert.ok(Object.values(result.runtimeMethodCalls).every((count) => count > 0));
  assert.deepEqual({ rawCallerPaths: result.rawCallerPaths, modelCalls: result.modelCalls,
    externalWrites: result.externalWrites, productDefaultWiring: result.productDefaultWiring }, {
    rawCallerPaths: 0, modelCalls: 0, externalWrites: 0, productDefaultWiring: false,
  });
});

test('product adapter는 fake Reflection/source-window와 raw method path를 받지 않는다', async () => {
  assert.throws(() => makePrincipleEvidenceProductAdapter({ reflectionLedger: {},
    sourceWindowCoordinator: {}, recordSourceReader: { async reopen() {} }, runtimeMethods: {} }),
  /exact canonical dependencies/u);
  const [adapter, consoleServer] = await Promise.all([
    readFile(new URL('../src/principle-evidence-product-adapter.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/console-server.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(consoleServer, /principle-evidence-product-adapter/u);
  assert.doesNotMatch(adapter, /modelFactory|fetch\(|https?:\/\/|runtimeMethods/u);
});
