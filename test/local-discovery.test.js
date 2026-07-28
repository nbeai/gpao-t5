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
    subject: '낯선서비스', checked: ['mcp', 'cli', 'known_connectors', 'apps', 'sync_folders', 'settings_names', 'local_files'], candidates: [],
  });
  assert.equal(rec.subject?.detail, 'mcp · cli · known_connectors · apps · sync_folders · settings_names · local_files을 확인했지만 맞는 연결 단서는 없음');
});
