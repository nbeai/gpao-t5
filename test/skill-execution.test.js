// Phase 0-4 · 승격된 스킬이 실제로 대화를 바꾼다.
// 이전: 감지→후보→replay→승인→admitted 를 다 거쳐도 canInfluence 가 **화면 표시에만** 쓰여
// 아무 일도 일어나지 않았다(상태 기계만 있고 효과가 없었다).
// 불변: 스킬은 **영향만** 준다 — 외부 행동은 여전히 A2. canAutoExecute() 는 계속 false.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeSkillCandidate, applicableSkill, skillInfluence, canInfluence, canAutoExecute,
} from '../src/kernel/l5-growth/skill-learning.js';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const admitted = (over = {}) => ({
  ...makeSkillCandidate({ id: 's1', trigger: '주간 보고 정리', tool: 'local.file', steps: ['자료 모으기', '문서로 정리'] }),
  state: 'admitted', userConfirmed: true, replayPassed: true, ...over,
});
const model = { respond: async () => '했어요' };
const ctxWith = (skills) => ({ env: demoEnv(), model, tools: demoTools(), skills });

// ── 자격 있는 스킬만 영향 ────────────────────────────────────────────────
test('admitted+확인+replay 통과만 영향을 준다', () => {
  assert.equal(canInfluence(admitted()), true);
  assert.equal(canInfluence(admitted({ state: 'approved' })), false, '승인만으로는 부족');
  assert.equal(canInfluence(admitted({ replayPassed: false })), false, 'replay 미통과는 영향 0');
  assert.equal(canInfluence(admitted({ userConfirmed: false })), false);
  assert.equal(canInfluence(makeSkillCandidate({ id: 'x' })), false, '감지만 된 건 영향 0');
});

test('트리거가 맞을 때만 고른다(애매하면 안 맞다고 본다)', () => {
  const list = [admitted()];
  assert.ok(applicableSkill(list, '주간 보고 정리해줘'));
  assert.ok(applicableSkill(list, '주간 보고 정리'));
  assert.equal(applicableSkill(list, '오늘 날씨 어때'), null);
  assert.equal(applicableSkill([], '주간 보고 정리'), null);
});

test('미승인 스킬은 트리거가 맞아도 영향 0(승인 전 영향 없음)', () => {
  const notYet = [admitted({ state: 'candidate', userConfirmed: false, replayPassed: false })];
  assert.equal(applicableSkill(notYet, '주간 보고 정리해줘'), null);
  assert.equal(skillInfluence(notYet[0]), null);
});

// ── 실제로 대화를 바꾼다 ──────────────────────────────────────────────────
test('승격된 스킬이 있으면 그 도구가 계획에 들어간다(질문이 줄어든다)', async () => {
  const r = await runTurn({ text: '주간 보고 정리해줘' }, ctxWith([admitted()]));
  assert.equal(r.usedSkill?.id, 's1', '어떤 배운 작업이 도왔는지 남긴다');
  assert.equal(r.usedSkill?.label, admitted().label);
});

test('스킬이 없으면 아무 것도 바뀌지 않는다', async () => {
  const r = await runTurn({ text: '주간 보고 정리해줘' }, ctxWith([]));
  assert.equal(r.usedSkill, undefined);
});

test('조용히 바뀌지 않는다 — 스킬이 도왔으면 결과에 표시된다', async () => {
  const r = await runTurn({ text: '주간 보고 정리해줘' }, ctxWith([admitted()]));
  assert.ok(r.usedSkill, '사용자가 "왜 이렇게 했지"를 알 수 있어야 한다');
});

// ── 안전 불변: 스킬이 승인 게이트를 우회하지 못한다 ──────────────────────
test('스킬은 절대 스스로 외부 행동을 실행하지 않는다', () => {
  assert.equal(canAutoExecute(), false);
});

test('스킬이 외부 전송 도구를 정해도 승인 없이 실행되지 않는다(A2 우회 불가)', async () => {
  const sendSkill = admitted({ id: 's2', trigger: '팀에 공유', tool: 'slack.post' });
  const r = await runTurn({ text: '팀에 공유해줘' }, ctxWith([sendSkill]));
  // 보낼 내용이 없으니 먼저 묻는다(P6-7). 핵심은 **그냥 보내지 않는다**는 것.
  assert.notEqual(r.kind, 'reply', '스킬이 골라준 전송이 조용히 실행되면 안 된다');
  assert.ok(['clarify', 'approval'].includes(r.kind));
  assert.equal(r.usedSkill?.id, 's2', '스킬이 도왔으면 그 사실을 표시한다');
  assert.deepEqual(r.ledger?.confirmed ?? [], [], '승인 전에는 실행 사실이 없어야 한다');
});

test('스킬이 고른 전송 도구는 계획에서 A2(승인 필요)로 잡힌다', async () => {
  const { interpret } = await import('../src/kernel/l1-intent/intent.js');
  const { buildActionPlan } = await import('../src/kernel/l2-plan/action-plan.js');
  const { buildSelfState } = await import('../src/kernel/l0-evidence/self-state.js');
  const plan = buildActionPlan({
    intent: { ...interpret('팀에 공유해줘'), neededTools: ['slack.post'] },
    selfState: buildSelfState(demoEnv()),
  });
  const grant = plan.needsApproval.find((g) => g.action === 'slack.post');
  assert.ok(grant, '스킬이 골랐어도 외부 전송은 승인 목록에 있어야 한다');
  assert.equal(grant.tier, 'A2');
});
