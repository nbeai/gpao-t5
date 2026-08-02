import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JUDGMENT_CHARTER } from '../src/kernel/judgment-charter.js';
import { buildWelcomeContext } from '../src/surface/welcome.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

test('첫 인사는 한 문장이고 능력 나열·자동 도움 제안을 요구하지 않는다', () => {
  const request = buildWelcomeContext(buildSelfState(demoEnv())).currentRequest;
  assert.match(request, /한국어 한 문장/);
  assert.match(request, /능력 나열, 자동 도움 제안, 상투적인 질문은 붙이지 마/);
  assert.doesNotMatch(request, /1~3문장|무엇을 도와줄지 한 번만 물어/);
});

test('말 계약은 완료 뒤 자동 상투어와 빈 약속을 금지한다', () => {
  assert.match(JUDGMENT_CHARTER, /자동 인사·도움 제안·재요약·빈 약속 금지/);
});

test('대화 표면은 의미 없는 고정 안내 문구를 상시 노출하지 않는다', async () => {
  const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /말하면 일이 이어집니다/);
});
