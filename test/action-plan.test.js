import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { buildActionPlan } from '../src/kernel/l2-plan/action-plan.js';

// 감사 보정(보안): 하드코딩 TOOL_KIND 맵에 없는 새 descriptor 도구라도 needsApproval:true면
// ActionPlan.needsApproval(A2 승인)로 반드시 들어간다 — 승인 우회 차단.
test('custom.send(맵에 없음)이 needsApproval:true면 A2 승인에서 멈춘다', () => {
  const selfState = buildSelfState({
    model: { id: 'm' },
    connections: [
      // toolKind를 'read'로 둬도(낮은 등급) needsApproval:true면 승인으로 올라가야 한다.
      { id: 'custom.send', connected: true, status: 'usable', needsApproval: true, toolKind: 'read' },
    ],
  });
  const intent = {
    currentRequest: '커스텀 전송', desiredOutcome: '커스텀 전송',
    neededTools: ['custom.send'], answerMode: 'complex_work', authorityBoundary: 'A0',
  };
  const plan = buildActionPlan({ intent, selfState });
  assert.ok(!plan.autoAllowed.includes('custom.send'), '자동 허용되면 안 된다');
  const grant = plan.needsApproval.find((g) => g.action === 'custom.send');
  assert.ok(grant, 'needsApproval에 들어가야 한다');
  assert.equal(grant.tier, 'A2');
  assert.equal(grant.approvalRequired, true);
});

// descriptor 없이 하드코딩 맵 경로도 유지(하위호환): mail.send는 여전히 send=A2.
test('맵 기반 send 도구도 여전히 승인 대상(하위호환)', () => {
  const selfState = buildSelfState({
    model: { id: 'm' },
    connections: [{ id: 'mail.send', connected: true, status: 'usable' }],
  });
  const plan = buildActionPlan({
    intent: { desiredOutcome: 'x', neededTools: ['mail.send'], answerMode: 'complex_work', authorityBoundary: 'A2' },
    selfState,
  });
  assert.ok(plan.needsApproval.some((g) => g.action === 'mail.send'));
});
