import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { StubModelClient } from '../src/runtime/model-client.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { TruthLedger } from '../src/kernel/l0-evidence/ledger.js';

function ctx(overrides = {}) {
  return {
    env: {
      model: { id: 'beai5-stub', authSignal: overrides.authSignal ?? 'ok' },
      connections: overrides.connections ?? [
        { id: 'web.collect', connected: true, executable: true },
        { id: 'local.file', connected: true, executable: true },
        { id: 'mail.send', connected: true, executable: false },
      ],
    },
    model: new StubModelClient(),
    tools: overrides.tools ?? new ToolRunner({
      'web.collect': { async handler() { return { result: {}, userSafeSummary: '공개 자료로 확인' }; } },
      'local.file': { async handler() { return { result: {}, userSafeSummary: '파일 확인(변경 없음)' }; } },
    }),
    ledger: new TruthLedger(),
  };
}

// S01: fast path — ActionPlan·도구 없이 즉답. 자기파악 칩은 동봉되되 대화를 점유하지 않는다.
test('S01 잡담은 fast path 로 즉답', async () => {
  const r = await runTurn({ text: '안녕, 오늘 좀 피곤하네.' }, ctx());
  assert.equal(r.kind, 'reply');
  assert.ok(r.selfStateSummary);
  assert.deepEqual(r.ledger, { confirmed: [], unconfirmed: [], estimated: [] });
});

// S04: 애매하면 실행 전 멈추고 묻는다.
test('S04 "그거 정리 좀"은 실행 전 확인 질문', async () => {
  const r = await runTurn({ text: '그거 정리 좀' }, ctx());
  assert.equal(r.kind, 'clarify');
  assert.match(r.question, /무엇을/);
});

// S05: complex path — 계획·실행·원장이 보인다.
test('S05 조사 요청은 계획→실행→원장을 남긴다', async () => {
  const r = await runTurn({ text: '뉴스 좀 조사해줘' }, ctx());
  assert.equal(r.kind, 'reply');
  assert.ok(r.ledger.confirmed.length >= 1, '실행 확인이 원장에 남는다');
});

// S15: 목록에 있으나 실행 불가한 도구는 호출하지 않고 정직하게 막힘 처리.
test('S15 실행 불가 도구는 쓴 척하지 않고 막힘으로 원장에 남긴다', async () => {
  const r = await runTurn({ text: '이 초안 메일로 보내줘' }, ctx());
  // mail.send executable=false → 계획에서 실행 불가로 빠지고 A2 승인 대상도 없음.
  // complex 로 가되 실제 발송 호출은 없어야 한다(actualCall 없음).
  if (r.kind === 'reply') {
    assert.equal(r.ledger.confirmed.length, 0, '발송을 확인으로 남기지 않는다');
  } else {
    assert.equal(r.kind, 'approval');
  }
});

// S20/S23: 외부 전송이 실행 가능해도 승인 전에는 멈춘다.
test('S20 실행 가능한 발송은 승인 게이트에서 멈춘다', async () => {
  const c = ctx({ connections: [{ id: 'mail.send', connected: true, executable: true }] });
  const r = await runTurn({ text: '이 초안 메일로 보내줘' }, c);
  assert.equal(r.kind, 'approval');
  assert.ok(r.pending.some((p) => p.tier === 'A2'));
  assert.ok(r.pendingId, '보류 계획 id 를 발급한다');
  // 승인 카드도 사용자 라벨을 쓰고 내부 id 는 노출하지 않는다(안티 대시보드).
  const shown = r.pending.map((p) => `${p.label} ${p.preview?.impact}`).join(' ');
  assert.match(shown, /메일 발송/);
  assert.doesNotMatch(shown, /mail\.send/);
  // 승인 전이므로 어떤 발송도 원장에 없다(호출 안 함).
  assert.equal(c.ledger.entries.length, 0);
});

// 감사 지적 수정: 승인은 텍스트 재해석이 아니라 보관된 봉인 계획을 그대로 이어받는다.
test('S20 승인은 재해석 없이 보관된 계획을 이어받아 실행한다', async () => {
  const sent = [];
  const c = ctx({
    connections: [{ id: 'mail.send', connected: true, executable: true }],
    tools: new ToolRunner({ 'mail.send': { async handler(a) { sent.push(a); return { result: { ok: true }, userSafeSummary: '메일을 보냈어요' }; } } }),
  });
  const r1 = await runTurn({ text: '이 초안 메일로 보내줘' }, c);
  assert.equal(r1.kind, 'approval');
  // 두 번째 요청은 발화 텍스트 없이 승인 id 만 — 서버가 보관한 계획으로 재개.
  const r2 = await runTurn({ approve: r1.pendingId }, c);
  assert.equal(r2.kind, 'reply');
  assert.equal(sent.length, 1, '승인 후 실제 발송(계획 이어받음)');
  assert.ok(r2.ledger.confirmed.some((s) => /보냈/.test(s)));
});

// S23: 거부하면 실행하지 않고 안전 정지, 보류 계획은 폐기된다.
test('S23 거부는 실행하지 않고 안전 정지', async () => {
  const sent = [];
  const c = ctx({
    connections: [{ id: 'mail.send', connected: true, executable: true }],
    tools: new ToolRunner({ 'mail.send': { async handler(a) { sent.push(a); return { result: {}, userSafeSummary: '보냈어요' }; } } }),
  });
  const r1 = await runTurn({ text: '이 초안 메일로 보내줘' }, c);
  const r2 = await runTurn({ reject: r1.pendingId }, c);
  assert.equal(r2.kind, 'reply');
  assert.match(r2.reply, /보내지 않았어요/);
  assert.equal(sent.length, 0, '거부 후 발송 없음');
  // 폐기 후 같은 id 재승인은 무효(재실행 방지).
  const r3 = await runTurn({ approve: r1.pendingId }, c);
  assert.equal(sent.length, 0);
  assert.match(r3.reply, /찾지 못했어요/);
});

// S16: 도구 차단 → 성공인 척 금지, 다음 안전 행동 제시.
test('S16 사이트 차단은 미확인으로 남기고 다음 안전 행동을 준다', async () => {
  const c = ctx({
    tools: new ToolRunner({ 'web.collect': { async handler() { return { blocked: true, userSafeSummary: '그 사이트가 접근을 막고 있어요.' }; } } }),
  });
  const r = await runTurn({ text: '이 페이지 조사해서 가져와줘' }, c);
  assert.equal(r.kind, 'reply');
  assert.equal(r.ledger.confirmed.length, 0);
  assert.ok(r.ledger.unconfirmed.length >= 1);
  assert.ok(r.nextSafeAction, '막다른 답이 아니라 다음 안전 행동');
});

// 재발 방지: 세션 원장을 공유해도 턴 응답은 이번 턴 receipt 만 투영한다(턴 간 누출 금지).
test('턴 응답은 이전 턴 결과를 끌어오지 않는다(원장 누출 방지)', async () => {
  const c = ctx({
    tools: new ToolRunner({
      'web.collect': { async handler() { return { result: {}, userSafeSummary: '첫 턴 확인' }; } },
      'local.file': { async handler() { return { result: {}, userSafeSummary: '둘째 턴 파일 확인' }; } },
    }),
  });
  await runTurn({ text: '뉴스 조사해줘' }, c);              // 첫 턴: web.collect
  const r2 = await runTurn({ text: '이 폴더 파일 정리해줘' }, c); // 둘째 턴: local.file
  // 둘째 턴 응답에 첫 턴의 "첫 턴 확인" 이 섞이면 안 된다.
  assert.ok(!r2.ledger.confirmed.some((s) => s.includes('첫 턴')), '이전 턴 결과 비혼입');
  assert.ok(r2.ledger.confirmed.some((s) => s.includes('둘째 턴')));
  // 단, 세션 원장(감사용)은 두 턴을 모두 보존한다.
  assert.equal(c.ledger.entries.length, 2);
});

// S15: 실행 불가 도구는 조용히 넘기지 않고 다음 안전 행동으로 안내한다(죽은 버튼 금지).
test('S15 실행 불가 도구는 막힘 + 다음 안전 행동으로 안내', async () => {
  const r = await runTurn({ text: '이 초안 메일로 보내줘' }, ctx()); // mail.send executable=false
  assert.equal(r.kind, 'reply');
  assert.equal(r.ledger.confirmed.length, 0, '발송을 확인으로 남기지 않는다');
  assert.ok(r.ledger.unconfirmed.some((s) => s.includes('메일 발송')), '못 씀을 사용자 라벨로 표시');
  assert.ok(r.nextSafeAction, '연결/대체 안내로 이어감');
  // 안티 대시보드(S43/UX §1.2): 내부 도구 id(dot 표기)가 사용자면에 새지 않는다.
  const userText = [r.reply, ...r.ledger.unconfirmed, r.nextSafeAction].join(' ');
  assert.doesNotMatch(userText, /mail\.send|web\.collect|slack\.post/, '내부 도구 id 비노출');
});

// Phase 5.1(§1.5): Relevance Gate가 turn에 배선됨.
test('user_chat(기본 발화)은 게이트 우회 — 기존 동작 불변', async () => {
  const r = await runTurn({ text: '안녕' }, ctx());
  assert.equal(r.kind, 'reply'); // gated 아님
});

test('외부 이벤트 + 트리거 없음 → 턴 안 열림(gated), 사용자 답 없음', async () => {
  const r = await runTurn({ text: '광고 스팸', source: 'external_channel', triggerSignals: [] }, ctx());
  assert.equal(r.kind, 'gated');
  assert.equal(r.disposition, 'ignore');
  assert.equal(r.reply, undefined, '무시된 이벤트엔 사용자 답이 없다');
});

test('외부 이벤트 + mention → 정상 턴', async () => {
  const r = await runTurn({ text: '이것 좀 봐줘', source: 'external_channel', triggerSignals: ['mention'] }, ctx());
  assert.notEqual(r.kind, 'gated');
});

// Approval Lifecycle: 승인은 만료 전엔 이어실행, 만료 후엔 재승인 요청(이어실행 안 함).
test('만료 전 승인은 보관된 계획을 이어실행', async () => {
  let clock = 1000;
  const c = ctx({
    connections: [{ id: 'mail.send', connected: true, executable: true }],
    tools: new ToolRunner({ 'mail.send': { async handler() { return { result: { ok: true }, userSafeSummary: '메일을 보냈어요' }; } } }),
  });
  c.now = () => clock;
  const r1 = await runTurn({ text: '이 초안 메일로 보내줘' }, c);
  assert.equal(r1.kind, 'approval');
  clock += 60 * 1000; // TTL 이내
  const r2 = await runTurn({ approve: r1.pendingId }, c);
  assert.equal(r2.kind, 'reply');
  assert.ok(r2.ledger.confirmed.some((s) => /보냈/.test(s)));
});

test('만료된 승인은 실행하지 않고 재승인을 요청한다(죽은 버튼 금지)', async () => {
  let clock = 1000;
  const sent = [];
  const c = ctx({
    connections: [{ id: 'mail.send', connected: true, executable: true }],
    tools: new ToolRunner({ 'mail.send': { async handler(a) { sent.push(a); return { result: {}, userSafeSummary: '보냈어요' }; } } }),
  });
  c.now = () => clock;
  const r1 = await runTurn({ text: '이 초안 메일로 보내줘' }, c);
  clock += 30 * 60 * 1000 + 1; // TTL 초과
  const r2 = await runTurn({ approve: r1.pendingId }, c);
  assert.equal(r2.kind, 'reply');
  assert.match(r2.reply, /만료/);
  assert.equal(sent.length, 0, '만료 후 무단 지연 실행 금지');
});

// S28: billing_blocked 는 SelfState 에 결제 문구로 반영(재시도 아님).
test('S28 billing_blocked 는 결제 확인 안내(재시도 문구 아님)', async () => {
  const r = await runTurn({ text: '안녕' }, ctx({ authSignal: 'insufficient_quota' }));
  assert.equal(r.selfStateSummary.modelAuthState, 'billing_blocked');
  assert.match(r.selfStateSummary.nextSafeAction, /결제/);
});
