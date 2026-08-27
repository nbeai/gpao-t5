import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const readJson = async (name) => JSON.parse(await readFile(new URL(`refoundation/evidence/${name}`, root), 'utf8'));
const [alpha5, alpha6, final, plan] = await Promise.all([
  readJson('alpha5-model-continuity-completion-2026-08-27.json'),
  readJson('alpha6-local-ownership-completion-2026-08-27.json'),
  readJson('third-alpha-source-completion-2026-08-27.json'),
  readFile(new URL('T5-THIRD-ALPHA.md', root), 'utf8'),
]);

test('Alpha5·6와 최종 네 사용자 여정이 모두 닫힌 뒤에만 3차α source 완료다', () => {
  assert.equal(alpha5.status, 'PASS'); assert.equal(alpha6.status, 'PASS'); assert.equal(final.status, 'PASS');
  assert.deepEqual(Object.keys(final.finalUserJourneys), ['LF-H01', 'LF-H02', 'LF-H03', 'LF-H04']);
  assert.match(plan, /ALPHA5_COMPLETE · ALPHA6_COMPLETE · THIRD_ALPHA_SOURCE_COMPLETE/u);
  assert.match(plan, /MACOS_PRODUCT_QUALIFICATION_NEXT/u);
});

test('최종 evidence는 실제 provider·외부 삭제·물리 플랫폼·수치 우위를 꾸미지 않는다', () => {
  assert.equal(final.verification.realProviderCallsForAlpha5And6, 0);
  assert.equal(final.verification.externalEffectsForAlpha5And6, 0);
  assert.equal(final.comparison.numericRuntimeBenchmarkClaimed, false);
  assert.ok(alpha6.notClaimed.some((item) => item.includes('external-service copies')));
  assert.ok(final.notClaimed.some((item) => item.includes('macOS installed-product')));
  assert.doesNotMatch(JSON.stringify({ alpha5, alpha6, final }), /\/Users\/|C:\\Users\\|sk-[A-Za-z0-9]|-----BEGIN/u);
});
