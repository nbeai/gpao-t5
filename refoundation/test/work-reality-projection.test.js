import assert from 'node:assert/strict';
import test from 'node:test';

import { projectPublicWorkReality, projectWorkReality } from '../src/work-reality-projection.js';

const at = (second) => `2026-08-27T00:00:${String(second).padStart(2, '0')}.000Z`;
function event(sequence, type, extra = {}) { return { schema: 'fixture', sequence,
  recordedAt: at(sequence), type, ...extra }; }
function base() { return { sessionId: 'session-private-1', workState: {
  works: [{ workId: 'work-private-1', sessionId: 'session-private-1', revision: 1, status: 'active' }],
  claims: [{ runId: 'run-private-1', workId: 'work-private-1', revision: 1, state: 'active' }],
  cancellations: [], inputs: [], results: [], events: [event(1, 'work_created', { workId: 'work-private-1',
    sessionId: 'session-private-1' })] }, run: { runId: 'run-private-1', sessionId: 'session-private-1',
  status: 'running', startedAt: at(1), events: [event(1, 'run_started')] } }; }
function project(input = base()) { return projectWorkReality(input); }

test('model 시작·완료나 일반 heartbeat는 meaningful milestone이 아니다', () => {
  const input = base(); input.run.events.push(event(2, 'model_started', { stepId: 'model-1' }),
    event(3, 'model_completed', { stepId: 'model-1' }), event(4, 'heartbeat'));
  const result = project(input); assert.equal(result.lastMilestone, null);
  assert.equal(result.state, 'starting');
});

test('heartbeat는 미정산 model·tool·장기 process 현실을 starting으로 되돌리지 않는다', () => {
  const model = base(); model.run.events.push(event(2, 'model_started', { payload: { turn: 1 } }),
    event(3, 'heartbeat')); assert.equal(project(model).state, 'model_working');
  const tool = base(); tool.run.events.push(event(2, 'tool_started', { payload: { toolCallId: 'call-1' } }),
    event(3, 'heartbeat')); assert.equal(project(tool).state, 'tool_working');
  const process = base(); process.run.events.push(event(2, 'tool_completed', { payload: { receipt: {
    toolCallId: 'call-1', outcome: 'succeeded', result: { processId: 'process-safe', state: 'running' },
  } } }), event(3, 'heartbeat'));
  assert.equal(project(process).state, 'process_working');
});

test('장기 process는 새 output delta가 실제 있을 때만 meaningful milestone을 만든다', () => {
  const observed = base(); observed.run.events.push(event(2, 'tool_completed', { payload: { receipt: {
    outcome: 'succeeded', actualCall: { name: 'terminal_session', args: { action: 'poll' } },
    result: { processId: 'process-safe', state: 'running', stdout: 'STEP 1/15\n', stderr: '' },
  } } })); assert.equal(project(observed).lastMilestone.kind, 'process_progress_observed');
  const empty = base(); empty.run.events.push(event(2, 'tool_completed', { payload: { receipt: {
    outcome: 'succeeded', actualCall: { name: 'terminal_session', args: { action: 'poll' } },
    result: { processId: 'process-safe', state: 'running', stdout: '', stderr: '' },
  } } })); assert.equal(project(empty).lastMilestone, null);
});

test('exact source observation이 있는 succeeded receipt만 evidence milestone이다', () => {
  const input = base(); input.run.events.push(event(2, 'tool_completed', { payload: { receipt: {
    outcome: 'succeeded', requestedCall: { args: { effect: { kind: 'observe' } } },
    result: { source: { availability: 'available', digestMatched: true,
      recordId: 'record-safe', observedSha256: 'b'.repeat(64) } },
  } } }));
  assert.equal(project(input).lastMilestone.kind, 'evidence_observed');
  const empty = base(); empty.run.events.push(event(2, 'tool_completed', { payload: { receipt: {
    outcome: 'succeeded', requestedCall: { args: { effect: { kind: 'observe' } } }, result: { state: 'completed' },
  } } })); assert.equal(project(empty).lastMilestone, null);
});

test('known changed effect만 effect_confirmed이고 unknown은 degraded·unknown state다', () => {
  const changed = base(); changed.run.events.push(event(2, 'tool_completed', { payload: { receipt: {
    outcome: 'succeeded', actualCall: { args: { effect: { kind: 'local_change' } } },
    result: { effectUnknown: false, effectObservation: { changed: true,
      observationDigest: 'c'.repeat(64) } },
  } } })); assert.equal(project(changed).lastMilestone.kind, 'effect_confirmed');
  const unknown = base(); unknown.run.events.push(event(2, 'tool_completed', { payload: { receipt: {
    outcome: 'unknown', result: { effectUnknown: true },
  } } })); const result = project(unknown); assert.equal(result.lastMilestone.kind, 'degraded');
  assert.equal(result.state, 'unknown_effect');
});

test('EffectObservation v2 receipt와 terminal·file receipt만 grounded milestone을 만든다', () => {
  const effect = base(); effect.run.events.push(event(2, 'tool_completed', { payload: { receipt: {
    outcome: 'succeeded', actualCall: { name: 'exec', args: { effect: { kind: 'local_change' } } },
    result: { effectUnknown: false, effectObservation: { schema: 't5.effect-observation.v2',
      changed: true, receiptDigest: 'd'.repeat(64) } },
  } } })); assert.equal(project(effect).lastMilestone.kind, 'effect_confirmed');
  const computer = base(); computer.run.events.push(event(2, 'tool_completed', { payload: { receipt: {
    outcome: 'succeeded', actualCall: { name: 'exec', args: {} }, result: { state: 'completed', exitCode: 0 },
  } } })); assert.equal(project(computer).lastMilestone.kind, 'computer_step_completed');
  const file = base(); file.run.events.push(event(2, 'tool_completed', { payload: { receipt: {
    outcome: 'succeeded', actualCall: { name: 'attachment', args: { action: 'inspect' } },
    result: { state: 'observed', trust: 'untrusted_external', observation: { kind: 'text' } },
  } } })); assert.equal(project(file).lastMilestone.kind, 'file_observed');
  const arbitrary = base(); arbitrary.run.events.push(event(2, 'tool_completed', { payload: { receipt: {
    outcome: 'succeeded', actualCall: { name: 'foreign_tool', args: {} }, result: { state: 'completed' },
  } } })); assert.equal(project(arbitrary).lastMilestone, null);
});

test('output_produced만 artifact milestone을 만들고 raw artifact identity는 public에 없다', () => {
  const input = base(); input.run.events.push(event(2, 'output_produced', { payload: {
    outputHandle: 'artifact-private-1', name: 'secret.txt', sha256: 'a'.repeat(64),
    bytes: 10, verified: true, reopened: true } }));
  const internal = project(input); assert.equal(internal.lastMilestone.kind, 'artifact_created');
  assert.doesNotMatch(JSON.stringify(projectPublicWorkReality(internal)), /artifact-private|secret\.txt|a{64}/u);
});

test('verification·surface·delivery milestone은 canonical Work 사건 순서대로 최신을 선택한다', () => {
  const input = base(); input.workState.events.push(
    event(2, 'completion_verified', { workId: 'work-private-1', verifiedOutcome: 'achieved' }),
    event(3, 'result_surface_persisted', { runId: 'run-private-1' }),
    event(4, 'result_delivery_terminal', { runId: 'run-private-1', delivery: { state: 'sent' } }));
  assert.equal(project(input).lastMilestone.kind, 'delivery_succeeded');
  input.workState.events.at(-1).delivery.state = 'unknown';
  assert.equal(project(input).lastMilestone.kind, 'delivery_unknown');
});

test('과거 Run·revision milestone은 현재 Run 현실로 승격하지 않는다', () => {
  const input = base(); input.workState.events.push(event(9, 'completion_verified', {
    workId: 'work-private-1', revision: 0, runId: 'old-run', verifiedOutcome: 'achieved' }));
  assert.equal(project(input).lastMilestone, null);
});

test('failed tool·resource degraded는 성공 milestone이 아니라 degraded다', () => {
  const input = base(); input.run.events.push(event(2, 'tool_completed', { payload: { receipt: {
    outcome: 'failed', result: { error: 'private failure' },
  } } })); const internal = project(input); assert.equal(internal.lastMilestone.kind, 'degraded');
  assert.doesNotMatch(JSON.stringify(projectPublicWorkReality(internal)), /private failure/u);
});

test('input lifecycle은 queued·presented·consumed·followup·separate·unconsumed·cancel을 합치지 않는다', () => {
  const input = base(); input.workState.inputs = [
    { inputId: 'i1', sessionId: 'session-private-1', workId: null, state: 'admitted' },
    { inputId: 'i2', sessionId: 'session-private-1', workId: 'work-private-1', revision: 1, state: 'presented' },
    { inputId: 'i3', sessionId: 'session-private-1', workId: 'work-private-1', revision: 1,
      state: 'executed', settlementDisposition: 'answered', settlementWorkId: 'work-private-1',
      settlementRevision: 1 },
    { inputId: 'i4', sessionId: 'session-private-1', workId: 'work-private-1', revision: 1, state: 'scheduled' },
    { inputId: 'i5', sessionId: 'session-private-1', workId: 'work-private-1', revision: 1,
      state: 'classified', disposition: 'independent_work' },
    { inputId: 'i6', sessionId: 'session-private-1', workId: 'work-private-1', revision: 1,
      state: 'classified', settlementDisposition: 'unresolved', settlementWorkId: 'work-private-1',
      settlementRevision: 1 },
    { inputId: 'i7', sessionId: 'session-private-1', workId: 'work-private-1', revision: 1,
      state: 'executing', disposition: 'cancelled_work' },
  ];
  assert.deepEqual(project(input).inputs.map((item) => item.state),
    ['queued', 'presented', 'consumed', 'followup', 'separate', 'unconsumed', 'cancel']);
});

test('presented 입력은 exact answered surface 전 consumed가 아니다', () => {
  const input = base(); input.workState.inputs = [{ inputId: 'i1', sessionId: 'session-private-1',
    workId: 'work-private-1', revision: 1,
    state: 'completed_pending_surface', settlementDisposition: 'answered' }];
  assert.equal(project(input).inputs[0].state, 'presented');
});

test('prepared·과거 revision·중복 input은 현재 표면에서 제외하고 16개로 bounded한다', () => {
  const input = base(); input.workState.inputs = [
    { inputId: 'prepared', sessionId: 'session-private-1', state: 'prepared' },
    { inputId: 'old', sessionId: 'session-private-1', workId: 'work-private-1', revision: 0,
      state: 'presented' },
    ...Array.from({ length: 18 }, (_, index) => ({ inputId: `current-${index}`,
      sessionId: 'session-private-1', workId: 'work-private-1', revision: 1, state: 'presented' })),
    { inputId: 'current-17', sessionId: 'session-private-1', workId: 'work-private-1',
      revision: 1, state: 'presented' },
  ];
  const result = project(input); assert.equal(result.inputs.length, 16);
  assert.ok(result.inputs.every((item) => item.state === 'presented'));
});

test('cancel terminal은 일곱 settlement의 논리곱 뒤에만 성립한다', () => {
  const input = base(); input.run.status = 'cancelled'; input.workState.claims[0].state = 'released';
  input.workState.works[0].revision = 2; input.workState.works[0].status = 'cancelled';
  input.workState.cancellations = [{ runId: 'run-private-1', workId: 'work-private-1', revision: 1,
    nextRevision: 2, state: 'terminal', childrenTerminal: true, claimReleased: true,
    surfacePersisted: true, unknownEffect: false, disposition: 'hard_cancelled' }];
  assert.equal(project(input).state, 'cancelled');
  for (const field of ['childrenTerminal', 'claimReleased', 'surfacePersisted']) {
    const changed = structuredClone(input); changed.workState.cancellations[0][field] = false;
    if (field === 'claimReleased') changed.workState.claims[0].state = 'active';
    assert.notEqual(project(changed).state, 'cancelled', field);
  }
});

test('실행은 멈췄지만 claim·surface가 남으면 recovery_pending이다', () => {
  const input = base(); input.run.status = 'cancelled'; input.workState.works[0].revision = 2;
  input.workState.works[0].status = 'paused'; input.workState.claims[0].state = 'released';
  input.workState.cancellations = [{ runId: 'run-private-1', workId: 'work-private-1', revision: 1,
    nextRevision: 2, state: 'recovery_pending', childrenTerminal: null, claimReleased: true,
    surfacePersisted: true, unknownEffect: true, disposition: 'interrupted_resumable' }];
  const result = project(input); assert.equal(result.state, 'recovery_pending');
  assert.match(projectPublicWorkReality(result).statusText, /추가 확인/u);
});

test('같은 canonical snapshot은 restart 재구성 뒤 generation과 public projection이 같다', () => {
  const input = base(); input.run.events.push(event(2, 'heartbeat'));
  const first = project(input); const restarted = project(structuredClone(input));
  assert.equal(first.generation, restarted.generation);
  assert.deepEqual(projectPublicWorkReality(first), projectPublicWorkReality(restarted));
});

test('semantic state가 같은 heartbeat·poll은 generation을 늘리지 않는다', () => {
  const input = base(); input.run.events.push(event(2, 'heartbeat'));
  const first = project(input); input.run.events.push(event(3, 'heartbeat'));
  const second = project(input); assert.equal(first.generation, second.generation);
});

test('public projection은 canonical ID·command·path·hash·secret을 노출하지 않는다', () => {
  const input = base(); input.run.events.push(event(2, 'tool_started', { stepId: 'tool-private', payload: {
    command: '/Users/private/secret', token: 'SECRET-CANARY' } }));
  const serialized = JSON.stringify(projectPublicWorkReality(project(input)));
  assert.doesNotMatch(serialized, /session-private|work-private|run-private|tool-private|\/Users\/private|SECRET-CANARY|[a-f0-9]{64}/u);
});

test('recap은 존재하는 사실만 최대 네 줄이며 모델 요약·ETA·percentage가 없다', () => {
  const input = base(); input.run.events.push(event(2, 'tool_completed', { payload: { receipt: {
    outcome: 'succeeded', result: { state: 'approval_required' } } } }));
  const publicValue = projectPublicWorkReality(project(input)); assert.ok(publicValue.recap.length <= 4);
  assert.doesNotMatch(JSON.stringify(publicValue), /ETA|%|percent|tool|Run|Work/u);
});

test('short idle/result와 off-on projection은 canonical input·model/context/write를 바꾸지 않는다', () => {
  const input = base(); const before = structuredClone(input); const internal = project(input);
  assert.deepEqual(input, before); assert.equal(internal.currentActivity.kind, 'starting');
  const publicValue = projectPublicWorkReality(internal); assert.equal('modelCalls' in publicValue, false);
  assert.equal('contextBytes' in publicValue, false); assert.equal('writes' in publicValue, false);
});
