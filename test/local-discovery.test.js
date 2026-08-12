import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLocalDiscoveryTool } from '../src/runtime/local-discovery.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { join } from 'node:path';

test('미선언 대상도 MCP·CLI 이름 근거로 후보를 돌려준다', async () => {
  const tool = makeLocalDiscoveryTool({
    mcpNames: async () => [{ name: 'cafe24-mcp', where: '/secret/config' }],
    pathDirs: [],
    connectors: () => [],
  });
  const r = await tool.handler({ subject: 'cafe24' });
  assert.deepEqual(r.result.candidates, [{ kind: 'mcp', label: 'cafe24-mcp', evidence: 'MCP 등록 이름이 요청과 맞아요' }]);
  assert.deepEqual(r.connectionDiscovery.candidates, r.result.candidates, '다음 판단에 넘기는 계약도 같은 안전한 후보여야 한다');
  assert.doesNotMatch(JSON.stringify(r), /secret\/config/, '설정 위치나 값은 후보에 새면 안 된다');
});

test('후보 없음은 연결 불가능이라는 거짓 결론이 아니라 빈 탐색 결과다', async () => {
  const tool = makeLocalDiscoveryTool({
    mcpNames: async () => [], pathDirs: [], connectors: () => [],
    appDirs: [], syncDirs: [], settingsDirs: [], fileRoots: [],
  });
  const r = await tool.handler({ subject: '낯선서비스' });
  assert.deepEqual(r.result.candidates, []);
  assert.match(r.userSafeSummary, /단서/);
});

test('선언된 연결 상태도 후보 근거로 쓰되 연결 성공으로 바꾸지 않는다', async () => {
  const tool = makeLocalDiscoveryTool({
    mcpNames: async () => [], pathDirs: [], appDirs: [], syncDirs: [], settingsDirs: [], fileRoots: [],
    connectors: () => [{ id: 'store', label: '가게도구', aliases: ['가게'], connected: false }],
  });
  const r = await tool.handler({ subject: '가게' });
  assert.deepEqual(r.result.candidates, [{ kind: 'connector', label: '가게도구', evidence: 'T5에 연결 선언은 있지만 현재 직접 연결은 아니에요' }]);
});

test('앱·동기화 폴더·설정 이름·기존 파일도 값 없이 공통 연결 단서가 된다', async () => {
  const dirs = {
    '/apps': ['Cafe24.app'],
    '/sync': ['cafe24-drive'],
    '/settings': ['cafe24-config'],
    '/files': ['cafe24-orders.csv'],
  };
  const readdirImpl = async (dir) => (dirs[dir] ?? []).map((name) => ({
    name,
    isDirectory: () => false,
  }));
  const tool = makeLocalDiscoveryTool({
    mcpNames: async () => [], pathDirs: [], connectors: () => [],
    appDirs: ['/apps'], syncDirs: ['/sync'], settingsDirs: ['/settings'], fileRoots: ['/files'],
    readdirImpl,
  });
  const r = await tool.handler({ subject: 'cafe24' });
  assert.deepEqual(r.connectionDiscovery.candidates.map((c) => c.kind), ['app', 'sync_folder', 'settings_trace', 'local_file']);
  assert.doesNotMatch(JSON.stringify(r), /\/apps|\/sync|\/settings|\/files/, '경로·설정값은 후보에 싣지 않는다');
});

test('실행 원장은 연결 탐색 계약을 버리지 않고 다음 판단까지 보낸다', async () => {
  const tool = makeLocalDiscoveryTool({ mcpNames: async () => [], pathDirs: [], connectors: () => [] });
  const runner = new ToolRunner({ discovery: tool });
  const rec = await runner.run('discovery', { subject: '낯선서비스' }, {
    connectedTools: [{ id: 'discovery', executable: true }],
  });
  assert.equal(rec.failureState, 'none');
  assert.deepEqual(rec.connectionDiscovery, {
    // **`settings_names` 가 빠졌다**(2026-08-07 · 루트를 홈으로 넓히며 숨김 자리를 닫았다).
    // 그 축이 훑던 `~/.config` 는 자격증명이 사는 자리라 보호가 이긴다 — 그래서 못 본 것을
    // **못 봤다고 적는다**(H09 규율: 빈 측정을 긍정 증거로 세우지 않는다). 아래 `unchecked` 로 간다.
    subject: '낯선서비스', checked: ['mcp', 'cli', 'known_connectors', 'apps', 'sync_folders', 'local_files'], candidates: [],
    // **못 본 자리를 못 봤다고 적는다.** 이 칸이 비면 위 `checked` 여섯이 전부인 줄 읽힌다.
    unchecked: ['settings_names'],
    // 확인 범위와 연결 선언 여부도 같은 계약으로 실려 간다 — "못 찾음"과 "없음"을 가르는 사실.
    scope: 'this_computer', declared: false,
  });
  // **못 본 자리를 말로도 밝힌다** — 이 괄호가 없으면 "없음"이 "다 봤는데 없음"으로 읽힌다.
  assert.equal(rec.subject?.detail, 'mcp · cli · known_connectors · apps · sync_folders · local_files을 확인했지만 맞는 연결 단서는 없음 (settings_names은 읽지 못해 못 봤음)');
});

// 실측(감사 2026-07-28): `듣도보도못한상점ABC` 에 `bc(cli)`·`ab(cli)` 가 단서로 나왔다.
// 둘 다 실제로 설치된 명령이라(계산기·apache bench) 짧은 이름이 아무 말 안에나 들어간다.
// `abc마켓` 도 같은 둘을 냈다. 모델은 그걸 "기존 연결 단서를 찾았어요"로 읽는다 —
// 오탐이 아니라 **거짓 현실**이다(없는 연결을 사실로 주는 것).
test('짧은 명령 이름이 아무 말 안에 들어가서 단서가 되지 않는다', async () => {
  const { mkdtemp, writeFile, chmod } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const 명령자리 = await mkdtemp(join(tmpdir(), 't5-cmds-'));
  for (const 이름 of ['bc', 'ab', 'ex', 'id', 'notion-cli']) {
    await writeFile(join(명령자리, 이름), '#!/bin/sh\n');
    await chmod(join(명령자리, 이름), 0o755);
  }
  const 손 = makeLocalDiscoveryTool({ connectors: () => [], mcpNames: async () => [], pathDirs: [명령자리] });

  for (const 말 of ['듣도보도못한상점ABC', 'abc마켓', '우리동네떡볶이', 'ZZZ가게']) {
    const c = (await 손.handler({ subject: 말 })).result?.candidates ?? [];
    assert.equal(c.length, 0, `"${말}" 에 거짓 단서가 나왔다: ${c.map((x) => x.label).join(',')}`);
  }
  // 막기만 하면 도구가 아니다 — 근거가 될 만큼 겹치면 그대로 단서다
  const 진짜 = (await 손.handler({ subject: 'notion' })).result?.candidates ?? [];
  assert.ok(진짜.some((x) => x.label === 'notion-cli'), '진짜 단서까지 사라졌다');
});

// 실측(오너 라이브 2026-07-28, C 시나리오 — "카페24 주문 가져와줘"):
// T5 는 이 컴퓨터 안을 다섯 번 뒤졌고(단서 찾기·파일 찾기 2회·터미널·파일 읽기) 못 찾자
//   "가장 빠른 길: 관리자에서 CSV 로 내려받아 주면 제가 정리할게요"
//   "자동으로 가져오는 길: … 안전 입력면이 열려야 합니다"
// 라고 답했다. 앞은 **일을 사용자에게 넘긴 것**이고, 뒤는 **열릴 수 없는 면을 약속한 것**이다
// (선언되지 않은 대상은 비밀 입력면이 열리지 않는다).
//
// "못 찾음"과 "없음"은 다른 사실이다. 그 차이를 사실로 준다 — 어느 길로 가라고는 말하지 않는다.
test('못 찾았을 때 확인 범위와 연결 선언 여부를 사실로 남긴다', async () => {
  const tool = makeLocalDiscoveryTool({
    mcpNames: async () => [], pathDirs: [], connectors: () => [],
  });
  const r = await tool.handler({ subject: '듣도보도못한상점ABC' });
  assert.equal(r.connectionDiscovery.candidates.length, 0);
  assert.equal(r.connectionDiscovery.scope, 'this_computer', '어디까지 봤는지가 없다');
  assert.equal(r.connectionDiscovery.declared, false, '연결 선언 여부가 없다');
});

test('연결 선언이 있으면 declared 가 사실대로 선다', async () => {
  const tool = makeLocalDiscoveryTool({
    mcpNames: async () => [], pathDirs: [],
    connectors: () => [{ id: 'somewhere', label: '어딘가', connected: false }],
  });
  const r = await tool.handler({ subject: '어딘가' });
  assert.equal(r.connectionDiscovery.declared, true);
});

test('두 사실이 모델 입력까지 간다 — 없는 입력면을 약속하지 않게', async () => {
  const { buildModelMessages } = await import('../src/runtime/model-provider.js');
  const 기본 = { currentRequest: '가져와줘', selfStateFacts: {}, authorityFacts: {} };
  const m = buildModelMessages({
    ...기본,
    connectionAdmission: {
      secretInput: null,
      discovery: { subject: '어떤상점', checked: ['mcp', 'cli'], candidates: [], scope: 'this_computer', declared: false },
    },
  });
  assert.match(m.system, /이 컴퓨터 안만 본 것/, '확인 범위가 모델에 안 간다');
  assert.match(m.system, /연결 선언이 아직 없어요/, '열릴 수 없는 면이라는 사실이 안 간다');

  // 선언이 있으면 그 말은 하지 않는다(없는 벽을 세우지 않는다)
  const 있을때 = buildModelMessages({
    ...기본,
    connectionAdmission: {
      secretInput: null,
      discovery: { subject: '어딘가', checked: ['mcp'], candidates: [{ kind: 'connector', label: '어딘가' }], scope: 'this_computer', declared: true },
    },
  });
  assert.ok(!/연결 선언이 아직 없어요/.test(있을때.user));
});

// ── C 감사 F7.4★ · discovery 는 제2의 읽기 손이 아니어야 한다 ────────────
// 실측(감사 2026-08-01): local-discovery 는 file-scope 도 local-protection 도 쓰지 않아
// local.file 이 막힌 자리를 그대로 훑고, 최상위 닷파일 이름을 후보로 낼 수 있었다.
test('F7.4: 보호 이름이 걸린 자리는 읽지 않고 "못 본 곳"으로 남긴다(없는 곳과 구분)', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const 부모 = await mkdtemp(join(tmpdir(), 'gpao-t5-disc-'));
  // 폴더 이름 자체가 비밀 규칙에 걸린다(auth-secrets) — 같은 판정을 discovery 도 써야 한다.
  const 비밀자리 = join(부모, 'auth-secrets');
  await mkdir(비밀자리, { recursive: true });
  await writeFile(join(비밀자리, '정산-연결.txt'), 'x');
  const tool = makeLocalDiscoveryTool({
    mcpNames: async () => [], pathDirs: [], appDirs: [], syncDirs: [], settingsDirs: [비밀자리], fileRoots: [],
  });
  const r = await tool.handler({ subject: '정산' });
  assert.ok(!r.result.candidates.some((c) => c.label.includes('정산-연결')),
    '보호 자리 안의 이름이 후보로 나갔다 — 파일 손이 막는 자리를 discovery 가 우회한다');
  assert.ok((r.result.unchecked ?? []).includes('settings_names'),
    `보호로 못 본 자리가 "확인했지만 없음"으로 뭉개졌다: ${JSON.stringify(r.result)}`);
});

test('F7.4: 이름이 비밀 규칙에 걸리는 항목은 후보로 올리지 않는다', async () => {
  const { mkdtemp, mkdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-disc2-'));
  await mkdir(join(dir, '정산자료-token'), { recursive: true });
  await mkdir(join(dir, '정산자료-도구'), { recursive: true });
  const tool = makeLocalDiscoveryTool({
    mcpNames: async () => [], pathDirs: [], appDirs: [], syncDirs: [], settingsDirs: [dir], fileRoots: [],
  });
  const r = await tool.handler({ subject: '정산자료' });
  assert.ok(!r.result.candidates.some((c) => c.label === '정산자료-token'), '비밀 이름이 후보로 나갔다');
  assert.ok(r.result.candidates.some((c) => c.label === '정산자료-도구'), '평범한 이름까지 막았다 — 과잉 차단');
});

test('F7.4: 파일 루트의 닷파일은 후보로 내지 않는다', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-disc3-'));
  await writeFile(join(dir, '.정산자료환경'), 'x');
  await writeFile(join(dir, '정산자료.csv'), 'x');
  const tool = makeLocalDiscoveryTool({
    mcpNames: async () => [], pathDirs: [], appDirs: [], syncDirs: [], settingsDirs: [], fileRoots: [dir],
  });
  const r = await tool.handler({ subject: '정산자료' });
  assert.ok(!r.result.candidates.some((c) => c.label === '.정산자료환경'), '숨은 파일 이름이 후보로 나갔다');
  assert.ok(r.result.candidates.some((c) => c.label === '정산자료.csv'));
});

test('F7.4: 파일 탐색 루트는 파일 손과 같은 진실(file-scope)에서 나온다', async () => {
  const { defaultFileRoots } = await import('../src/runtime/file-scope.js');
  const { discoveryFileRoots } = await import('../src/runtime/local-discovery.js');
  // 같은 계약을 쓰는지 — 두 손이 서로 다른 루트 진실을 갖지 않는다(두 진실 금지).
  assert.deepEqual(discoveryFileRoots(), defaultFileRoots(),
    'discovery 의 파일 루트가 file-scope 와 다른 곳을 본다 — 제2 읽기 손이 된다');
});
