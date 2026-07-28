import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLocalDiscoveryTool } from '../src/runtime/local-discovery.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';

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
  const tool = makeLocalDiscoveryTool({ mcpNames: async () => [], pathDirs: [], connectors: () => [] });
  const r = await tool.handler({ subject: '낯선서비스' });
  assert.deepEqual(r.result.candidates, []);
  assert.match(r.userSafeSummary, /단서/);
});

test('선언된 연결 상태도 후보 근거로 쓰되 연결 성공으로 바꾸지 않는다', async () => {
  const tool = makeLocalDiscoveryTool({
    mcpNames: async () => [], pathDirs: [],
    connectors: () => [{ id: 'store', label: '가게도구', aliases: ['가게'], connected: false }],
  });
  const r = await tool.handler({ subject: '가게' });
  assert.deepEqual(r.result.candidates, [{ kind: 'connector', label: '가게도구', evidence: 'T5에 연결 선언은 있지만 현재 직접 연결은 아니에요' }]);
});

test('실행 원장은 연결 탐색 계약을 버리지 않고 다음 판단까지 보낸다', async () => {
  const tool = makeLocalDiscoveryTool({ mcpNames: async () => [], pathDirs: [], connectors: () => [] });
  const runner = new ToolRunner({ discovery: tool });
  const rec = await runner.run('discovery', { subject: '낯선서비스' }, {
    connectedTools: [{ id: 'discovery', executable: true }],
  });
  assert.equal(rec.failureState, 'none');
  assert.deepEqual(rec.connectionDiscovery, {
    subject: '낯선서비스', checked: ['mcp', 'cli', 'known_connectors'], candidates: [],
    // 확인 범위와 연결 선언 여부도 같은 계약으로 실려 간다 — "못 찾음"과 "없음"을 가르는 사실.
    scope: 'this_computer', declared: false,
  });
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
  assert.match(m.user, /이 컴퓨터 안만 본 것/, '확인 범위가 모델에 안 간다');
  assert.match(m.user, /연결 선언이 아직 없어요/, '열릴 수 없는 면이라는 사실이 안 간다');

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
