import test from 'node:test';
import assert from 'node:assert/strict';

import { makeAutomationTool } from '../src/automation-tool.js';

const localEffect = {
  kind: 'local_change', targets: ['T5 자동화 원장'],
  confirmation: 'not_applicable', rollbackOfToolCallId: null,
};
const publishEffect = {
  kind: 'external_send', targets: ['https://blog.example/me'],
  confirmation: 'known_recipient', rollbackOfToolCallId: null,
};
const base = {
  action: 'create', jobId: null, name: '게시 예약', prompt: '게시하고 URL을 확인해',
  scheduleKind: 'at', schedule: '2026-08-25T00:00:00.000Z', timezone: 'Asia/Seoul',
  requiredTools: ['browser'], requiredEffect: 'external_send', requireResultUrl: true,
  delivery: 'origin_session', preparationToolCallIds: ['browser-ready'],
  delegatedTool: 'browser', delegatedEffect: publishEffect, effect: localEffect,
};

function tool({ inspectRequirements = async () => ({ ready: true }) } = {}) {
  let created = null;
  const store = {
    async create(value) { created = value; return { id: 'job', name: value.name }; },
    async list() { return { jobs: [], runs: [] }; },
  };
  return {
    tool: makeAutomationTool({ store, scheduler: { async jobsChanged() {} }, sessionId: 's',
      inspectRequirements, authorizeEffect: async () => ({ allowed: true }) }),
    created: () => created,
  };
}

test('future objective effect와 현재 schedule 저장 effect는 schema에서 다른 책임이다', () => {
  const built = tool().tool; const description = built.parameters.properties.requiredEffect.description;
  assert.match(description, /future scheduled objective itself/u);
  assert.match(description, /separate effect field/u);
  assert.match(description, /null for text-only content/u);
});

test('미래 브라우저 작업은 현재 로그인된 화면 관측 근거 없이는 예약되지 않는다', async () => {
  const built = tool();
  const gate = await built.tool.preflight({ ...base, preparationToolCallIds: [] }, { priorReceipts: [] });
  assert.equal(gate.allowed, false);
  assert.equal(gate.result.reason, 'browser_session_not_verified_now');
});

test('필요 도구나 Telegram 전달 경로가 없으면 모델 약속 전에 예약을 막는다', async () => {
  const built = tool({ inspectRequirements: async () => ({
    ready: false, missingTools: ['browser'], delivery: 'telegram', reason: 'telegram_binding_missing',
  }) });
  const prepared = [{
    toolCallId: 'browser-ready', actualCall: { name: 'browser' }, outcome: 'succeeded',
    result: { state: 'observed', secretFieldsPresent: false },
  }];
  const gate = await built.tool.preflight({
    ...base, delivery: 'telegram', requiredTools: [], requiredEffect: null,
    preparationToolCallIds: [], delegatedTool: null, delegatedEffect: null,
  }, { priorReceipts: prepared });
  assert.equal(gate.allowed, false);
  assert.equal(gate.result.state, 'automation_requirements_unavailable');
  assert.equal(gate.result.reason, 'telegram_binding_missing');
});

test('Telegram 전달은 scheduler 소유이므로 미래 모델의 외부 전송 위임으로 중복 선언하지 않는다', async () => {
  const built = tool();
  const gate = await built.tool.preflight({ ...base, delivery: 'telegram' }, { priorReceipts: [{
    toolCallId: 'browser-ready', actualCall: { name: 'browser' }, outcome: 'succeeded',
    result: { state: 'observed', secretFieldsPresent: false },
  }] });
  assert.equal(gate.allowed, false);
  assert.equal(gate.result.reason, 'telegram_delivery_is_owned_by_scheduler');
});

test('Telegram delivery 계약의 실행 prompt는 브리핑만 만들고 전송을 다시 지시하지 않는다', async () => {
  const built = tool();
  const gate = await built.tool.preflight({
    ...base, prompt: '뉴스를 정리해 Telegram으로 보내라', delivery: 'telegram',
    requiredTools: [], requiredEffect: null, preparationToolCallIds: [],
    delegatedTool: null, delegatedEffect: null,
  }, { priorReceipts: [] });
  assert.equal(gate.allowed, false);
  assert.equal(gate.result.state, 'automation_delivery_prompt_invalid');
});

test('현재 browser 근거·도구·전달 경로·위임 범위가 모두 서면 exact 계약으로 저장한다', async () => {
  const built = tool();
  const context = { priorReceipts: [{
    toolCallId: 'browser-ready', actualCall: { name: 'browser' }, outcome: 'succeeded',
    result: { state: 'observed', secretFieldsPresent: false },
  }] };
  const gate = await built.tool.preflight(base, context);
  assert.equal(gate.allowed, true);
  const result = await built.tool.execute(base, context);
  assert.equal(result.state, 'scheduled');
  assert.deepEqual(built.created().requirements, {
    requiredTools: ['browser'], requiredEffect: 'external_send', requireResultUrl: true,
    delivery: { kind: 'origin_session', sessionId: null }, authorityEnvelope: {
      toolName: 'browser', effect: { ...publishEffect, approvalToken: null },
    },
  });
});
