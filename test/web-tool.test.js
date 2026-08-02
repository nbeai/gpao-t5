import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defineWebTool, validateWebInput, makeSourceEvidence, assertWebEvidence, classifyWebFetch, webSourcePolicy,
} from '../src/kernel/l2-plan/web-tool.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

test('defineWebTool: 읽기 전용·승인 불요·입력스키마·스크래핑 정책·세션모드', () => {
  const d = defineWebTool({ id: 'web.collect' });
  assert.equal(d.toolKind, 'read');
  assert.equal(d.needsApproval, false);
  assert.ok(d.inputSchema.url && d.inputSchema.maxPages);
  assert.ok(d.schema.parameters.properties.selectionGoal, '최신 근거 비교를 모델이 구조로 선택할 수 있어야 한다');
  assert.deepEqual(d.sourcePolicy, { readOnly: true, noMassCollect: true, noExternalSend: true, sourceLedgerRequired: true });
  assert.equal(d.sessionMode, 'anonymous');
});

test('validateWebInput: 대상 필수, maxPages 상한(대량수집 금지), allowedDomains 경계', () => {
  assert.equal(validateWebInput({}).ok, false);
  assert.equal(validateWebInput({ searchQuery: 'x' }).ok, true);
  assert.equal(validateWebInput({ url: 'https://a.com', maxPages: 999 }).normalized.maxPages, 5); // 상한
  assert.equal(validateWebInput({ url: 'https://evil.com', allowedDomains: ['a.com'] }).ok, false);
  assert.equal(validateWebInput({ searchQuery: 'x', selectionGoal: 'latest_evidence' }).normalized.selectionGoal, 'latest_evidence');
  assert.equal(validateWebInput({ searchQuery: 'x', selectionGoal: 'unknown' }).ok, false);
});

test('makeSourceEvidence: 출처 계약 필드 + excerptHash', () => {
  const e = makeSourceEvidence({ sourceUrl: 'https://a.com', title: 'T', excerpt: '본문', confidence: 0.7, now: 100 });
  assert.equal(e.sourceUrl, 'https://a.com');
  assert.equal(e.fetchedAt, 100);
  assert.equal(e.title, 'T');
  assert.ok(typeof e.excerptHash === 'string' && e.excerptHash.length > 0);
  assert.equal(e.confidence, 0.7);
  assert.throws(() => makeSourceEvidence({}), /sourceUrl/);
});

// 핵심 불변식: 출처 없는 성공은 계약 위반 — throw. "검색했다/봤다"를 출처 없이 말 못 한다.
test('assertWebEvidence: 출처 없는 성공은 거부, 있으면 통과, 차단은 통과', () => {
  assert.throws(() => assertWebEvidence({ result: { x: 1 } }), /출처/); // 내용 있으나 sources 없음
  assert.doesNotThrow(() => assertWebEvidence({ result: { x: 1 }, sources: [{ sourceUrl: 'https://a' }] }));
  assert.doesNotThrow(() => assertWebEvidence({ blocked: true })); // 차단은 내용 없음 — 통과
});

test('classifyWebFetch: 로그인벽/봇벽/robots/차단/타임아웃 분리', () => {
  assert.equal(classifyWebFetch({ status: 'login required' }), 'login_wall');
  assert.equal(classifyWebFetch({ status: 'captcha' }), 'bot_wall');
  assert.equal(classifyWebFetch({ status: 'robots disallow' }), 'robots_disallow');
  assert.equal(classifyWebFetch({ status: '접근 차단' }), 'blocked');
  assert.equal(classifyWebFetch({ status: 'timeout' }), 'timeout');
  assert.equal(classifyWebFetch({ status: '정상 본문' }), 'ok');
});

// 감사 보정 1(반대 테스트): 출처 강제는 handler가 아니라 ToolRunner가 한다.
// 나쁜 handler가 출처 없이 성공을 반환해도 delivered가 아니라 failed로 떨어진다.
test('sourceLedgerRequired 도구가 출처 없이 성공 반환하면 failed로 떨어진다', async () => {
  const selfState = buildSelfState({ model: { id: 'm' }, connections: [{ id: 'bad.web', connected: true, status: 'usable' }] });
  const runner = new ToolRunner({
    'bad.web': { sourceLedgerRequired: true, async handler() { return { result: { x: 1 }, userSafeSummary: '웹에서 확인했어요.' }; } },
  });
  const r = await runner.run('bad.web', {}, selfState);
  assert.equal(r.failureState, 'failed', '출처 없는 성공은 delivered 아님');
  assert.notEqual(r.lifecycle, 'delivered');
});

// 감사 보정 2(반대 테스트): 실패 상태에 내용/출처가 섞이면 거부.
test('assertWebEvidence: 실패 상태에 result/sources가 섞이면 거부', () => {
  assert.throws(() => assertWebEvidence({ fetchState: 'blocked', result: { x: 1 } }), /위반/);
  assert.throws(() => assertWebEvidence({ blocked: true, sources: [{ sourceUrl: 'x' }] }), /위반/);
  assert.doesNotThrow(() => assertWebEvidence({ fetchState: 'blocked', userSafeSummary: '막힘', nextSafeAction: '대안' }));
});

// 감사 보정 3(반대 테스트): allowedDomains는 hostname 기준(우회 차단, invalid 거부).
test('validateWebInput: hostname 기준 — ?next 우회 차단, subdomain 허용, invalid 거부', () => {
  assert.equal(validateWebInput({ url: 'https://evil.com/?next=a.com', allowedDomains: ['a.com'] }).ok, false);
  assert.equal(validateWebInput({ url: 'https://docs.a.com/x', allowedDomains: ['a.com'] }).ok, true);
  assert.equal(validateWebInput({ url: 'https://a.com', allowedDomains: ['a.com'] }).ok, true);
  assert.equal(validateWebInput({ url: 'not a url', allowedDomains: ['a.com'] }).ok, false);
});

// 감사 보정 4(반대 테스트): 세션모드로 auth≠approval 분리.
test('세션모드: user_approved=승인 필요, authenticated=auth 축(승인 아님), anonymous=A0', () => {
  assert.equal(defineWebTool({ sessionMode: 'anonymous' }).needsApproval, false);
  assert.equal(defineWebTool({ sessionMode: 'user_approved' }).needsApproval, true);
  const authd = defineWebTool({ sessionMode: 'authenticated' });
  assert.equal(authd.needsApproval, false);
  assert.ok(authd.availability.some((s) => s.kind === 'auth'), 'authenticated는 auth availability');
});

// 선택 보정: confidence clamp.
test('makeSourceEvidence: confidence 0~1 clamp', () => {
  assert.equal(makeSourceEvidence({ sourceUrl: 'x', confidence: 5 }).confidence, 1);
  assert.equal(makeSourceEvidence({ sourceUrl: 'x', confidence: -2 }).confidence, 0);
});

// 런타임: 웹 성공 receipt는 sources를 담고, 차단은 sources 없이 미확인(출처 원장 연결).
test('웹 성공 receipt는 sources 포함, 차단은 sources 없음', async () => {
  const selfState = buildSelfState(demoEnv());
  const tools = demoTools();
  const ok = await tools.run('web.collect', { request: '뉴스 조사' }, selfState);
  assert.equal(ok.failureState, 'none');
  assert.ok(Array.isArray(ok.sources) && ok.sources.length >= 1, '성공엔 출처');
  assert.match(ok.sources[0].sourceUrl, /^https?:/);

  const blocked = await tools.run('web.collect', { request: '이 차단된 페이지' }, selfState);
  assert.equal(blocked.failureState, 'blocked');
  assert.ok(!blocked.sources || blocked.sources.length === 0, '차단엔 출처 없음(확인 못 함)');
});
