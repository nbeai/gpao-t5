import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectPersonalToolRequest, definePersonalTool, runProbe, applyProbe, isPersonalExecutable,
} from '../src/kernel/l2-plan/personal-tool.js';
import { defineSkill, detectSkillRequest, isSkillReady } from '../src/kernel/l2-plan/skill-descriptor.js';
import { projectToolbox } from '../src/surface/toolbox-view.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv, demoDescriptors } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

// ── 계약: 등록됨 ≠ 실행 가능. 테스트 통과가 executable을 결정한다. ──
test('개인 도구: 등록은 테스트 전(실행 불가), 프로브 통과해야 실행 가능', () => {
  const t = definePersonalTool({ id: 'p1', label: '내 크롤러', kind: 'web' });
  assert.equal(t.testState, 'untested');
  assert.equal(isPersonalExecutable(t), false, '등록만으론 실행 불가');
  // 필수 설정 없음 → 프로브 실패(이유·다음 안전 행동)
  const fail = runProbe(t);
  assert.equal(fail.ok, false);
  assert.match(fail.reason, /url/);
  assert.ok(fail.nextSafeAction);
  const failed = applyProbe(t, fail);
  assert.equal(failed.testState, 'failed');
  assert.equal(isPersonalExecutable(failed), false);
  // 설정 채우면 통과 → 실행 가능
  const t2 = definePersonalTool({ id: 'p2', label: '내 크롤러', kind: 'web', config: { url: 'http://x' } });
  const pass = runProbe(t2);
  assert.equal(pass.ok, true);
  assert.equal(isPersonalExecutable(applyProbe(t2, pass)), true);
});

test('개인 도구 감지: 준비 요청만 후보, 일반 발화는 아님', () => {
  assert.ok(detectPersonalToolRequest('이 크롤러 쓸 수 있게 준비해줘'));
  assert.ok(detectPersonalToolRequest('내 파이썬 스크립트 등록해줘')?.kind === 'script');
  assert.equal(detectPersonalToolRequest('오늘 날씨 어때'), null);
});

// ── 도구함 투영: 개인 도구가 "개인용/테스트 전/실행 불가"로 정확히 보인다. ──
test('도구함: 개인 도구 untested→노랑 테스트 전·실행 불가 / passed→초록 사용 가능', () => {
  const self = buildSelfState(demoEnv());
  const untested = definePersonalTool({ id: 'u1', label: '내 도구', kind: 'web' });
  const passed = applyProbe(definePersonalTool({ id: 'u2', label: '된 도구', kind: 'web', config: { url: 'http://x' } }), { ok: true });
  const { tools } = projectToolbox(self, demoDescriptors(), [untested, passed]);
  const a = tools.find((t) => t.id === 'u1');
  assert.equal(a.category, '개인용');
  assert.equal(a.statusDot, 'yellow');
  assert.equal(a.userStatus, '테스트 전');
  assert.equal(a.executable, false, '테스트 전엔 실행 불가');
  assert.ok(a.badges.includes('개인용'));
  const b = tools.find((t) => t.id === 'u2');
  assert.equal(b.statusDot, 'green');
  assert.equal(b.executable, true);
});

// 기술 용어가 개인 도구 표면에 새지 않는다.
test('도구함: 개인 도구도 사용자 언어(기술 용어 미노출)', () => {
  const t = applyProbe(definePersonalTool({ id: 'x', label: '내 도구', kind: 'web' }), runProbe(definePersonalTool({ id: 'x', label: '내 도구', kind: 'web' })));
  const { tools } = projectToolbox(buildSelfState(demoEnv()), demoDescriptors(), [t]);
  const blob = JSON.stringify(tools.find((c) => c.id === 'x'));
  for (const term of ['testState', 'untested', 'failed', 'MCP', 'schema', 'toolKind', 'executable"']) {
    // userStatus/badges/blurb/connectHint에 기술 용어가 없어야(필드 이름 executable은 데이터라 예외)
  }
  const card = tools.find((c) => c.id === 'x');
  const surface = [card.userStatus, ...card.badges, card.blurb, card.connectHint].join(' ');
  for (const term of ['testState', 'untested', 'passed', 'MCP', 'schema']) {
    assert.ok(!surface.includes(term), `표면에 ${term} 노출 금지`);
  }
});

// ── 스킬 계약 초안(2.0-C-2): 도구 ≠ 스킬. replay 전 사용 불가. ──
test('스킬 계약: 다섯 축 + replay 전 사용 불가', () => {
  const s = defineSkill({ id: 's1', label: '리뷰 분석', understanding: '리뷰 보고 문제점', procedure: ['수집', '분류', '요약'], outputShape: '표+요약' });
  assert.equal(s.testState, 'untested');
  assert.equal(isSkillReady(s), false, 'replay 전엔 사용 불가');
  assert.deepEqual(s.procedure, ['수집', '분류', '요약']);
  assert.equal(detectSkillRequest('이 방식 템플릿으로 저장해줘') != null, true);
  assert.equal(detectSkillRequest('안녕'), null);
});

// ── 서버 전체 흐름: 등록(테스트 전) → 도구함 표시 → 테스트 실패(이유) → 설정 후 통과 → 사용 가능 ──
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const getj = async (base, path) => (await fetch(`${base}${path}`)).json();

async function withServer(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-pt-'));
  const server = makeServer({ store: new SessionStore(dir) });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try { return await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((r) => server.close(r)); }
}

test('서버: 등록 → 도구함 테스트 전 → 테스트 실패(이유) → 설정 통과 → 사용 가능', async () => {
  await withServer(async (base) => {
    // 설정 없이 등록 → 테스트 전, 실행 불가
    const reg = await (await post(base, '/personal-tools', { label: '내 크롤러', kind: 'web' })).json();
    assert.equal(reg.ok, true);
    assert.equal(reg.executable, false);
    let view = await getj(base, '/toolbox');
    let card = view.tools.find((t) => t.id === reg.id);
    assert.equal(card.userStatus, '테스트 전');
    assert.equal(card.executable, false);
    // 테스트 → 설정 없어 실패 + 이유·다음 안전 행동
    const t1 = await (await post(base, `/personal-tools/${reg.id}/test`)).json();
    assert.equal(t1.ok, false);
    assert.match(t1.reason, /url/);
    assert.ok(t1.nextSafeAction);
    // 설정 채워 등록 → 테스트 통과 → 사용 가능
    const reg2 = await (await post(base, '/personal-tools', { label: '내 크롤러', kind: 'web', config: { url: 'http://x' } })).json();
    const t2 = await (await post(base, `/personal-tools/${reg2.id}/test`)).json();
    assert.equal(t2.ok, true);
    assert.equal(t2.executable, true);
    view = await getj(base, '/toolbox');
    card = view.tools.find((t) => t.id === reg2.id);
    assert.equal(card.userStatus, '사용 가능');
    assert.equal(card.executable, true);
  });
});

test('서버: "쓸 수 있게 준비해줘" turn → toolCandidate(원래 요청 보존)', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const r = await (await post(base, '/turn', { sessionId: s.id, text: '내 크롤러 스크립트 쓸 수 있게 준비해줘' })).json();
    assert.ok(r.toolCandidate, '개인 도구 후보 표면화');
    assert.match(r.toolCandidate.requestText, /크롤러/, '원래 요청 보존');
    // 일반 발화는 후보 없음(null/undefined 모두 "없음")
    const r2 = await (await post(base, '/turn', { sessionId: s.id, text: '고마워' })).json();
    assert.ok(!r2.toolCandidate, '일반 발화엔 개인 도구 후보 없음');
  });
});
