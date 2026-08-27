import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('소유권 표면은 로컬 상태·모델 전환·연결·백업·삭제 범위를 한 사용자 진실로 모은다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-alpha6-ownership-')); const stopReasons = [];
  const continuityReceipt = {
    schema: 't5.model-continuity-receipt.v1',
    from: { id: 'primary', provider: 'openai', modelId: 'gpt', wire: 'responses' },
    to: { id: 'fallback', provider: 'anthropic', modelId: 'claude', wire: 'messages' },
    reason: 'transport_failure', requiredCapabilities: ['text'],
    stateSource: 'canonical_t5_messages_and_tool_receipts', providerRawTranscriptUsed: false,
    priorToolEffectsReexecutionAuthorized: false,
  };
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace: room,
    modelStatus: async () => ({ connected: true, provider: 'openai', modelId: 'gpt',
      continuityPolicy: { enabled: true, allowedConnectionIds: ['primary', 'fallback'] },
      connections: [] }),
    modelFactory: () => ({ async respond() { return { text: '이어갔어요.', toolCalls: [], continuityReceipt }; } }),
    workspaceConnectionInspectors: [{ id: 'local-sync-files', label: '동기화 폴더', category: 'local_file',
      inspect: async () => ({ state: 'ready', userSafeSummary: '이 컴퓨터 파일을 사용할 수 있어요.',
        capabilities: { read: true }, routes: [] }) }],
    requestRuntimeStop: async (reason) => { stopReasons.push(reason); },
  });
  const base = await listen(server);
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '계속해' }) });
    const ownership = await fetch(`${base}/ownership`).then((response) => response.json());
    assert.equal(ownership.schema, 't5.local-ownership-surface.v1');
    assert.equal(ownership.runtime.uiIndependent, true);
    assert.equal(ownership.localState.storedOnThisComputer, true);
    assert.equal(ownership.model.recentContinuity.canonicalStateUsed, true);
    assert.equal(ownership.model.recentContinuity.priorEffectsReexecutionAuthorized, false);
    assert.equal('id' in ownership.model.recentContinuity.from, false);
    assert.equal(ownership.backup.secretValuesExcluded, true);
    assert.deepEqual(ownership.deletion, {
      localManagedStateOnly: true, externalServiceCopiesDeleted: false,
      separateBackupFilesDeleted: false, userConfirmationRequired: true,
    });
    assert.doesNotMatch(JSON.stringify(ownership), /\/Users\/|oauth|refresh_token|api[_-]?key/iu);

    const refused = await fetch(`${base}/ownership/delete-local`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
    assert.equal(refused.status, 400); assert.deepEqual(stopReasons, []);
    const accepted = await fetch(`${base}/ownership/delete-local`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        confirm: true, externalCopiesRemain: true, backupsRemain: true,
      }) });
    assert.equal(accepted.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(stopReasons, ['user_delete_local_state']);
  } finally {
    server.closeWakeStreams(); await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});

test('소유권 UX는 기술 원장 대신 내 자료 위치·전송·백업·삭제의 정확한 범위를 보여준다', async () => {
  const ui = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
  const launcher = await readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8');
  assert.match(ui, /내 T5와 자료/u);
  assert.match(ui, /외부 서비스 사본과 별도로 보관한 백업 파일은 지우지 않아요/u);
  assert.match(ui, /답 품질 때문에 모델을 자동 순회하지 않아요/u);
  assert.match(ui, /\/ownership\/delete-local/u);
  assert.match(launcher, /reason === 'user_delete_local_state'[\s\S]*rm\(stateDir/u);
});
