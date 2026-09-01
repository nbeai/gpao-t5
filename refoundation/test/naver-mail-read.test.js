import assert from 'node:assert/strict';
import test from 'node:test';

import { makeNaverMailConnection } from '../src/naver-mail-connection.js';

function secrets() {
  const values = new Map();
  return { async get(key) { return structuredClone(values.get(key) ?? null); },
    async set(key, value) { values.set(key, structuredClone(value)); },
    async clear(key) { values.delete(key); }, values };
}

function fakeProtocol() {
  const calls = []; const messages = [{ uid: 41, flags: new Set(), size: 128,
    internalDate: new Date('2026-09-01T03:00:00Z'), envelope: {
      messageId: '<m-41@example.test>', subject: '8월 부가세 자료', date: new Date('2026-09-01T03:00:00Z'),
      from: [{ name: '세무사', address: 'tax@example.test' }], to: [{ address: 'owner@naver.com' }],
    }, source: Buffer.from('fixture-rfc822') }];
  return { calls, async verify(credentials) {
    calls.push(['verify', credentials]); return { accountId: credentials.accountId, folders: 4 };
  }, async listFolders(credentials) { calls.push(['folders', credentials]); return [
    { path: 'INBOX', name: '받은메일함', specialUse: '\\Inbox', messages: 12, unseen: 3, uidValidity: '77' },
  ]; }, async search(credentials, request) {
    calls.push(['search', credentials, request]); return { folder: 'INBOX', uidValidity: '77', totalMatches: 1,
      messages, nextCursor: null, coverage: { state: 'complete', returned: 1, totalMatches: 1 } };
  }, async read(credentials, request) {
    calls.push(['read', credentials, request]); return { folder: 'INBOX', uidValidity: '77', message: messages[0],
      parsed: { text: '자료 확인 부탁드립니다.', html: false, attachments: [{ filename: 'vat.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 4, content: Buffer.from('XLSX') }] }, seenBefore: false, seenAfter: false };
  } };
}

test('Naver app password는 secure store에만 저장되고 official IMAP positive control 뒤 ready다', async () => {
  const secretStore = secrets(); const protocol = fakeProtocol(); const states = [];
  const connection = makeNaverMailConnection({ secretStore, protocol,
    observeProtocol: (state) => states.push(state), now: () => 1_788_230_400_000 });
  const before = await connection.inspect();
  assert.equal(before.state, 'needs_connection');
  assert.deepEqual(before.credentialRequest.fields.map(({ id, secret }) => ({ id, secret })), [
    { id: 'accountId', secret: false }, { id: 'appPassword', secret: true },
  ]);
  const connected = await connection.connectCredentials({ accountId: 'owner', appPassword: 'APP-SECRET' });
  assert.equal(connected.ready, true); assert.deepEqual(states, ['ready']);
  const after = await connection.inspect();
  assert.equal(after.state, 'ready'); assert.equal(after.identity.accountId, 'owner@naver.com');
  assert.doesNotMatch(JSON.stringify(after), /APP-SECRET/u);
  assert.equal(secretStore.values.get('naver-mail-protocol').credentials.appPassword, 'APP-SECRET');
});

test('Naver Mail read는 folder·message·coverage와 unread effect를 분리하고 첨부 exact bytes를 등록한다', async () => {
  const secretStore = secrets(); const protocol = fakeProtocol();
  const received = [];
  const connection = makeNaverMailConnection({ secretStore, protocol });
  await connection.connectCredentials({ accountId: 'owner', appPassword: 'APP-SECRET' });
  const tool = await connection.makeTool({ attachments: { async receive(input) {
    received.push(input); return { attachmentId: 'attachment-1', originalName: input.originalName,
      bytes: input.bytes.length, sha256: 'fixture-digest' };
  } }, sessionId: 'session-1', runId: 'run-1' });
  assert.equal(tool.name, 'naver_mail');
  const effect = { kind: 'observe', summary: '네이버 메일 읽기', targets: ['mailbox'],
    reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null };
  const folders = await tool.execute({ action: 'list_folders', folder: null, query: null,
    from: null, to: null, subject: null, since: null, before: null, unreadOnly: null,
    messageHandle: null, attachmentHandle: null, cursor: null, limit: 20, effect });
  assert.equal(folders.folders[0].name, '받은메일함');
  const found = await tool.execute({ action: 'search', folder: 'INBOX', query: '부가세',
    from: null, to: null, subject: null, since: null, before: null, unreadOnly: true,
    messageHandle: null, attachmentHandle: null, cursor: null, limit: 20, effect });
  assert.equal(found.coverage.state, 'complete'); assert.equal(found.messages[0].subject, '8월 부가세 자료');
  const read = await tool.execute({ action: 'read', folder: null, query: null,
    from: null, to: null, subject: null, since: null, before: null, unreadOnly: null,
    messageHandle: found.messages[0].messageHandle, attachmentHandle: null, cursor: null, limit: 20, effect });
  assert.equal(read.unreadStateEffect, 'unchanged'); assert.equal(read.body.text, '자료 확인 부탁드립니다.');
  const downloaded = await tool.execute({ action: 'download_attachment', folder: null, query: null,
    from: null, to: null, subject: null, since: null, before: null, unreadOnly: null,
    messageHandle: null, attachmentHandle: read.attachments[0].attachmentHandle, cursor: null, limit: 20, effect });
  assert.equal(downloaded.artifact.attachmentId, 'attachment-1');
  assert.equal(received[0].originalName, 'vat.xlsx'); assert.equal(received[0].bytes.toString(), 'XLSX');
});

test('revoked credential과 stale mailbox identity는 fail closed하며 secret을 오류에 노출하지 않는다', async () => {
  const secretStore = secrets();
  const connection = makeNaverMailConnection({ secretStore, protocol: {
    async verify() { throw new Error('bad APP-SECRET'); },
  } });
  await assert.rejects(connection.connectCredentials({ accountId: 'owner', appPassword: 'APP-SECRET' }),
    (error) => error.reason === 'credential_verification_failed' && !String(error).includes('APP-SECRET'));
  assert.equal(secretStore.values.size, 0);
});

test('긴 메일 본문은 complete로 꾸미지 않고 같은 message identity의 bounded cursor로 이어 읽는다', async () => {
  const secretStore = secrets(); const protocol = fakeProtocol(); const originalRead = protocol.read;
  protocol.read = async (...args) => { const result = await originalRead(...args);
    return { ...result, parsed: { ...result.parsed, text: '가'.repeat(50_010) } }; };
  const connection = makeNaverMailConnection({ secretStore, protocol });
  await connection.connectCredentials({ accountId: 'owner', appPassword: 'APP-SECRET' });
  const tool = await connection.makeTool({}); const effect = { kind: 'observe' };
  const found = await tool.execute({ action: 'search', folder: 'INBOX', query: null,
    from: null, to: null, subject: null, since: null, before: null, unreadOnly: null,
    messageHandle: null, attachmentHandle: null, cursor: null, limit: 20, effect });
  const first = await tool.execute({ action: 'read', folder: null, query: null,
    from: null, to: null, subject: null, since: null, before: null, unreadOnly: null,
    messageHandle: found.messages[0].messageHandle, attachmentHandle: null, cursor: null, limit: 20, effect });
  assert.equal(first.coverage.state, 'partial'); assert.equal(first.body.text.length, 50_000);
  const second = await tool.execute({ action: 'read', folder: null, query: null,
    from: null, to: null, subject: null, since: null, before: null, unreadOnly: null,
    messageHandle: found.messages[0].messageHandle, attachmentHandle: null, cursor: first.nextCursor, limit: 20, effect });
  assert.equal(second.coverage.state, 'complete'); assert.equal(second.body.text.length, 10);
  assert.equal(second.coverage.bodyStart, 50_000);
});
