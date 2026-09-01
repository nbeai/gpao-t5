import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const evidence = JSON.parse(readFileSync(new URL('../evidence/nx2-wc2-structure-reconnaissance-2026-09-01.json', import.meta.url), 'utf8'));

test('WC-2는 실제 반복 구조·필드·pagination을 의미 판정 없이 관측한다', () => {
  assert.equal(evidence.status, 'WC2_COMPLETE_WC3_OPEN');
  assert.equal(evidence.actual.itemSelector, 'article.product_pod');
  assert.equal(evidence.actual.itemCount, 20);
  assert.equal(evidence.actual.fields.length, 3);
  assert.equal(evidence.actual.scriptsExecuted, 0);
  assert.equal(evidence.contract.runtimeMeaningDecision, 0);
  assert.equal(evidence.contract.contentInstructionAuthority, 'none');
});

test('WC-2는 새 Browser·site parser·Windows PASS를 만들지 않는다', () => {
  assert.ok(evidence.notAdded.includes('Browser runtime'));
  assert.ok(evidence.notAdded.includes('site-specific parser'));
  assert.equal(evidence.platform.windowsPhysical, 'DEFERRED_BY_OWNER');
  assert.equal(evidence.productSourceChanges, 0);
});
