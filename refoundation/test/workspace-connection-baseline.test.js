import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { workspaceConnectionBaselineInspectors } from '../src/workspace-connection-baseline.js';
import { makeConnectionDoctor } from '../src/connection-truth.js';

test('Google·Notion은 전용 연결이 없다는 사실과 지금 가능한 경로를 구분한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-workspace-baseline-'));
  try {
    const doctor = makeConnectionDoctor({ inspectors: workspaceConnectionBaselineInspectors({
      userHome: room, platform: 'darwin', browserAvailable: true,
    }) });
    const report = await doctor.inspect();
    const google = report.connections.find((item) => item.id === 'google-workspace');
    const notion = report.connections.find((item) => item.id === 'notion');
    assert.equal(google.state, 'needs_connection');
    assert.equal(notion.state, 'needs_connection');
    assert.match(google.userSafeSummary, /전용 연결은 아직 없/u);
    assert.match(notion.userSafeSummary, /원격 연결은 아직 없/u);
    assert.deepEqual(google.routes.map(({ kind, state }) => ({ kind, state })), [
      { kind: 'official', state: 'unavailable' },
      { kind: 'browser', state: 'ready' },
    ]);
    assert.equal(Object.values(google.capabilities).some(Boolean), false);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('실제 Google Drive 동기화 폴더가 있으면 전용 API 연결과 섞지 않고 로컬 자료 경로만 사용 가능으로 올린다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-workspace-google-sync-'));
  try {
    await mkdir(join(room, 'Library', 'CloudStorage', 'GoogleDrive-example@domain.test'), { recursive: true });
    const doctor = makeConnectionDoctor({ inspectors: workspaceConnectionBaselineInspectors({
      userHome: room, platform: 'darwin', browserAvailable: true,
    }) });
    const google = (await doctor.inspect()).connections.find((item) => item.id === 'google-workspace');
    assert.equal(google.state, 'ready');
    assert.equal(google.capabilities.search, true);
    assert.equal(google.capabilities.read, true);
    assert.equal(google.capabilities.update, false);
    assert.equal(google.routes.some((route) => route.kind === 'local_sync' && route.state === 'ready'), true);
    assert.equal(google.routes.find((route) => route.kind === 'official').state, 'unavailable');
  } finally { await rm(room, { recursive: true, force: true }); }
});
