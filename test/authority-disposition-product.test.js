import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorityDecision, grantFor, AUTHORITY_DISPOSITION,
} from '../src/kernel/l2-plan/authority.js';
import { buildActionPlan } from '../src/kernel/l2-plan/action-plan.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { defineWebTool } from '../src/kernel/l2-plan/web-tool.js';
import { mcpToolDescriptor } from '../src/runtime/tool-admission.js';

test('승인카드 생성자는 돈·비가역 파괴·새 상대 첫 전송뿐이다', () => {
  const boundaries = [
    [{ kind: 'pay' }, 'money'],
    [{ kind: 'delete', revocable: false }, 'irreversible_destruction'],
    [{ kind: 'write', revocable: false }, 'irreversible_destruction'],
    [{ kind: 'send', counterpartKnown: false }, 'first_external_send'],
  ];
  for (const [action, boundary] of boundaries) {
    const decision = authorityDecision(action);
    assert.equal(decision.disposition, AUTHORITY_DISPOSITION.APPROVAL);
    assert.equal(decision.boundary, boundary);
    assert.equal(grantFor(action).approvalRequired, true);
  }
});

test('정적 needsApproval은 읽기·가역 쓰기·아는 상대 전송에 카드를 만들지 못한다', () => {
  for (const action of [
    { kind: 'read', needsApproval: true },
    { kind: 'write', revocable: true, needsApproval: true },
    { kind: 'send', counterpartKnown: true, needsApproval: true },
    { kind: 'automate', needsApproval: true },
  ]) {
    assert.equal(authorityDecision(action).disposition, AUTHORITY_DISPOSITION.AUTO);
    assert.equal(grantFor(action).approvalRequired, false);
  }
});

test('비밀·미상·요청 밖은 승인으로 바꾸지 않고 실행에서도 제외한다', () => {
  assert.equal(authorityDecision({ kind: 'export_sensitive' }).disposition, AUTHORITY_DISPOSITION.BLOCKED);
  assert.equal(authorityDecision({ kind: 'unknown_kind' }).disposition, AUTHORITY_DISPOSITION.OBSERVE);
  assert.equal(authorityDecision({ kind: 'read', outOfScope: true }).disposition, AUTHORITY_DISPOSITION.OUT_OF_SCOPE);
  for (const action of [
    { kind: 'export_sensitive' }, { kind: 'unknown_kind' }, { kind: 'read', outOfScope: true },
  ]) assert.equal(grantFor(action).approvalRequired, false);
});

test('미분류 도구는 카드도 실행도 아니며 재계획 사실으로 남는다', () => {
  const selfState = buildSelfState({
    model: { id: 'm', authSignal: 'ok' },
    connections: [{ id: 'mcp.x.opaque', connected: true, status: 'usable', toolKind: 'unknown_kind', needsApproval: true }],
  });
  const plan = buildActionPlan({ intent: { neededTools: ['mcp.x.opaque'], desiredOutcome: '조회' }, selfState });
  assert.deepEqual(plan.needsApproval, []);
  assert.deepEqual(plan.toolsToUse, []);
  assert.deepEqual(plan.authorityDeferred, [{
    toolId: 'mcp.x.opaque', disposition: 'observe', reason: 'effect_not_classified', args: { request: undefined },
  }]);
});

test('MCP annotation 부재와 인증 웹 읽기는 승인카드 원천이 아니다', () => {
  const opaque = mcpToolDescriptor({ server: 'x', tool: { name: 'lookup', inputSchema: { type: 'object' } } });
  assert.equal(opaque.toolKind, 'unknown_kind');
  assert.equal(opaque.needsApproval, false);
  assert.equal(grantFor({ kind: opaque.toolKind, needsApproval: opaque.needsApproval }).approvalRequired, false);

  for (const sessionMode of ['anonymous', 'authenticated', 'user_approved']) {
    const web = defineWebTool({ sessionMode });
    assert.equal(web.toolKind, 'read');
    assert.equal(web.needsApproval, false);
    assert.equal(grantFor({ kind: web.toolKind, needsApproval: web.needsApproval }).approvalRequired, false);
  }
});

test('승인 거절은 다른 종류의 허가로 바뀌지 않는다', () => {
  const firstSend = grantFor({ kind: 'send', counterpartKnown: false });
  assert.equal(firstSend.approvalRequired, true);
  assert.equal(firstSend.granted, false);
  assert.equal(authorityDecision({ kind: 'send', counterpartKnown: false, needsApproval: false }).disposition,
    AUTHORITY_DISPOSITION.APPROVAL);
});
