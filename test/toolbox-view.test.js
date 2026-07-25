import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectToolbox } from '../src/surface/toolbox-view.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv, demoDescriptors } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

const view = () => projectToolbox(buildSelfState(demoEnv()), demoDescriptors());

// 감사 §10.1: UI 상태 = 실제 runtime 상태. status → 상태 점 매핑이 실제 status에서 온다.
test('상태 점: 실제 status에서 온다(usable→green, needs_auth→yellow)', () => {
  const { tools } = view();
  const web = tools.find((t) => t.id === 'web.collect');
  assert.equal(web.statusDot, 'green'); // web.collect: connected → usable
  assert.equal(web.userStatus, '사용 가능');
  const mail = tools.find((t) => t.id === 'mail.send');
  assert.equal(mail.statusDot, 'yellow', 'mail.send: 인증 미준비 → 연결 필요');
  assert.equal(mail.userStatus, '연결이 필요해요');
});

// 감사 §5.2: 설치됨/실행 가능/승인 필요를 섞지 않는다 — 세 축이 각각 나온다.
test('세 축 분리: connected / executable / needsApproval', () => {
  const { tools } = view();
  const slack = tools.find((t) => t.id === 'slack.post');
  assert.equal(slack.connected, true);
  assert.equal(slack.executable, true, '실행 가능(연결됨)');
  assert.equal(slack.needsApproval, true, '그래도 전송은 승인');
  const mail = tools.find((t) => t.id === 'mail.send');
  assert.equal(mail.executable, false, '연결됐지만 실행 준비 안 됨');
  assert.equal(mail.needsApproval, true);
});

// 감사 §10.5: 웹 도구는 출처 원장 조건을 표시한다.
test('웹 도구는 출처를 남긴다(sourceLedgerRequired 표면화)', () => {
  const { tools } = view();
  const web = tools.find((t) => t.id === 'web.collect');
  assert.equal(web.sourceLedgerRequired, true);
  assert.ok(web.badges.includes('출처를 남겨요'));
  const slack = tools.find((t) => t.id === 'slack.post');
  assert.equal(slack.sourceLedgerRequired, false);
});

// 감사 §10.4: 외부 전송 도구는 승인 경계를 분명히 보인다(사용자 언어).
test('전송 도구는 "실행 전에 확인받아요" 배지', () => {
  const { tools } = view();
  const slack = tools.find((t) => t.id === 'slack.post');
  assert.ok(slack.badges.includes('보내요'));
  assert.ok(slack.badges.includes('실행 전에 확인받아요'));
});

// 감사 §10.6·§7원칙: 기술 용어(status enum, MCP, token, schema)를 표면 문자열에 노출하지 않는다.
test('사용자 언어: 기술 용어 미노출', () => {
  const { tools } = view();
  const blob = JSON.stringify(tools.map((t) => ({ userStatus: t.userStatus, badges: t.badges, blurb: t.blurb })));
  for (const term of ['needs_auth', 'needsApproval', 'sourceLedgerRequired', 'MCP', 'token', 'schema', 'toolKind']) {
    assert.ok(!blob.includes(term), `표면에 "${term}" 노출 금지`);
  }
});

// 감사 §10.3: 없는 도구를 있는 것처럼 보이지 않는다 — 투영은 실제 descriptor에서만 온다.
test('없는 도구는 만들지 않는다 — 카드 수 = descriptor 수', () => {
  const { tools, categories } = view();
  assert.equal(tools.length, demoDescriptors().length);
  assert.ok(categories.includes('브라우저/웹') && categories.includes('메신저') && categories.includes('로컬 파일'));
});

// connectedTools에 없는 descriptor는 회색(비활성) — 있는 척하지 않는다.
test('connectedTools에 없으면 회색(비활성)', () => {
  const self = buildSelfState({ model: { authSignal: 'ok' }, connections: [], grantedAuthorities: [] });
  const { tools } = projectToolbox(self, demoDescriptors());
  assert.ok(tools.every((t) => t.statusDot === 'gray' && t.userStatus === '비활성'));
});

test('서버 GET /toolbox: 실제 상태 카드 반환', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tb-'));
  const server = makeServer({ store: new SessionStore(dir) });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try {
    const r = await (await fetch(`http://127.0.0.1:${port}/toolbox`)).json();
    assert.ok(Array.isArray(r.tools) && r.tools.length >= 3);
    assert.ok(r.tools.every((t) => ['green', 'yellow', 'red', 'gray'].includes(t.statusDot)));
    assert.ok(r.categories.length >= 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
