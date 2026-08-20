import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadCapabilityCatalog, makeCapabilityCatalogTool } from '../src/capability-catalog.js';

const asana = {
  schema: 't5.capability-manifest.v1', id: 'asana', label: 'Asana', category: 'project_management',
  description: 'Asana 프로젝트, 작업, 담당자, 마감일을 읽고 관리하는 공식 MCP 후보',
  terms: ['아사나', 'asana', 'app.asana.com', '프로젝트', '작업', '할 일', '마감일'],
  capabilities: { search: true, read: true, create: true, update: true },
  route: {
    kind: 'remote_mcp', endpoint: 'https://mcp.asana.com/v2/mcp',
    sourceUrl: 'https://developers.asana.com/docs/integrating-with-asanas-mcp-server',
    preparation: 'product_registration_required', canStart: false,
    userSafeSummary: 'Asana 공식 연결 후보가 있지만 T5 제품용 MCP 앱 등록이 먼저 필요해요.',
  },
};

async function manifest(root, name, value) {
  const directory = join(root, name); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'capability.json'), JSON.stringify(value), 'utf8');
}

test('trusted capability catalog는 manifest metadata만 읽고 잘못된 출처·root 이탈을 제외한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-capability-catalog-'));
  const root = join(room, 'catalog'); await mkdir(root);
  try {
    await manifest(root, 'asana', asana);
    await manifest(root, 'bad-http', {
      ...asana, id: 'bad-http', label: 'Bad', route: { ...asana.route, sourceUrl: 'http://bad.example' },
    });
    const outside = join(room, 'outside'); await manifest(outside, 'escape', { ...asana, id: 'escape' });
    await symlink(join(outside, 'escape'), join(root, 'escape'));
    const catalog = await loadCapabilityCatalog({ directory: root });
    assert.deepEqual(catalog.entries.map((entry) => entry.id), ['asana']);
    assert.deepEqual(new Set(catalog.rejected.map((entry) => entry.reason)), new Set([
      'invalid_manifest', 'outside_catalog_root',
    ]));
    assert.doesNotMatch(JSON.stringify(catalog.entries), /client_secret|access_token/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('모델은 브랜드명·URL·업무 목적 표현으로 같은 후보를 찾고 exact blocker를 inspect한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-capability-search-'));
  try {
    await manifest(room, 'asana', asana);
    const snapshot = await loadCapabilityCatalog({ directory: room });
    const tool = makeCapabilityCatalogTool({ snapshot, connectionDoctor: { inspect: async () => ({ connections: [] }) } });
    for (const query of ['아사나 오늘 업무', 'https://app.asana.com/0/example/list', '프로젝트 마감일과 담당자']) {
      const found = await tool.execute({ action: 'search', query, id: null });
      assert.equal(found.candidates[0].id, 'asana');
      assert.equal(found.candidates[0].state, 'candidate');
      assert.equal(found.candidates[0].canStart, false);
    }
    const inspected = await tool.execute({ action: 'inspect', query: null, id: 'asana' });
    assert.equal(inspected.candidate.preparation, 'product_registration_required');
    assert.equal(inspected.candidate.endpoint, 'https://mcp.asana.com/v2/mcp');
    assert.doesNotMatch(JSON.stringify(tool.parameters), /endpoint|sourceUrl|terms/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('같은 id의 실제 connection이 있으면 후보보다 현재 connected·ready 진실이 우선한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-capability-current-'));
  try {
    await manifest(room, 'asana', asana);
    const snapshot = await loadCapabilityCatalog({ directory: room });
    const tool = makeCapabilityCatalogTool({
      snapshot,
      connectionDoctor: { inspect: async () => ({ connections: [{
        id: 'asana', state: 'connected', userSafeSummary: 'Asana에 연결되어 있어요.',
        capabilities: { search: true, read: true }, routes: [], actions: [],
      }] }) },
    });
    const result = await tool.execute({ action: 'inspect', query: null, id: 'asana' });
    assert.equal(result.candidate.state, 'connected');
    assert.equal(result.candidate.userSafeSummary, 'Asana에 연결되어 있어요.');
    assert.equal(result.candidate.canStart, false);
  } finally { await rm(room, { recursive: true, force: true }); }
});
