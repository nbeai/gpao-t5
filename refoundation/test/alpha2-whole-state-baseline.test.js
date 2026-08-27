import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AttachmentStore } from '../src/attachment-store.js';
import { AutomationStore } from '../src/automation-store.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { ConversationLedger } from '../src/conversation-ledger.js';
import { exportMemoryBundle } from '../src/memory-export.js';
import { MemoryLedger } from '../src/memory-ledger.js';
import { WorkStore } from '../src/work-store.js';

test('Alpha2 mixed canonical fixture는 기존 Memory export 하나로 백업·복원할 수 없다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-alpha2-baseline-')); const state = join(room, 'state');
  try {
    const sessions = new ConsoleSessionStore(state); const session = await sessions.create();
    await sessions.append(session.id, { role: 'user', text: '분기 보고서를 이어서 만들어줘' });
    const conversations = new ConversationLedger(join(state, 'conversations'));
    await conversations.ensure({ sessionId: session.id });
    await conversations.appendMessage({ sessionId: session.id, messageId: 'message-1',
      message: { role: 'user', content: '분기 보고서를 이어서 만들어줘' } });
    const workStore = new WorkStore(join(state, 'work'));
    const work = await workStore.create({ sessionId: session.id, sourceMessageId: 'message-1' });
    const memories = new MemoryLedger(join(state, 'memory'));
    await memories.ensure();
    await memories.add({ kind: 'work', content: '분기 보고서 작업을 이어간다.' });
    const automation = new AutomationStore(join(state, 'automation', 'state.json'));
    await automation.create({ name: '보고서 확인', prompt: '분기 보고서를 확인한다', sessionId: session.id,
      scheduleKind: 'at', schedule: '2099-01-01T00:00:00.000Z', timezone: 'UTC',
      requirements: { requiredTools: [], requiredEffect: 'observe', requireResultUrl: false },
      delivery: { kind: 'origin_session' }, workBinding: { workId: work.workId, revision: 1 } });
    const attachments = new AttachmentStore(join(state, 'attachments'));
    const artifact = await attachments.receive({ sessionId: session.id, originalName: 'report.txt',
      bytes: Buffer.from('quarterly report'), direction: 'output' });

    const bundle = exportMemoryBundle({ state: await memories.read(), exportedAt: new Date(0).toISOString() });
    const text = JSON.stringify(bundle);
    assert.doesNotMatch(text, new RegExp(session.id, 'u'));
    assert.doesNotMatch(text, new RegExp(work.workId, 'u'));
    assert.doesNotMatch(text, new RegExp(artifact.attachmentId, 'u'));
    assert.equal(Object.keys(bundle).some((key) => ['sessions', 'conversations', 'works', 'automations', 'artifacts'].includes(key)), false);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('Alpha2 사고 가족은 stable generation·secret 0·격리 restore·effect non-retry를 함께 닫는다', async () => {
  const incidents = JSON.parse(await readFile(new URL('../config/alpha2-whole-state-incidents.json', import.meta.url), 'utf8'));
  assert.equal(incidents.incidents.length, 10);
  for (const id of ['A2-STABLE-GENERATION', 'A2-SECRET-EXCLUSION', 'A2-ISOLATED-RESTORE', 'A2-EXTERNAL-EFFECT']) {
    assert.ok(incidents.incidents.some((item) => item.id === id));
  }
  assert.doesNotMatch(JSON.stringify(incidents), /AuthKey_|PRIVATE KEY|\/Users\/jyp|secret-token/u);
});
