// H09 · 탐색 손의 정직 — **읽지 못한 자리를 "확인했다"고 말하지 않는다.**
//
// 수정 전 실측: 모든 자리의 readdir 이 권한 거부(EACCES)로 떨어져도 local-discovery 는
// checked: [일곱 자리 전부] 를 내고 "확인했지만 맞는 연결 단서는 없음"이라고 말했다 —
// 한 곳도 못 봤는데 다 봤다는 거짓 성공이다(H09 1회차 인간 실패와 같은 모양).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLocalDiscoveryTool } from '../src/runtime/local-discovery.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';

const 거부 = async () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); };

test('모든 자리가 읽기 거부면 "확인했다"가 아니라 "못 봤다"가 사실로 남는다', async () => {
  const tool = makeLocalDiscoveryTool({
    mcpNames: async () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); },
    pathDirs: ['/막힌자리'], readdirImpl: 거부,
    appDirs: ['/막힌앱'], syncDirs: ['/막힌동기화'], settingsDirs: ['/막힌설정'], fileRoots: ['/막힌파일'],
    connectors: () => [],
  });
  const r = await tool.handler({ subject: 'cafe24' });
  const d = r.connectionDiscovery;
  // 못 본 자리가 checked 에 남으면 그게 거짓 성공이다.
  for (const 자리 of ['cli', 'apps', 'sync_folders', 'settings_names', 'local_files', 'mcp']) {
    assert.ok(!d.checked.includes(자리), `읽지 못한 ${자리} 가 "확인했다"에 남았다: ${JSON.stringify(d.checked)}`);
  }
  assert.ok((d.unchecked ?? []).length >= 5, `못 본 자리가 사실로 남지 않았다: ${JSON.stringify(d.unchecked)}`);
  // 사용자 문장도 같은 사실이어야 한다(원장과 답 일치).
  assert.doesNotMatch(r.userSafeSummary, /^바로 쓸 연결 단서는 아직 찾지 못했어요\.$/, '못 본 것을 "없다"로 말했다');
  assert.match(r.userSafeSummary, /못 봤|읽지 못|확인하지 못/, '못 봤다는 사실이 사용자 문장에 없다');
  // 진단 원문(EACCES·경로)은 새지 않는다.
  assert.doesNotMatch(JSON.stringify(r), /EACCES|막힌자리/, '진단면·경로가 결과에 샜다');
});

test('일부만 막혔으면 본 곳은 checked, 못 본 곳은 unchecked 로 갈라 남는다', async () => {
  const readdirImpl = async (dir, opts) => {
    if (dir === '/열린앱') return [{ name: 'Cafe24.app', isDirectory: () => false }];
    throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  };
  const tool = makeLocalDiscoveryTool({
    mcpNames: async () => [], pathDirs: [], connectors: () => [],
    appDirs: ['/열린앱'], syncDirs: ['/막힌동기화'], settingsDirs: [], fileRoots: [],
    readdirImpl,
  });
  const r = await tool.handler({ subject: 'cafe24' });
  const d = r.connectionDiscovery;
  assert.ok(d.checked.includes('apps'), '실제로 본 자리가 checked 에서 빠졌다');
  assert.ok(d.unchecked?.includes('sync_folders'), '못 본 자리가 unchecked 에 없다');
  assert.ok(d.candidates.some((c) => c.kind === 'app'), '본 곳의 진짜 단서까지 사라졌다');
});

test('없는 폴더(ENOENT)는 "못 봤다"가 아니라 "없다"다 — checked 로 남는다', async () => {
  const readdirImpl = async () => { throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }); };
  const tool = makeLocalDiscoveryTool({
    mcpNames: async () => [], pathDirs: [], connectors: () => [],
    appDirs: ['/없는앱자리'], syncDirs: [], settingsDirs: [], fileRoots: [],
    readdirImpl,
  });
  const r = await tool.handler({ subject: 'cafe24' });
  assert.ok(r.connectionDiscovery.checked.includes('apps'), '없는 폴더를 "못 봤다"로 과장했다');
  assert.ok(!(r.connectionDiscovery.unchecked ?? []).includes('apps'));
});

test('다음 턴으로 이어지는 요약(subjectOf)도 같은 사실을 말한다', async () => {
  const tool = makeLocalDiscoveryTool({
    mcpNames: async () => [], pathDirs: ['/막힌자리'], readdirImpl: 거부,
    appDirs: [], syncDirs: [], settingsDirs: [], fileRoots: [],
    connectors: () => [],
  });
  const runner = new ToolRunner({ discovery: tool });
  const rec = await runner.run('discovery', { subject: '낯선서비스' }, {
    connectedTools: [{ id: 'discovery', executable: true }],
  });
  assert.equal(rec.failureState, 'none', '부분 실패가 전체 실패로 번졌다');
  assert.ok(!rec.connectionDiscovery.checked.includes('cli'), '요약 계약에도 못 본 자리가 확인됨으로 남았다');
  assert.match(rec.subject?.detail ?? '', /못 봤|읽지 못/, '다음 턴 요약에 못 본 사실이 없다');
});

test('모든 자리를 정상으로 읽으면 기존 계약 그대로다(회귀 방지)', async () => {
  const tool = makeLocalDiscoveryTool({
    mcpNames: async () => [], pathDirs: [], connectors: () => [],
    appDirs: [], syncDirs: [], settingsDirs: [], fileRoots: [], // 실제 사용자 폴더는 밟지 않는다
  });
  const runner = new ToolRunner({ discovery: tool });
  const rec = await runner.run('discovery', { subject: '낯선서비스' }, {
    connectedTools: [{ id: 'discovery', executable: true }],
  });
  assert.deepEqual(rec.connectionDiscovery.checked,
    ['mcp', 'cli', 'known_connectors', 'apps', 'sync_folders', 'settings_names', 'local_files']);
  assert.equal(rec.connectionDiscovery.unchecked, undefined, '다 봤는데 unchecked 필드가 생겼다');
});
