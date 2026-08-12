import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../scripts/human-use/scenarios.json', import.meta.url), 'utf8'));

test('사람 사용시험 등록부: 핵심·장기대화·프로젝트·자동화·에이전트를 모두 가진다', () => {
  const ids = new Set(manifest.scenarios.map((s) => s.id));
  for (const id of ['selfhood', 'conversation_quality', 'long_context_30', 'project_file_delivery', 'automation_surface', 'agent_delegation']) {
    assert.ok(ids.has(id), id);
  }
  assert.deepEqual(new Set(manifest.suites.milestone), ids, '마일스톤은 등록 시나리오 전부를 돈다');
});

test('모든 시나리오는 화면 단계·상한·기계 검사 계약을 가진다', () => {
  for (const scenario of manifest.scenarios) {
    assert.ok(scenario.maxTurns > 0 && scenario.maxTurns <= 40, `${scenario.id}: 유한 턴 상한`);
    assert.ok(scenario.steps.length >= 2, `${scenario.id}: 실제 사용자 단계`);
    assert.ok(scenario.requiredChecks.length >= 4, `${scenario.id}: 기계 검사`);
    assert.equal(new Set(scenario.requiredChecks).size, scenario.requiredChecks.length, `${scenario.id}: 검사 중복 없음`);
  }
});
