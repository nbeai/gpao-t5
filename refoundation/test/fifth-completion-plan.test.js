import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

test('5차 정본은 4차 귀환선과 CJ0~CJ7·오너 승인 경계를 함께 보존한다', async () => {
  const plan = await readFile(new URL('T5-FIFTH-COMPLETION.md', root), 'utf8');
  assert.match(plan, /FIFTH_COMPLETION_ACTIVE · CJ0_CJ2_COMPLETE · CJ3_EVIDENCE_PROJECTION_OPEN/u);
  assert.match(plan, /fe51c8c5 · FOURTH_COMPLETION_COMPLETE_MACOS_PRODUCT_SCOPE/u);
  assert.match(plan, /Android Judgment & Context Runtime/u);
  const gates = ['CJ0', 'CJ1', 'CJ2', 'CJ3', 'CJ4', 'CJ5', 'CJ6', 'CJ7'];
  let cursor = -1;
  for (const gate of gates) {
    const next = plan.indexOf(`### ${gate} —`);
    assert.ok(next > cursor, gate); cursor = next;
  }
  assert.match(plan, /기존 S4-A~P·HQ exact-head 증거 재사용/u);
  assert.match(plan, /product_invariant[\s\S]*measured_failure_guard[\s\S]*candidate/u);
  assert.match(plan, /새 전역 instruction은 오너 제품 불변식이거나 실제 사고·evidence·countertest/u);
  assert.match(plan, /논리적으로 얇은 Evidence projection과 실제 provider wire context 재구성은 같은 일이 아니다/u);
  assert.match(plan, /OpenAI API[\s\S]*ChatGPT OAuth[\s\S]*Anthropic[\s\S]*Gemini·Upstage[\s\S]*model fallback/u);
  assert.match(plan, /CJ7 taxonomy가 Runtime Intent enum이 아님/u);
  assert.match(plan, /같은 결함 가족의 세 번째 patch 금지/u);
  assert.match(plan, /전체 인간 비교는 CJ7 뒤 한 번만 수행/u);
  assert.match(plan, /Windows `DEFERRED_NOT_WAIVED`/u);
  assert.match(plan, /CJ0는 제품 변경 0으로 시작한다/u);
});
