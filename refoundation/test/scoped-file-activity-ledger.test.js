import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalizeMacOSFSEvent, normalizeWindowsUSNRecord,
  ScopedFileActivityLedger } from '../src/scoped-file-activity-ledger.js';

const T0 = '2026-08-27T00:00:00.000Z'; const T1 = '2026-08-27T00:00:01.000Z';
const journal = { kind: 'fsevents', volume: 'volume-1', journalId: 'journal-1' };

async function fixture() {
  const room = await mkdtemp(join(tmpdir(), 't5-ch1-ledger-')); const root = join(room, 'allowed'); await mkdir(root);
  const ledger = new ScopedFileActivityLedger(join(room, 'state'));
  await ledger.configure({ roots: [root], platform: 'darwin', recordedAt: T0 });
  return { room, root, ledger };
}

test('CH1 ledger는 default off이고 허용 root의 metadata만 0600에 기록한다', async () => {
  const { room, root, ledger } = await fixture(); assert.equal((await ledger.status()).enabled, false);
  assert.deepEqual(await ledger.ingest({ source: 'fixture', journal, cursor: '1', events: [], recordedAt: T1 }),
    { accepted: 0, state: 'paused' });
  await ledger.setEnabled({ enabled: true, recordedAt: T1 });
  const event = { kind: 'created', path: join(root, '보고서.txt'), occurredAt: T1,
    sourceEventId: '1', identity: { device: '1', inode: '2' }, availability: 'available' };
  const result = await ledger.ingest({ source: 'fixture', journal, cursor: '1', events: [event, event,
    { ...event, path: join(room, 'outside.txt'), sourceEventId: '2' }], recordedAt: T1 });
  assert.equal(result.accepted, 1); assert.equal((await ledger.status()).eventCount, 1);
  const stateFiles = await import('node:fs/promises').then((fs) => fs.readdir(join(room, 'state')));
  for (const name of stateFiles) assert.equal((await stat(join(room, 'state', name))).mode & 0o777, 0o600);
  const projected = await ledger.query(); assert.equal(projected[0].pathText, '보고서.txt');
  assert.equal(projected[0].actor, 'unknown'); assert.equal(projected[0].coverage, 'metadata_only');
  assert.doesNotMatch(JSON.stringify(projected), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
});

test('content·hash·secret·actor 입력은 closed event 경계에서 거부하거나 unknown으로 낮춘다', async () => {
  const { root, ledger } = await fixture(); await ledger.setEnabled({ enabled: true, recordedAt: T1 });
  await assert.rejects(() => ledger.ingest({ source: 'fixture', journal, cursor: '1', recordedAt: T1,
    events: [{ kind: 'created', path: join(root, 'a'), occurredAt: T1, sourceEventId: '1', content: 'SECRET' }] }), /fields/u);
  await ledger.ingest({ source: 'fixture', journal, cursor: '2', recordedAt: T1,
    events: [{ kind: 'created', path: join(root, 'a'), occurredAt: T1, sourceEventId: '2', actor: 't5' }] })
    .then(() => assert.fail('actor field must be rejected'), (error) => assert.match(error.message, /fields/u));
  assert.deepEqual(await ledger.query(), []);
});

test('같은 event ID의 다른 path는 보존하고 replay·older cursor는 중복 기록하지 않는다', async () => {
  const { root, ledger } = await fixture(); await ledger.setEnabled({ enabled: true, recordedAt: T1 });
  const events = ['a', 'b'].map((name) => ({ kind: 'modified', path: join(root, name), occurredAt: T1,
    sourceEventId: '10', availability: 'available' }));
  assert.equal((await ledger.ingest({ source: 'fixture', journal, cursor: '10', events, recordedAt: T1 })).accepted, 2);
  assert.equal((await ledger.ingest({ source: 'fixture', journal, cursor: '10', events, recordedAt: T1 })).accepted, 0);
  assert.deepEqual(await ledger.ingest({ source: 'fixture', journal, cursor: '9', events, recordedAt: T1 }),
    { accepted: 0, state: 'stale_cursor' });
  assert.equal((await ledger.query()).length, 2);
});

test('journal gap·identity change는 rescan 전 absence를 no-change로 만들지 않는다', async () => {
  const { root, ledger } = await fixture(); await ledger.setEnabled({ enabled: true, recordedAt: T1 });
  await ledger.ingest({ source: 'fixture', journal, cursor: '10', recordedAt: T1,
    events: [{ kind: 'created', path: join(root, 'a'), occurredAt: T1, sourceEventId: '10' }] });
  const changed = await ledger.ingest({ source: 'fixture', journal: { ...journal, journalId: 'journal-2' },
    cursor: '11', events: [], recordedAt: T1 }); assert.equal(changed.state, 'rescan_required');
  assert.equal((await ledger.status()).enabled, false); assert.ok((await ledger.status()).gap);
  await assert.rejects(() => ledger.setEnabled({ enabled: true, recordedAt: T1 }), /rescan/u);
  await ledger.settleSnapshot({ journal: { ...journal, journalId: 'journal-2' }, cursor: '11', itemCount: 1,
    snapshotDigest: 'a'.repeat(64), recordedAt: '2026-08-27T00:00:02.000Z' });
  assert.equal((await ledger.status()).gap, null);
});

test('scope 교체는 이전 generation activity를 숨겨 보존하지 않고 journal schema는 closed다', async () => {
  const { room, root, ledger } = await fixture(); await ledger.setEnabled({ enabled: true, recordedAt: T1 });
  await assert.rejects(() => ledger.ingest({ source: 'fixture', journal: { ...journal, token: 'SECRET' }, cursor: '1',
    events: [], recordedAt: T1 }), /journal identity fields/u);
  await ledger.ingest({ source: 'fixture', journal, cursor: '1', recordedAt: T1,
    events: [{ kind: 'created', path: join(root, 'a'), occurredAt: T1, sourceEventId: '1' }] });
  const second = join(room, 'second'); await mkdir(second);
  await ledger.configure({ roots: [second], platform: 'darwin', recordedAt: '2026-08-27T00:00:02.000Z' });
  assert.deepEqual(await ledger.query(), []);
  assert.equal((await readdir(join(room, 'state'))).filter((name) => name.startsWith('activity-')).length, 0);
});

test('activity payload를 sequence 유지한 채 바꿔도 digest 재검사에서 실패한다', async () => {
  const { room, root, ledger } = await fixture(); await ledger.setEnabled({ enabled: true, recordedAt: T1 });
  await ledger.ingest({ source: 'fixture', journal, cursor: '1', recordedAt: T1,
    events: [{ kind: 'created', path: join(root, 'a'), occurredAt: T1, sourceEventId: '1' }] });
  const file = (await readdir(join(room, 'state'))).find((name) => name.startsWith('activity-'));
  const path = join(room, 'state', file); const text = await readFile(path, 'utf8');
  await writeFile(path, text.replace('"created"', '"deleted"'), { mode: 0o600 });
  await assert.rejects(() => ledger.query(), /digest/u);
});

test('pause·forget은 활동 파일을 물리적으로 교체하고 restart에서 exact 0을 보인다', async () => {
  const { root, ledger } = await fixture(); await ledger.setEnabled({ enabled: true, recordedAt: T1 });
  await ledger.ingest({ source: 'fixture', journal, cursor: '1', recordedAt: T1,
    events: [{ kind: 'created', path: join(root, 'a'), occurredAt: T1, sourceEventId: '1' }] });
  const receipt = await ledger.forgetAll({ recordedAt: '2026-08-27T00:00:03.000Z' });
  assert.deepEqual(receipt, { deletedEvents: 1, remainingEvents: 0, enabled: false });
  const restarted = new ScopedFileActivityLedger(ledger.directory);
  assert.equal((await restarted.status()).eventCount, 0); assert.deepEqual(await restarted.query(), []);
});

test('symlink root와 metadata open 추측은 허용하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-ch1-symlink-')); const outside = join(room, 'outside'); await mkdir(outside);
  const linked = join(room, 'linked'); await symlink(outside, linked);
  const ledger = new ScopedFileActivityLedger(join(room, 'state'));
  await assert.rejects(() => ledger.configure({ roots: [linked], platform: 'darwin', recordedAt: T0 }), /exact directory/u);
  assert.equal(normalizeMacOSFSEvent({ eventId: 1, path: outside, occurredAt: T1, flags: ['history_done'] }), null);
});

test('macOS gap flags와 Windows USN reasons는 같은 metadata truth로 정규화한다', () => {
  assert.deepEqual(normalizeMacOSFSEvent({ eventId: 7, flags: ['kernel_dropped'] }),
    { gap: true, reason: 'kernel_dropped', cursor: '7' });
  assert.deepEqual(normalizeWindowsUSNRecord({ usn: 9, path: 'C:\\Work\\a', occurredAt: T1,
    reasons: ['rename_new_name'], volume: 'V', fileId: 'F', reparse: 'junction', availability: 'available' }), {
    kind: 'moved', path: 'C:\\Work\\a', occurredAt: T1, sourceEventId: '9',
    identity: { volume: 'V', fileId: 'F', reparse: 'junction' }, availability: 'available' });
  assert.deepEqual(normalizeWindowsUSNRecord({ gap: true, usn: '10', reason: 'usn_cursor_outside_journal' }), {
    gap: true, cursor: '10', reason: 'usn_cursor_outside_journal',
  });
});
