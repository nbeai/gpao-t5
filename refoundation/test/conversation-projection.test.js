import test from 'node:test';
import assert from 'node:assert/strict';

import {
  projectHistoricalConversation, projectHistoricalConversationEntries,
  repairIncompleteToolCallMessages,
} from '../src/conversation-projection.js';

function terminalReceipt() {
  return {
    toolCallId: 'call-1',
    requestedCall: { id: 'call-1', name: 'exec', args: { command: 'cat value.txt', cwd: null } },
    actualCall: { name: 'exec', args: { command: 'cat value.txt', cwd: null } },
    outcome: 'succeeded',
    result: {
      state: 'completed', cwd: '/tmp/work', stdout: 'PROJECTION-7391\n', stderr: '',
      truncated: false, omittedChars: 0, exitCode: 0, signal: null, durationMs: 17,
      startedAt: '2026-08-19T00:00:00Z', endedAt: '2026-08-19T00:00:00Z',
      effectObservation: {
        declared: { kind: 'observe', summary: 'read value', targets: ['/tmp/work/value.txt'], reversible: true },
        before: { observed: true, targets: [{ path: '/tmp/work/value.txt', sha256: 'a'.repeat(64) }] },
        after: { observed: true, targets: [{ path: '/tmp/work/value.txt', sha256: 'a'.repeat(64) }] },
        changed: false,
      },
      commandExplanation: {
        ok: true, source: 'cat value.txt',
        steps: Array.from({ length: 20 }, (_, index) => ({ id: `step-${index}`, executable: 'cat' })),
      },
    },
  };
}

function browserReceipt({ id, action = 'snapshot', url, text, refs, file = null }) {
  const observation = {
    observationId: `observation-${id}`,
    text,
    totalChars: text.length,
    shownChars: text.length,
    truncated: false,
    omittedChars: 0,
    refs,
    refScope: {
      observationId: `observation-${id}`,
      tabId: 't1', targetId: 'target-1', url,
    },
    trust: 'untrusted_external', instructionAuthority: 'none',
  };
  return {
    toolCallId: `browser-${id}`,
    requestedCall: { id: `browser-${id}`, name: 'browser', args: { action, url } },
    actualCall: { name: 'browser', args: { action, url } },
    outcome: 'succeeded',
    result: action === 'snapshot' ? {
      state: 'observed', effect: 'observe',
      profile: { id: 'isolated', kind: 'managed_isolated', selected: true },
      tab: { tabId: 't1', targetId: 'target-1', title: '사업 화면', url, active: true },
      observation,
    } : {
      state: 'acted',
      profile: { id: 'isolated', kind: 'managed_isolated', selected: true },
      action: { kind: action, ref: 'e2', textChars: action === 'fill' ? 42 : undefined },
      declaredEffect: {
        kind: action === 'upload' ? 'external_send' : 'observe',
        summary: `${action} 수행`, targets: [url], reversible: action !== 'upload',
      },
      before: {
        observationId: 'observation-before', refScope: { tabId: 't1', url },
        ref: 'e2', refFact: { name: '정산 서류', role: 'button' },
      },
      tab: { tabId: 't1', targetId: 'target-1', title: '사업 화면', url, active: true },
      after: observation,
      navigation: { changed: false, from: url, to: url },
      network: {
        totalRequests: 1, truncated: false,
        requests: [{ method: 'POST', address: `${url}/api`, queryOmitted: true,
          resourceType: 'Fetch', status: 200, mimeType: 'application/json' }],
      },
      ...(file ? { file } : {}),
    },
  };
}

test('과거 terminal receipt projection은 현실 결과를 보존하고 중복 회계만 제거한다', () => {
  const receipt = terminalReceipt();
  const messages = [
    { role: 'user', content: '값을 읽어줘' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'exec', args: { command: 'cat value.txt', cwd: null } }] },
    { role: 'tool', toolCallId: 'call-1', name: 'exec', content: JSON.stringify(receipt) },
    { role: 'assistant', content: '확인했습니다.' },
  ];
  const before = structuredClone(messages);
  const projected = projectHistoricalConversation(messages);
  assert.deepEqual(messages, before);
  assert.deepEqual(projected.slice(0, 2), messages.slice(0, 2));
  const compact = JSON.parse(projected[2].content);
  assert.equal(compact.schema, 't5.historical-tool-receipt.v1');
  assert.equal(compact.toolCallId, 'call-1');
  assert.equal(compact.tool, 'exec');
  assert.equal(compact.outcome, 'succeeded');
  assert.equal(compact.result.stdout, 'PROJECTION-7391\n');
  assert.equal(compact.result.exitCode, 0);
  assert.equal(compact.result.effect.kind, 'observe');
  assert.equal(compact.result.effect.changed, false);
  assert.doesNotMatch(projected[2].content, /commandExplanation|startedAt|sha256/);
  assert.ok(Buffer.byteLength(projected[2].content) < Buffer.byteLength(messages[2].content) * 0.4);
});

test('skill·알 수 없는 도구·해석할 수 없는 receipt는 손실을 피하려고 원문을 유지한다', () => {
  const messages = [
    { role: 'tool', toolCallId: 'skill-1', name: 'skill', content: '{"content":"full skill"}' },
    { role: 'tool', toolCallId: 'other-1', name: 'custom', content: '{"result":"opaque"}' },
    { role: 'tool', toolCallId: 'bad-1', name: 'exec', content: 'not-json' },
  ];
  assert.deepEqual(projectHistoricalConversation(messages), messages);
});

test('승인 전 미실행 receipt는 pending ID와 이유를 보존한다', () => {
  const receipt = {
    toolCallId: 'gate-1', requestedCall: { id: 'gate-1', name: 'exec', args: {} },
    actualCall: null, outcome: 'not_executed',
    result: {
      state: 'approval_required', pendingId: 'pending-7', reason: 'destructive',
      effect: { kind: 'destructive', summary: 'delete', targets: ['/tmp/a'] },
      command: 'rm /tmp/a', cwd: '/tmp',
    },
  };
  const projected = projectHistoricalConversation([{
    role: 'tool', toolCallId: 'gate-1', name: 'exec', content: JSON.stringify(receipt),
  }]);
  const compact = JSON.parse(projected[0].content);
  assert.equal(compact.outcome, 'not_executed');
  assert.equal(compact.result.state, 'approval_required');
  assert.equal(compact.result.pendingId, 'pending-7');
  assert.equal(compact.result.reason, 'destructive');
  assert.equal(compact.result.command, 'rm /tmp/a');
});

test('큰 historical stdout은 head·tail·message ref만 보이고 중간 원문은 canonical에 남는다', () => {
  const receipt = terminalReceipt();
  receipt.result.stdout = `${'H'.repeat(9_000)}MIDDLE-NEEDLE-7391${'T'.repeat(9_000)}`;
  const originalContent = JSON.stringify(receipt);
  const entries = [{
    messageId: 'large-tool-message', runId: 'run-large',
    message: { role: 'tool', toolCallId: 'call-1', name: 'exec', content: originalContent },
  }];
  const projection = projectHistoricalConversationEntries(entries, {
    largeOutputMode: 'recoverable', maxInlineOutputChars: 8_000, previewChars: 1_000,
  });
  assert.equal(projection.messages.length, 1);
  assert.equal(projection.recoverable.length, 1);
  assert.deepEqual(projection.recoverable[0], {
    messageId: 'large-tool-message', stream: 'stdout', totalChars: 18_018,
  });
  const compact = JSON.parse(projection.messages[0].content);
  assert.doesNotMatch(compact.result.stdout, /MIDDLE-NEEDLE-7391/);
  assert.match(compact.result.stdout, /^H+/);
  assert.match(compact.result.stdout, /T+$/);
  assert.deepEqual(compact.result.stdoutProjection, {
    state: 'recoverable', messageId: 'large-tool-message', stream: 'stdout',
    totalChars: 18_018, inlineChars: 2_000, omittedChars: 16_018,
    recallTool: 'conversation_recall',
  });
  assert.equal(entries[0].message.content, originalContent);
  assert.ok(Buffer.byteLength(projection.messages[0].content) < Buffer.byteLength(originalContent) * 0.2);
});

test('재시작 때 tool result가 없는 function call은 provider projection에만 unknown interruption을 채운다', () => {
  const messages = [
    { role: 'user', content: '긴 작업을 해줘' },
    { role: 'assistant', content: '', toolCalls: [{
      id: 'interrupted-call', name: 'exec', args: { command: 'long-task', cwd: null },
    }] },
    { role: 'user', content: '다음 요청' },
  ];
  const before = structuredClone(messages);
  const repaired = repairIncompleteToolCallMessages(messages);
  assert.deepEqual(messages, before);
  assert.equal(repaired.length, 4);
  assert.equal(repaired[2].role, 'tool');
  assert.equal(repaired[2].toolCallId, 'interrupted-call');
  const receipt = JSON.parse(repaired[2].content);
  assert.equal(receipt.outcome, 'interrupted_unknown');
  assert.equal(receipt.result.state, 'interrupted');
  assert.equal(receipt.result.executionKnown, false);
  assert.match(receipt.result.reason, /inspect current reality/i);
});

test('과거 browser receipt는 사실을 보존하되 마지막 탭 상태만 상호작용 가능하게 남긴다', () => {
  const oldText = `오래된 화면 ${'OLD-CONTENT '.repeat(500)}`;
  const latestText = '- heading "서류 보관함" [ref=e1]\n- button "정산 서류" [ref=e2]';
  const old = browserReceipt({
    id: 'old', url: 'https://business.example/orders', text: oldText,
    refs: { e1: { name: '주문', role: 'heading' }, e9: { name: '처리', role: 'button' } },
  });
  const latest = browserReceipt({
    id: 'latest', action: 'upload', url: 'https://business.example/documents',
    text: latestText,
    refs: { e1: { name: '서류 보관함', role: 'heading' }, e2: { name: '정산 서류', role: 'button' } },
    file: {
      path: '/tmp/settlement.pdf', bytes: 34, sha256: 'd'.repeat(64),
      mimeType: 'application/pdf', trust: 'user_selected_local',
    },
  });
  latest.result.artifact = {
    attachmentId: 'download-artifact-1', originalName: 'settlement.pdf',
    storedPath: '/managed/attachments/settlement.pdf', bytes: 34,
    sha256: 'd'.repeat(64), mimeType: 'application/pdf', direction: 'input',
  };
  const messages = [
    { role: 'tool', toolCallId: 'browser-old', name: 'browser', content: JSON.stringify(old) },
    { role: 'tool', toolCallId: 'browser-latest', name: 'browser', content: JSON.stringify(latest) },
  ];
  const before = structuredClone(messages);
  const projected = projectHistoricalConversation(messages);
  assert.deepEqual(messages, before);

  const oldCompact = JSON.parse(projected[0].content);
  assert.equal(oldCompact.tool, 'browser');
  assert.equal(oldCompact.outcome, 'succeeded');
  assert.equal(oldCompact.result.tab.url, 'https://business.example/orders');
  assert.equal(oldCompact.result.observation.totalChars, oldText.length);
  assert.equal(oldCompact.result.observation.refs, undefined);
  assert.ok(oldCompact.result.observation.text.length < oldText.length * 0.2);

  const latestCompact = JSON.parse(projected[1].content);
  assert.equal(latestCompact.result.action.kind, 'upload');
  assert.equal(latestCompact.result.effect.kind, 'external_send');
  assert.equal(latestCompact.result.effect.changed, undefined);
  assert.equal(latestCompact.result.before.ref, 'e2');
  assert.equal(latestCompact.result.after.text, latestText);
  assert.deepEqual(latestCompact.result.after.refs.e2, { name: '정산 서류', role: 'button' });
  assert.equal(latestCompact.result.network.requests[0].status, 200);
  assert.equal(latestCompact.result.file.path, '/tmp/settlement.pdf');
  assert.equal(latestCompact.result.file.sha256, 'd'.repeat(64));
  assert.equal(latestCompact.result.artifact.attachmentId, 'download-artifact-1');
  assert.equal(latestCompact.result.artifact.storedPath, '/managed/attachments/settlement.pdf');
  assert.doesNotMatch(projected[1].content, /requestedCall|profile|target-1/);
  assert.ok(Buffer.byteLength(projected[1].content) < Buffer.byteLength(messages[1].content) * 0.95);
});

test('modal discard의 requested effect와 destructive actual effect를 과거 Browser truth에 보존한다', () => {
  const receipt = browserReceipt({
    id: 'modal-discard', action: 'click', url: 'https://business.example/editor',
    text: '- dialog "기존 작업"\n  - button "선택" [ref=e2]',
    refs: { e2: { role: 'button', name: '선택' } },
  });
  receipt.result.modalAction = {
    intent: 'discard_existing', context: {
      modal: true, ancestors: [{ role: 'dialog', name: '기존 작업' }],
    },
  };
  receipt.result.effectTruth = { requestedKind: 'external_change', actualKind: 'destructive' };
  const [projected] = projectHistoricalConversation([{
    role: 'tool', toolCallId: 'modal-discard', name: 'browser', content: JSON.stringify(receipt),
  }]);
  const compact = JSON.parse(projected.content);
  assert.equal(compact.result.modalAction.intent, 'discard_existing');
  assert.equal(compact.result.effectTruth.requestedKind, 'external_change');
  assert.equal(compact.result.effectTruth.actualKind, 'destructive');
});

test('새 runtime은 과거 Browser 사실을 보존하지만 stale ref·tab을 조작 상태로 재사용하지 않는다', () => {
  const source = browserReceipt({
    id: 'restart-old', url: 'https://business.example/editor',
    text: '- paragraph "기존 초안"', refs: { e7: { name: '기존 초안', role: 'paragraph' } },
  });
  const entries = [{
    messageId: 'browser-after-restart',
    message: { role: 'tool', toolCallId: 'browser-restart', name: 'browser', content: JSON.stringify(source) },
  }];
  const projected = projectHistoricalConversationEntries(entries, {
    preserveBrowserInteractionState: false,
  });
  const receipt = JSON.parse(projected.messages[0].content);
  assert.equal(receipt.result.observation.text, '- paragraph "기존 초안"');
  assert.equal(receipt.result.observation.interactionState, 'historical_reobserve_required');
  assert.equal(receipt.result.observation.observationId, undefined);
  assert.equal(receipt.result.observation.refs, undefined);
  assert.equal(receipt.result.observation.refScope.tabId, undefined);
  assert.equal(receipt.result.tab.tabId, undefined);
  assert.equal(receipt.result.tab.url, 'https://business.example/editor');
});

test('browser 로그인 경계의 사용자 handoff와 비밀 미관측 사실을 보존한다', () => {
  const receipt = {
    toolCallId: 'login-1',
    requestedCall: { id: 'login-1', name: 'browser', args: { action: 'login_start' } },
    actualCall: { name: 'browser', args: { action: 'login_start' } },
    outcome: 'succeeded',
    result: {
      state: 'user_control_required', pageObserved: false, secretValuesObserved: false,
      secretFieldsPresent: true, continuityEstablished: false,
      tab: { tabId: 't2', targetId: 'secret-target', title: '로그인', url: 'https://example.com/login', active: true },
      handoff: { visible: true, inputOwner: 'user', modelActionsBlocked: true },
      profile: { id: 'isolated', selected: true }, effect: 'observe',
    },
  };
  const projected = projectHistoricalConversation([{
    role: 'tool', toolCallId: 'login-1', name: 'browser', content: JSON.stringify(receipt),
  }]);
  const compact = JSON.parse(projected[0].content);
  assert.equal(compact.result.state, 'user_control_required');
  assert.equal(compact.result.pageObserved, false);
  assert.equal(compact.result.secretValuesObserved, false);
  assert.equal(compact.result.secretFieldsPresent, true);
  assert.equal(compact.result.continuityEstablished, false);
  assert.deepEqual(compact.result.handoff, {
    visible: true, inputOwner: 'user', modelActionsBlocked: true,
  });
  assert.equal(compact.result.tab.url, 'https://example.com/login');
  assert.doesNotMatch(projected[0].content, /secret-target|profile/);
});
