import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = resolve(
  dirname(fileURLToPath(import.meta.url)), '..', 'evidence',
  's2-a1-accounting-reference-seal-2026-08-24.json',
);
const load = async () => JSON.parse(await readFile(file, 'utf8'));

test('A1-0은 네 비교군에서 exact accounting의 다섯 확인 범위만 봉인한다', async () => {
  const seal = await load();
  assert.equal(seal.schema, 't5.s2-a1-accounting-reference-seal.v1');
  assert.equal(seal.scope.length, 5);
  assert.match(seal.sources.openClaw.commit, /^[0-9a-f]{40}$/u);
  assert.match(seal.sources.hermes.commit, /^[0-9a-f]{40}$/u);
  assert.match(seal.sources.codex.protocolSchemaSha256, /^[0-9a-f]{64}$/u);
  assert.equal(seal.sources.claudeCode.officialDocs.length, 3);
});

test('A1-1은 retry·child·crash unknown을 보존하고 고정 상한·추정 합산을 채택하지 않는다', async () => {
  const seal = await load();
  const adopt = new Set(seal.adopt);
  const reject = new Set(seal.reject);
  assert.equal(adopt.has('hierarchical_scope_with_single_parent_rollup'), true);
  assert.equal(adopt.has('one_commit_per_provider_response_identity'), true);
  assert.equal(adopt.has('missing_or_crash_usage_is_unknown_not_zero'), true);
  assert.equal(reject.has('fixed_low_turn_tool_token_or_child_caps_as_accounting'), true);
  assert.equal(reject.has('silent_best_effort_usage_loss'), true);
  assert.equal([...adopt].some((item) => reject.has(item)), false);
});

test('A1-0 연구는 모델 문맥·사용자 답·제품 행동을 바꾸지 않는다', async () => {
  const boundary = (await load()).firstImplementationBoundary;
  assert.deepEqual(boundary, {
    stage: 'A1-1_exact_accounting_shadow',
    activeControl: false,
    modelContextChanged: false,
    userAnswerChanged: false,
    productBehaviorChanged: false,
  });
});

