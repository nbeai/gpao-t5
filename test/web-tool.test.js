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
  assert.deepEqual(d.sourcePolicy, { readOnly: true, noMassCollect: true, noExternalSend: true, sourceLedgerRequired: true });
  assert.equal(d.sessionMode, 'anonymous');
});

test('validateWebInput: 대상 필수, maxPages 상한(대량수집 금지), allowedDomains 경계', () => {
  assert.equal(validateWebInput({}).ok, false);
  assert.equal(validateWebInput({ searchQuery: 'x' }).ok, true);
  assert.equal(validateWebInput({ url: 'https://a.com', maxPages: 999 }).normalized.maxPages, 5); // 상한
  assert.equal(validateWebInput({ url: 'https://evil.com', allowedDomains: ['a.com'] }).ok, false);
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
