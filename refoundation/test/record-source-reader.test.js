import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ConversationLedger } from '../src/conversation-ledger.js';
import { makeRecordReference } from '../src/record-reference.js';
import { projectConversationRecordReference } from '../src/record-projection.js';
import { makeRecordSourceReader } from '../src/record-source-reader.js';

const NOW = '2026-08-26T04:00:00.000Z';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function conversationFixture(room) {
  const sessionId = randomUUID();
  const ledger = new ConversationLedger(join(room, 'conversations'));
  await ledger.ensure({ sessionId });
  const event = await ledger.appendMessage({
    sessionId, messageId: 'message-1', message: { role: 'user', content: 'exact source fixture' },
  });
  const reference = projectConversationRecordReference({
    event, expectedSessionId: sessionId, trust: 'user_asserted', observedAt: NOW,
  });
  return { sessionId, ledger, event, reference };
}

test('exact Conversation source를 다시 열고 content-free accounting과 원본을 분리한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-record-source-'));
  try {
    const fixture = await conversationFixture(room);
    let tick = 100n;
    const reader = makeRecordSourceReader({
      mode: 'O2_full_shadow', conversationLedger: fixture.ledger,
      nowNs: () => { tick += 10n; return tick; },
    });
    const result = await reader.reopen(fixture.reference, { expectedSessionId: fixture.sessionId });
    assert.equal(result.state, 'reopened');
    assert.equal(result.source.message.content, 'exact source fixture');
    assert.equal(result.accounting.availability, 'available');
    assert.equal(result.accounting.digestMatched, true);
    assert.equal(result.accounting.durationNs, '10');
    assert.doesNotMatch(JSON.stringify(result.accounting), /exact source fixture/u);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('changed source·missing source·foreign Session을 서로 다른 사실로 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-record-source-state-'));
  try {
    const fixture = await conversationFixture(room);
    const reader = makeRecordSourceReader({ mode: 'O2_full_shadow', conversationLedger: fixture.ledger });
    const changed = await reader.reopen({ ...fixture.reference, sha256: '0'.repeat(64) },
      { expectedSessionId: fixture.sessionId });
    assert.equal(changed.state, 'changed');
    assert.equal(changed.source, null);
    assert.equal(changed.accounting.availability, 'changed');

    const missing = await reader.reopen(makeRecordReference({
      ...Object.fromEntries(Object.entries(fixture.reference).filter(([key]) => key !== 'recordId')),
      sourceId: 'missing-message', sourceRevision: 99,
    }), { expectedSessionId: fixture.sessionId });
    assert.equal(missing.accounting.availability, 'missing');

    const foreign = await reader.reopen(fixture.reference, { expectedSessionId: randomUUID() });
    assert.equal(foreign.accounting.availability, 'permission_denied');
    assert.equal(foreign.accounting.bytesRead, null);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('managed local file은 root 안 regular single-link exact bytes만 다시 연다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-record-local-'));
  try {
    const root = join(room, 'managed'); await mkdir(root);
    const path = join(root, 'note.txt'); const bytes = Buffer.from('managed source fixture');
    await writeFile(path, bytes);
    const fileReference = (sourceId, sha256) => makeRecordReference({
      sourceKind: 'local_file', sourceStore: 'managed-file', sourceId, sourceRevision: 1,
      sha256, occurredAt: null, recordedAt: NOW,
      scope: { sessionId: 'session-1', workId: null, subjectKeys: [], channel: null },
      trust: 'user_asserted', sensitivity: 'personal', coverage: 'full', availability: 'available',
    });
    const locations = new Map([['file-1', { root, path }]]);
    const reader = makeRecordSourceReader({
      mode: 'O2_full_shadow', localFileResolver: async (reference) => locations.get(reference.sourceId),
    });
    const available = await reader.reopen(fileReference('file-1', createHash('sha256').update(bytes).digest('hex')),
      { expectedSessionId: 'session-1' });
    assert.equal(available.state, 'reopened');
    assert.deepEqual(available.source, bytes);

    const symlinkPath = join(root, 'symbolic'); await symlink(path, symlinkPath);
    locations.set('symbolic', { root, path: symlinkPath });
    const symbolic = await reader.reopen(fileReference('symbolic', null),
      { expectedSessionId: 'session-1' });
    assert.equal(symbolic.accounting.availability, 'permission_denied');

    const hardlinkPath = join(root, 'hard'); await link(path, hardlinkPath);
    locations.set('hard', { root, path: hardlinkPath });
    const hard = await reader.reopen(fileReference('hard', null),
      { expectedSessionId: 'session-1' });
    assert.equal(hard.accounting.availability, 'permission_denied');
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('provider가 없거나 관측 중 crash하면 memory 없음이 아니라 unknown availability다', async () => {
  const reference = makeRecordReference({
    sourceKind: 'web_source', sourceStore: 'web-observation', sourceId: 'web-1',
    sourceRevision: null, sha256: null, occurredAt: null, recordedAt: NOW,
    scope: { sessionId: 'session-1', workId: null, subjectKeys: [], channel: null },
    trust: 'external_untrusted', sensitivity: 'personal', coverage: 'unknown', availability: 'unknown',
  });
  const absent = await makeRecordSourceReader({ mode: 'O2_full_shadow' }).reopen(reference,
    { expectedSessionId: 'session-1' });
  assert.equal(absent.accounting.availability, 'unknown');
  const crashed = await makeRecordSourceReader({
    mode: 'O2_full_shadow', providerResolver: async () => { throw new Error('private provider failure'); },
  }).reopen(reference, { expectedSessionId: 'session-1' });
  assert.equal(crashed.accounting.availability, 'unknown');
  assert.doesNotMatch(JSON.stringify(crashed.accounting), /private provider failure/u);
});

test('O0/O2 same-purpose A/B는 제품 결과 digest를 바꾸지 않고 shadow 비용만 별도 관측한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-record-source-ab-'));
  try {
    const fixture = await conversationFixture(room);
    const journey = async (mode) => {
      const product = {
        providerRequest: { request: 'safe same-purpose fixture' },
        toolCalls: [], effects: [], surface: null,
      };
      product.toolCalls.push({ name: 'fixture_read', result: 'completed' });
      product.effects.push({ kind: 'observe', outcome: 'succeeded' });
      product.surface = { answer: '원본을 확인했습니다.' };
      const productDigestAtTerminal = digest(product);
      const shadow = await makeRecordSourceReader({
        mode, conversationLedger: fixture.ledger,
      }).reopen(fixture.reference, { expectedSessionId: fixture.sessionId });
      return { productDigestAtTerminal, product, shadow };
    };
    const off = await journey('O0_off'); const shadow = await journey('O2_full_shadow');
    assert.equal(off.productDigestAtTerminal, shadow.productDigestAtTerminal);
    assert.deepEqual(off.product, shadow.product);
    assert.equal(off.shadow.state, 'off');
    assert.equal(shadow.shadow.state, 'reopened');
    assert.ok(BigInt(shadow.shadow.accounting.durationNs) >= 0n);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});
