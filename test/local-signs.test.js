// P5-B-1A · 로컬 흔적 확인 — **이미 설치된 것은 사용자가 아니라 T5 가 확인한다.**
//
// 불변식 중심(문구 매칭 아님):
//   ① 있으면 있다, 없으면 없다 — 지어내지 않는다
//   ② 러너는 서비스를 모른다 — 지어낸 서비스도 같은 종류 선언이면 그대로 돈다
//   ③ 확인 안 한 것을 확인했다고 말하지 않는다 — 결과·시각이 없으면 그 줄 자체가 없다
//   ④ 비밀 경계 — mcp 는 서버 **이름 키만** 보고 값은 버린다
//   ⑤ 확인 결과가 모델 현실(프롬프트 문자열)까지 도달한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSign, checkConnectorSigns } from '../src/runtime/local-signs.js';
import { serviceStatus, externalReality } from '../src/kernel/l1-intent/external-service.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoContext } from '../src/surface/demo-context.js';
import { defineConnector } from '../src/kernel/l2-plan/connector-profile.js';

// ── ① 있으면 있다, 없으면 없다 ────────────────────────────────────────────
test('폴더·파일·앱: 존재하는 것만 found 다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'signs-'));
  await mkdir(join(dir, 'GoogleDrive-someone'), { recursive: true });
  assert.equal((await checkSign({ kind: 'dir', paths: [join(dir, 'GoogleDrive-*')], label: 'x' })).found, true);
  assert.equal((await checkSign({ kind: 'dir', paths: [join(dir, '없는폴더')], label: 'x' })).found, false);
  await writeFile(join(dir, 'auth.json'), '{}');
  const f = await checkSign({ kind: 'file', paths: [join(dir, 'auth.json')], label: 'x' });
  assert.equal(f.found, true);
  assert.ok(f.where, '어디서 찾았는지도 사실이다');
});

test('cli: 있는 명령과 없는 명령을 가른다', async () => {
  assert.equal((await checkSign({ kind: 'cli', command: 'ls', label: 'x' })).found, true);
  assert.equal((await checkSign({ kind: 'cli', command: '없는명령어xyz', label: 'x' })).found, false);
});

test('mcp: 설정의 서버 이름 키로 찾고, 설정이 없으면 조용히 없음이다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'signs-mcp-'));
  const cfg = join(dir, 'config.json');
  await writeFile(cfg, JSON.stringify({ mcpServers: { 'notion-mcp': { command: 'x', env: { SECRET: '비밀값123' } } } }));
  const hit = await checkSign({ kind: 'mcp', server: 'notion', label: 'x' }, { mcpConfigPaths: [cfg] });
  assert.equal(hit.found, true);
  const miss = await checkSign({ kind: 'mcp', server: 'linear', label: 'x' }, { mcpConfigPaths: [cfg] });
  assert.equal(miss.found, false);
  const none = await checkSign({ kind: 'mcp', server: 'notion', label: 'x' }, { mcpConfigPaths: [join(dir, '없음.json')] });
  assert.equal(none.found, false, '설정이 없으면 없는 것 — 지어내지 않는다');
});

// ── ④ 비밀 경계 ───────────────────────────────────────────────────────────
test('mcp 확인 결과에 설정의 값(명령·env·토큰)이 실리지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'signs-secret-'));
  const cfg = join(dir, 'config.json');
  await writeFile(cfg, JSON.stringify({ mcpServers: { gmail: { command: 'node x.js', env: { TOKEN: '비밀토큰XYZ' } } } }));
  const r = await checkSign({ kind: 'mcp', server: 'gmail', label: 'x' }, { mcpConfigPaths: [cfg] });
  assert.equal(r.found, true);
  assert.doesNotMatch(JSON.stringify(r), /비밀토큰XYZ|node x\.js/, '이름 키만 — 값은 버린다');
});

// ── ② 러너는 서비스를 모른다 ──────────────────────────────────────────────
test('지어낸 서비스도 같은 종류 선언이면 그대로 돈다(서비스 분기 없음)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'signs-any-'));
  await mkdir(join(dir, '가상서비스폴더'));
  const c = defineConnector({
    id: 'imaginary', label: '가상서비스', connected: false, userJobs: ['뭔가 한다'],
    localSigns: [{ kind: 'dir', paths: [join(dir, '가상서비스폴더')], label: '가상서비스 폴더' }],
  });
  await checkConnectorSigns([c], { now: () => 123 });
  assert.equal(c.localSignsResult[0].found, true);
  assert.equal(c.lastCheckedAt, 123, '확인 시각이 근거로 남는다');
});

test('흔적을 선언하지 않은 커넥터는 건드리지 않는다(확인한 척 금지)', async () => {
  const c = defineConnector({ id: 'plain', label: '무선언', connected: false });
  await checkConnectorSigns([c]);
  assert.equal(c.localSignsResult, undefined);
  assert.equal(c.lastCheckedAt, undefined);
});

// ── ③·⑤ 확인 결과의 도달 — 그리고 확인 전에는 그 줄이 없다 ────────────────
function 프롬프트로(connectors) {
  const c = demoContext();
  const selfState = buildSelfState(c.env, { tools: c.tools });
  const tc = buildTaskContext({
    intent: { currentRequest: '구글 볼 수 있어?', answerMode: 'complex_work' },
    selfState,
    externalReality: externalReality({ connectors, selfState }),
  });
  return JSON.stringify(buildModelMessages(tc));
}

test('확인 결과가 프롬프트 문자열까지 도달한다(있음·없음 둘 다 사실)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'signs-reach-'));
  await mkdir(join(dir, 'DriveSync'));
  const c = defineConnector({
    id: 'svc', label: '가상드라이브', connected: false, userJobs: ['자료를 본다'],
    localSigns: [
      { kind: 'dir', paths: [join(dir, 'DriveSync')], label: '동기화 폴더' },
      { kind: 'dir', paths: [join(dir, '없음')], label: '데스크톱 앱' },
    ],
  });
  await checkConnectorSigns([c], { now: () => 1 });
  const 전문 = 프롬프트로([c]);
  assert.match(전문, /직접 확인함/, 'T5 가 확인했다는 사실');
  assert.match(전문, /동기화 폴더 있음/, '있는 것');
  assert.match(전문, /데스크톱 앱 없음/, '없는 것도 사실이다');
});

test('확인 전에는 "직접 확인함" 줄 자체가 없다', () => {
  const c = defineConnector({
    id: 'svc2', label: '미확인서비스', connected: false, userJobs: ['x'],
    localSigns: [{ kind: 'cli', command: 'ls', label: 'CLI' }],
  });
  // checkConnectorSigns 를 **부르지 않았다** — 결과가 없으니 확인 문구도 없어야 한다.
  assert.doesNotMatch(프롬프트로([c]), /직접 확인함/, '확인 안 한 것을 확인했다고 말하면 안 된다');
});

test('serviceStatus 는 결과 없는 커넥터에 localSigns 필드를 만들지 않는다', () => {
  const c = demoContext();
  const selfState = buildSelfState(c.env, { tools: c.tools });
  const 미확인 = defineConnector({ id: 'x', label: 'X', connected: false, localSigns: [{ kind: 'cli', command: 'ls', label: 'c' }] });
  const s = serviceStatus([미확인], selfState)[0];
  assert.equal(s.localSigns, undefined);
  assert.equal(s.lastCheckedAt, undefined);
});

// ── 재확인: 신선도 기준, 낡은 것만 (오너 승인 설계) ───────────────────────
import { refreshStaleSigns } from '../src/runtime/local-signs.js';

test('낡은 커넥터만 다시 확인하고, 신선한 것은 건드리지 않는다', async () => {
  const 낡음 = defineConnector({ id: 'a', label: 'A', connected: false, localSigns: [{ kind: 'cli', command: 'ls', label: 'c' }] });
  const 신선 = defineConnector({ id: 'b', label: 'B', connected: false, localSigns: [{ kind: 'cli', command: 'ls', label: 'c' }] });
  낡음.lastCheckedAt = 1000; 신선.lastCheckedAt = 9000;
  const n = await refreshStaleSigns([낡음, 신선], { now: () => 10000, ttlMs: 5000 });
  assert.equal(n, 1, '낡은 것 하나만');
  assert.equal(낡음.lastCheckedAt, 10000, '재확인되면 시각이 갱신된다');
  assert.equal(신선.lastCheckedAt, 9000, '신선한 것은 그대로 — 매 턴 전부 돌리지 않는다');
});

test('한 번도 확인 안 된 것은 낡은 것으로 본다', async () => {
  const c = defineConnector({ id: 'c', label: 'C', connected: false, localSigns: [{ kind: 'cli', command: 'ls', label: 'c' }] });
  await refreshStaleSigns([c], { now: () => 10000, ttlMs: 5000 });
  assert.equal(c.lastCheckedAt, 10000);
  assert.ok(c.localSignsResult.length);
});

test('흔적 무선언 커넥터는 재확인 대상이 아니다', async () => {
  const c = defineConnector({ id: 'd', label: 'D', connected: false });
  const n = await refreshStaleSigns([c], { now: () => 10000, ttlMs: 5000 });
  assert.equal(n, 0);
  assert.equal(c.lastCheckedAt, undefined);
});
