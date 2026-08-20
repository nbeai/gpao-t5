import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { ConsoleSessionStore } from '../src/console-session-store.js';

test('메신저에서 시작한 세션은 재시작·목록 projection까지 provider/chat origin을 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-session-origin-'));
  const store = new ConsoleSessionStore(room);
  const created = await store.create({ origin: { channel: 'telegram', chatId: '555' } });
  await store.append(created.id, {
    role: 'user', text: '텔레그램에서 보낸 말', channel: 'telegram',
  });

  const reopened = new ConsoleSessionStore(room);
  assert.deepEqual((await reopened.load(created.id)).origin, { channel: 'telegram', chatId: '555' });
  assert.deepEqual((await reopened.list())[0].origin, { channel: 'telegram', chatId: '555' });
});

test('현재 재사용 UI는 session origin만 받으면 기존 Telegram 아이콘을 표시한다', async () => {
  const html = await readFile(resolve('src/surface/web/index.html'), 'utf8');
  assert.match(html, /CHANNEL_ICON\s*=\s*\{[^}]*telegram:\s*'✈️'/u);
  assert.match(html, /s\.origin\?\.channel/u);
  assert.match(html, /CHANNEL_ICON\[s\.origin\.channel\]/u);
});

test('기존 Telegram binding에 묶인 예전 세션은 origin을 한 번 복구한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-messenger-session-backfill-'));
  const store = new ConsoleSessionStore(room);
  const created = await store.create();
  assert.equal((await store.load(created.id)).origin, null);
  await store.setOrigin(created.id, { channel: 'telegram', chatId: '777' });
  assert.deepEqual((await store.list())[0].origin, { channel: 'telegram', chatId: '777' });
  await store.setOrigin(created.id, { channel: 'telegram', chatId: 'other' });
  assert.deepEqual((await store.list())[0].origin, { channel: 'telegram', chatId: '777' });
});
